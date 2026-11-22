import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import {
  criarConsulta,
  criarHorario,
  criarProfissional,
  criarUsuario,
} from "../../../test/factories";
import {
  autenticar,
  autenticarPaciente,
  lerJson,
  requisitar,
  tokenDe,
  tokenDoProfissional,
} from "../../../test/http";
import { hashSha256 } from "../../../utils/crypto";
import { validacaoRateLimit } from "../receitas.routes";
import { abreviarNome } from "../validacao.service";

type Receita = {
  id: string;
  validaAte: string;
  itens: { medicamento: string }[];
  medico: { id: string };
  codigoVerificacao?: string;
};

type Validacao = {
  situacao: string;
  paciente: { nome: string };
  medico: Record<string, string>;
};

const HORA = 60 * 60 * 1000;
const itens = [
  {
    medicamento: "Losartana potássica",
    dosagem: "50 mg",
    posologia: "1 comprimido ao dia",
    quantidade: 30,
  },
];

let paciente: Awaited<ReturnType<typeof autenticarPaciente>>;
let medico: Awaited<ReturnType<typeof criarProfissional>>;
let tokenMedico: string;

const consultaEm = async (horas: number) => {
  const inicio = new Date(Date.now() + horas * HORA);
  const horario = await criarHorario({
    profissionalId: medico.id,
    inicio,
    fim: new Date(inicio.getTime() + HORA / 2),
  });
  return criarConsulta({
    pacienteId: paciente.paciente.id,
    horarioId: horario.id,
  });
};

const emitir = (
  consultaId: string,
  body: unknown = { itens },
  token = tokenMedico,
) => requisitar("POST", `/consultas/${consultaId}/receitas`, { token, body });

const emitirValida = async () => {
  const consulta = await consultaEm(-1);
  return (await lerJson<{ data: Receita }>(await emitir(consulta.id))).data;
};

const validar = (codigo: string) =>
  requisitar("POST", "/receitas/validacao", { body: { codigo } });

beforeEach(async () => {
  validacaoRateLimit.reset();
  await resetDatabase();
  paciente = await autenticarPaciente();
  medico = await criarProfissional();
  tokenMedico = await tokenDoProfissional(medico);
});

describe("POST /consultas/:id/receitas", () => {
  it("emite a receita com validade padrão de 30 dias e devolve o código uma vez", async () => {
    const consulta = await consultaEm(-1);

    const res = await emitir(consulta.id);
    const { data } = await lerJson<{ data: Receita }>(res);
    const salva = await prisma.prescricao.findUniqueOrThrow({
      where: { id: data.id },
    });
    const esperado = new Date();
    esperado.setUTCDate(esperado.getUTCDate() + 30);

    expect(res.status).toBe(201);
    expect(data.codigoVerificacao).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.validaAte).toBe(esperado.toISOString().slice(0, 10));
    expect(data.medico.id).toBe(medico.id);
    // O banco guarda só o hash, nunca o código
    expect(salva.codigoVerificacaoHash).toBe(
      hashSha256(data.codigoVerificacao!),
    );
    expect(JSON.stringify(salva)).not.toContain(data.codigoVerificacao!);
  });

  it("gera códigos diferentes a cada emissão", async () => {
    const primeira = await emitirValida();
    const segunda = await emitirValida();

    expect(primeira.codigoVerificacao).not.toBe(segunda.codigoVerificacao);
  });

  it("só o médico da consulta emite, depois do início", async () => {
    const iniciada = await consultaEm(-1);
    const futura = await consultaEm(24);
    const colega = await criarProfissional({ unidadeId: medico.unidadeId });
    // O middleware usa o perfil gravado no banco, não o do token
    const usuarioEnfermeira = await criarUsuario({ perfil: Perfil.ENFERMEIRO });
    await criarProfissional({
      usuarioId: usuarioEnfermeira.id,
      unidadeId: medico.unidadeId,
      conselho: "COREN",
    });
    const enfermeira = await tokenDe(usuarioEnfermeira);

    expect((await emitir(futura.id)).status).toBe(409);
    expect(
      (await emitir(iniciada.id, { itens }, await tokenDoProfissional(colega)))
        .status,
    ).toBe(404);
    expect((await emitir(iniciada.id, { itens }, enfermeira)).status).toBe(403);
  });

  it.each([
    ["sem itens", { itens: [] }],
    ["quantidade zero", { itens: [{ ...itens[0], quantidade: 0 }] }],
    ["validade acima de 365 dias", { itens, validaAte: "2099-01-01" }],
    ["HTML na posologia", { itens: [{ ...itens[0], posologia: "<b>x</b>" }] }],
  ])("responde 400 com %s", async (_, body) => {
    const consulta = await consultaEm(-1);

    expect((await emitir(consulta.id, body)).status).toBe(400);
  });
});

