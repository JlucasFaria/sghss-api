// Teste de integração do fluxo completo, só pela API: cadastro da unidade e do médico,
// agenda, agendamento pelo paciente, atendimento (prontuário), conclusão, receita,
// validação pela farmácia e histórico do paciente. Verifica que os módulos funcionam
// juntos, além dos testes isolados de cada rota.
import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { Perfil } from "../../generated/prisma/client";
import { loginRateLimit, registerRateLimit } from "../api/auth/auth.routes";
import { validacaoRateLimit } from "../api/receitas/receitas.routes";
import { prisma } from "../db/client";
import { resetDatabase } from "../test/db";
import { criarUsuario } from "../test/factories";
import { lerJson, requisitar } from "../test/http";
import { hashPassword } from "../utils/password";

const MINUTO = 60 * 1000;

type Resposta<T> = { data: T };

// Faz a requisição, confere o status e devolve o "data" da resposta
async function chamar<T>(
  esperado: number,
  method: string,
  path: string,
  opcoes: { token?: string; body?: unknown } = {},
) {
  const res = await requisitar(method, path, opcoes);
  expect(res.status).toBe(esperado);
  return (await lerJson<Resposta<T>>(res)).data;
}

async function login(email: string, senha: string) {
  const { token } = await chamar<{ token: string }>(
    200,
    "POST",
    "/auth/login",
    {
      body: { email, senha },
    },
  );
  return token;
}

beforeEach(async () => {
  loginRateLimit.reset();
  registerRateLimit.reset();
  validacaoRateLimit.reset();
  await resetDatabase();
});

// Devolve o relógio real mesmo se o teste falhar no meio
afterEach(() => {
  setSystemTime();
});

