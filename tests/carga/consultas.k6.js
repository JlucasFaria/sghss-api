// Teste de carga (RNF07) dos fluxos críticos de consultas, com k6.
// Execução: bun run test:carga (API rodando, banco com o seed). Veja tests/README.md.
//
// Dois cenários simultâneos:
// - navegacao: pacientes e ADMIN consultando agenda, consultas, histórico,
//   notificações e ocupação de leitos (leitura, maior volume);
// - agendamento: pacientes agendando e cancelando consultas (escrita com transação
//   e travas no banco).
// Metas: p95 < 500 ms e menos de 1% de erros; o k6 falha se não forem atingidas.
import { check, fail, sleep } from "k6";
import exec from "k6/execution";
import http from "k6/http";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
// Usuários fictícios do seed (somente desenvolvimento)
const SENHA = __ENV.SENHA || "Vidaplus@2026";
const PACIENTES = [
  "joao.pereira@vidaplus.example",
  "maria.santos@vidaplus.example",
];
const VUS_NAVEGACAO = 20;
const VUS_AGENDAMENTO = 5;
const MINUTO = 60 * 1000;
const DIA = 24 * 60 * MINUTO;

export const options = {
  scenarios: {
    navegacao: {
      executor: "ramping-vus",
      exec: "navegacao",
      stages: [
        { duration: "20s", target: VUS_NAVEGACAO },
        { duration: "1m", target: VUS_NAVEGACAO },
        { duration: "10s", target: 0 },
      ],
    },
    agendamento: {
      executor: "constant-vus",
      exec: "agendamento",
      vus: VUS_AGENDAMENTO,
      duration: "1m30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

const autenticado = (token) => ({
  headers: { Authorization: `Bearer ${token}` },
});

// POST com corpo JSON, autenticado quando há token
const postJson = (caminho, body, token) =>
  http.post(`${BASE_URL}${caminho}`, JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      ...(token ? autenticado(token).headers : {}),
    },
  });

function login(email) {
  const res = postJson("/auth/login", { email, senha: SENHA });
  if (res.status !== 200) fail(`Login de ${email} falhou: ${res.status}`);
  return res.json("data.token");
}

// Login uma única vez (o login tem limite de tentativas) e um horário por usuário
// virtual do agendamento, em um dia sorteado no futuro para não colidir com
// execuções anteriores
export function setup() {
  const admin = login("admin@vidaplus.example");
  const medico = login("ana.souza@vidaplus.example");
  const pacientes = PACIENTES.map(login);

  const profissionais = http.get(
    `${BASE_URL}/profissionais?limit=100`,
    autenticado(admin),
  );
  const ana = profissionais
    .json("data")
    .find((p) => p.registro === "123456-PR");
  if (!ana) fail("Médica do seed não encontrada. Rode bun run db:seed.");

  const dias = 2 + Math.floor(Math.random() * 300);
  const base = Math.floor((Date.now() + dias * DIA) / MINUTO) * MINUTO;
  const horarios = [];
  for (let i = 0; i < VUS_NAVEGACAO + VUS_AGENDAMENTO; i++) {
    const inicio = base + i * 2 * MINUTO;
    const res = postJson(
      `/profissionais/${ana.id}/horarios`,
      {
        inicio: new Date(inicio).toISOString(),
        fim: new Date(inicio + MINUTO).toISOString(),
      },
      medico,
    );
    if (res.status !== 201) fail(`Abertura de horário falhou: ${res.status}`);
    horarios.push(res.json("data.id"));
  }

  return {
    admin,
    pacientes,
    profissionalId: ana.id,
    horarios,
    diaAgenda: new Date(base).toISOString().slice(0, 10),
  };
}

const pacienteDoVu = (dados) =>
  dados.pacientes[exec.vu.idInTest % dados.pacientes.length];

export function navegacao(dados) {
  const paciente = autenticado(pacienteDoVu(dados));

  const respostas = http.batch([
    ["GET", `${BASE_URL}/consultas?limit=20`, null, paciente],
    [
      "GET",
      `${BASE_URL}/profissionais/${dados.profissionalId}/horarios?data=${dados.diaAgenda}`,
      null,
      paciente,
    ],
    ["GET", `${BASE_URL}/pacientes/me/historico`, null, paciente],
    ["GET", `${BASE_URL}/notificacoes?limit=20`, null, paciente],
    [
      "GET",
      `${BASE_URL}/relatorios/ocupacao-leitos`,
      null,
      autenticado(dados.admin),
    ],
  ]);
  for (const res of respostas) {
    check(res, { "leitura 200": (r) => r.status === 200 });
  }
  sleep(1);
}

// Cada usuário virtual usa o próprio horário: agenda e cancela, devolvendo-o à agenda
export function agendamento(dados) {
  const token = pacienteDoVu(dados);
  const horarioId = dados.horarios[exec.vu.idInTest - 1];

  const agendada = postJson(
    "/consultas",
    { horarioId, modalidade: "TELEMEDICINA", motivo: "Retorno" },
    token,
  );
  if (!check(agendada, { "agendamento 201": (r) => r.status === 201 })) {
    sleep(1);
    return;
  }

  const cancelada = postJson(
    `/consultas/${agendada.json("data.id")}/cancelamento`,
    { motivo: "Teste de carga" },
    token,
  );
  check(cancelada, { "cancelamento 200": (r) => r.status === 200 });
  sleep(1);
}