describe("GET /receitas/:id", () => {
  it("mostra a receita ao paciente, sem o código", async () => {
    const receita = await emitirValida();

    const res = await requisitar("GET", `/receitas/${receita.id}`, {
      token: paciente.token,
    });
    const { data } = await lerJson<{ data: Receita }>(res);

    expect(res.status).toBe(200);
    expect(data.itens[0]?.medicamento).toBe("Losartana potássica");
    expect(data).not.toHaveProperty("codigoVerificacao");
  });

  it("responde 404 a outro paciente e 403 ao ADMIN", async () => {
    const receita = await emitirValida();
    const url = `/receitas/${receita.id}`;

    const outro = await requisitar("GET", url, {
      token: (await autenticarPaciente()).token,
    });
    const admin = await requisitar("GET", url, {
      token: await autenticar(Perfil.ADMIN),
    });

    expect(outro.status).toBe(404);
    expect(admin.status).toBe(403);
  });
});

describe("POST /receitas/validacao (farmácia, sem login)", () => {
  it("confirma a receita válida com dados mínimos e nome abreviado", async () => {
    await prisma.paciente.update({
      where: { id: paciente.paciente.id },
      data: { nome: "Ana Paula Ribeiro" },
    });
    const receita = await emitirValida();

    const res = await validar(receita.codigoVerificacao!);
    const { data } = await lerJson<{ data: Validacao }>(res);

    expect(res.status).toBe(200);
    expect(data.situacao).toBe("VALIDA");
    expect(data.paciente.nome).toBe("Ana P. R.");
    expect(Object.keys(data.medico).sort()).toEqual([
      "conselho",
      "nome",
      "registro",
    ]);
    expect(JSON.stringify(data)).not.toContain(paciente.paciente.id);
  });

  it("informa receita expirada", async () => {
    const receita = await emitirValida();
    await prisma.prescricao.update({
      where: { id: receita.id },
      data: { validaAte: new Date("2020-01-01") },
    });

    const { data } = await lerJson<{ data: Validacao }>(
      await validar(receita.codigoVerificacao!),
    );

    expect(data.situacao).toBe("EXPIRADA");
  });

  it("responde 404 para código inexistente e 400 para formato inválido, auditando", async () => {
    const inexistente = await validar("A".repeat(43));
    const malFormado = await validar("123");
    const log = await prisma.logAuditoria.findFirstOrThrow({
      where: { acao: "RECEITA_VALIDADA" },
    });

    expect(inexistente.status).toBe(404);
    expect(malFormado.status).toBe(400);
    expect(log).toMatchObject({
      usuarioId: null,
      detalhes: { encontrada: false },
    });
  });

  it("bloqueia com 429 depois de 30 tentativas do mesmo IP", async () => {
    for (let i = 0; i < 30; i++) await validar("A".repeat(43));

    const res = await validar("A".repeat(43));

    expect(res.status).toBe(429);
  });
});

describe("abreviarNome", () => {
  it.each([
    ["Ana Paula Ribeiro", "Ana P. R."],
    ["João", "João"],
    ["  Maria   da Silva ", "Maria d. S."],
  ])("%s → %s", (nome, esperado) => {
    expect(abreviarNome(nome)).toBe(esperado);
  });
});