it("paciente agenda, médico atende e prescreve, farmácia valida a receita", async () => {
  // O ADMIN existe antes de tudo (no sistema real, criado pelo seed)
  await criarUsuario({
    email: "admin@vidaplus.example",
    senhaHash: await hashPassword("SenhaAdmin123"),
    perfil: Perfil.ADMIN,
  });
  const admin = await login("admin@vidaplus.example", "SenhaAdmin123");

  // 1. ADMIN cadastra a unidade e o médico
  const unidade = await chamar<{ id: string }>(201, "POST", "/unidades", {
    token: admin,
    body: {
      nome: "Hospital VidaPlus Centro",
      tipo: "HOSPITAL",
      endereco: "Av. Central, 1000",
      cidade: "Curitiba",
      uf: "PR",
    },
  });
  const medico = await chamar<{ id: string }>(201, "POST", "/profissionais", {
    token: admin,
    body: {
      nome: "Dra. Ana Souza",
      perfil: "MEDICO",
      conselho: "CRM",
      registro: "123456-PR",
      especialidade: "Clínica Médica",
      unidadeId: unidade.id,
      email: "ana.souza@vidaplus.example",
      senha: "SenhaMedica123",
    },
  });
  const tokenMedico = await login(
    "ana.souza@vidaplus.example",
    "SenhaMedica123",
  );

  // 2. O médico abre um horário daqui a 30 minutos
  const inicio = new Date(Date.now() + 30 * MINUTO);
  const horario = await chamar<{ id: string }>(
    201,
    "POST",
    `/profissionais/${medico.id}/horarios`,
    {
      token: tokenMedico,
      body: {
        inicio: inicio.toISOString(),
        fim: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
      },
    },
  );

  // 3. O paciente cria a conta (aceitando o termo) e agenda a consulta
  await chamar(201, "POST", "/auth/register", {
    body: {
      email: "maria@exemplo.com",
      senha: "SenhaPaciente123",
      nome: "Maria Aparecida Lima",
      cpf: "529.982.247-25",
      dataNascimento: "1985-07-15",
      aceiteTermo: true,
    },
  });
  const tokenPaciente = await login("maria@exemplo.com", "SenhaPaciente123");
  const consulta = await chamar<{ id: string; status: string }>(
    201,
    "POST",
    "/consultas",
    {
      token: tokenPaciente,
      body: {
        horarioId: horario.id,
        modalidade: "PRESENCIAL",
        motivo: "Dor de cabeça frequente",
      },
    },
  );
  expect(consulta.status).toBe("AGENDADA");

  const notificacoes = await requisitar("GET", "/notificacoes", {
    token: tokenPaciente,
  });
  const { data: avisos } = await lerJson<{ data: { tipo: string }[] }>(
    notificacoes,
  );
  expect(avisos.map((n) => n.tipo)).toEqual(["CONSULTA_AGENDADA"]);

  // Antes do horário, o prontuário ainda não pode ser registrado
  await chamar(409, "POST", `/consultas/${consulta.id}/prontuario`, {
    token: tokenMedico,
    body: { conteudo: "Registro antecipado." },
  });

  // 4. Chega o horário da consulta. Os tokens emitidos antes continuam válidos porque
  // o avanço (35 min) é menor que a validade do JWT (JWT_EXPIRES_IN, padrão de 1 h)
  setSystemTime(new Date(inicio.getTime() + 5 * MINUTO));

  await chamar(201, "POST", `/consultas/${consulta.id}/prontuario`, {
    token: tokenMedico,
    body: {
      conteudo: "Cefaleia tensional. PA 12x8. Orientado sobre hidratação.",
    },
  });
  const conclusao = await requisitar(
    "POST",
    `/consultas/${consulta.id}/conclusao`,
    { token: tokenMedico },
  );
  expect(conclusao.status).toBe(204);

  // 5. O médico emite a receita; o código aparece só nesta resposta
  const receita = await chamar<{ id: string; codigoVerificacao: string }>(
    201,
    "POST",
    `/consultas/${consulta.id}/receitas`,
    {
      token: tokenMedico,
      body: {
        itens: [
          {
            medicamento: "Paracetamol",
            dosagem: "750 mg",
            posologia: "1 comprimido a cada 8 horas, se dor",
            quantidade: 10,
          },
        ],
      },
    },
  );

  // 6. A farmácia valida sem login e vê só o necessário
  const validacao = await chamar<{
    situacao: string;
    paciente: { nome: string };
    medico: { registro: string };
  }>(200, "POST", "/receitas/validacao", {
    body: { codigo: receita.codigoVerificacao },
  });
  expect(validacao).toMatchObject({
    situacao: "VALIDA",
    paciente: { nome: "Maria A. L." },
    medico: { registro: "123456-PR" },
  });

  // 7. O paciente vê a consulta realizada, a receita e a evolução no histórico
  const historico = await chamar<{
    consultas: { id: string; status: string }[];
    prescricoes: { id: string }[];
  }>(200, "GET", "/pacientes/me/historico", { token: tokenPaciente });
  expect(historico.consultas).toEqual([
    expect.objectContaining({ id: consulta.id, status: "REALIZADA" }),
  ]);
  expect(historico.prescricoes.map((p) => p.id)).toEqual([receita.id]);

  const evolucoes = await chamar<{ conteudo: string }[]>(
    200,
    "GET",
    `/consultas/${consulta.id}/prontuario`,
    { token: tokenPaciente },
  );
  expect(evolucoes[0]?.conteudo).toContain("Cefaleia tensional");

  // 8. Cada etapa sensível ficou na trilha de auditoria, na ordem em que aconteceu
  const trilha = await prisma.logAuditoria.findMany({
    where: {
      acao: {
        in: [
          "CONSULTA_AGENDADA",
          "PRONTUARIO_REGISTRADO",
          "CONSULTA_REALIZADA",
          "RECEITA_EMITIDA",
          "RECEITA_VALIDADA",
        ],
      },
    },
    orderBy: { criadoEm: "asc" },
  });
  expect(trilha.map((l) => l.acao)).toEqual([
    "CONSULTA_AGENDADA",
    "PRONTUARIO_REGISTRADO",
    "CONSULTA_REALIZADA",
    "RECEITA_EMITIDA",
    "RECEITA_VALIDADA",
  ]);
});
