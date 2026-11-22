import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { TERMO_DE_USO } from "../../../config/termo-de-uso";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import {
  criarConsulta,
  criarExame,
  criarLeito,
  criarPaciente,
  criarUsuario,
  gerarCpf,
} from "../../../test/factories";
import { autenticar, lerJson, requisitar, tokenDe } from "../../../test/http";
import { encrypt } from "../../../utils/crypto";
import { hashPassword } from "../../../utils/password";
import { AcaoAuditoria } from "../../auditoria/auditoria.service";
import { anonimizacaoRateLimit } from "../lgpd.routes";

type Consentimento = {
  id: string;
  finalidade: string;
  versaoTermo: string;
  revogadoEm: string | null;
};

const SENHA = "SenhaForte123";
const HASH_SENHA = await hashPassword(SENHA);

let titular: Awaited<ReturnType<typeof criarTitular>>;

// Paciente com senha real (a anonimização pede confirmação) e telefone
async function criarTitular() {
  const usuario = await criarUsuario({ senhaHash: HASH_SENHA });
  const cpf = gerarCpf();
  const paciente = await criarPaciente({
    usuarioId: usuario.id,
    cpf,
    nome: "Maria Titular",
    dataNascimento: new Date("1985-07-15"),
    telefoneCifrado: encrypt("41987654321"),
  });
  return {
    token: await tokenDe(usuario),
    usuarioId: usuario.id,
    pacienteId: paciente.id,
    cpf,
  };
}

const logsDe = (acao: string) =>
  prisma.logAuditoria.findMany({ where: { acao } });

const criarNotificacao = (usuarioId: string) =>
  prisma.notificacao.create({
    data: {
      usuarioId,
      tipo: "CONSULTA_AGENDADA",
      titulo: "Consulta agendada",
      mensagem: "Sua consulta está agendada.",
    },
  });

beforeEach(async () => {
  anonimizacaoRateLimit.reset();
  await resetDatabase();
  titular = await criarTitular();
});

describe("acesso", () => {
  it.each([
    ["GET", "/pacientes/me/consentimentos"],
    ["POST", "/pacientes/me/consentimentos"],
    ["DELETE", `/pacientes/me/consentimentos/${crypto.randomUUID()}`],
    ["GET", "/pacientes/me/dados"],
    ["POST", "/pacientes/me/anonimizacao"],
  ])("%s %s é exclusivo do paciente", async (method, path) => {
    expect((await requisitar(method, path)).status).toBe(401);
    for (const perfil of [Perfil.ADMIN, Perfil.MEDICO]) {
      const res = await requisitar(method, path, {
        token: await autenticar(perfil),
        body: method === "POST" ? { senha: SENHA } : undefined,
      });
      expect(res.status).toBe(403);
    }
  });
});

describe("consentimentos (RF24)", () => {
  const registrar = (body?: unknown) =>
    requisitar("POST", "/pacientes/me/consentimentos", {
      token: titular.token,
      body,
    });

  const registrarERetornar = async () =>
    (await lerJson<{ data: Consentimento }>(await registrar())).data;

  const revogar = (id: string, token = titular.token) =>
    requisitar("DELETE", `/pacientes/me/consentimentos/${id}`, { token });

  const noBanco = (id: string) =>
    prisma.consentimentoLgpd.findUniqueOrThrow({ where: { id } });

  it("registra o aceite do termo vigente, ignorando finalidade e versão do cliente", async () => {
    const res = await registrar({ finalidade: "Outra", versaoTermo: "9.9" });

    expect(res.status).toBe(201);
    const { data } = await lerJson<{ data: Consentimento }>(res);
    expect(data).toMatchObject({
      finalidade: TERMO_DE_USO.finalidade,
      versaoTermo: TERMO_DE_USO.versao,
      revogadoEm: null,
    });

    const [log] = await logsDe(AcaoAuditoria.CONSENTIMENTO_REGISTRADO);
    expect(log).toMatchObject({
      usuarioId: titular.usuarioId,
      entidadeId: data.id,
    });
  });

  it("recusa novo aceite enquanto o termo vigente está aceito", async () => {
    await registrar();

    expect((await registrar()).status).toBe(409);
    expect(await prisma.consentimentoLgpd.count()).toBe(1);
  });

  it("revoga sem apagar o aceite e permite aceitar de novo", async () => {
    const consentimento = await registrarERetornar();

    expect((await revogar(consentimento.id)).status).toBe(204);
    expect(await logsDe(AcaoAuditoria.CONSENTIMENTO_REVOGADO)).toHaveLength(1);
    expect((await registrar()).status).toBe(201);

    const res = await requisitar("GET", "/pacientes/me/consentimentos", {
      token: titular.token,
    });
    const { data } = await lerJson<{ data: Consentimento[] }>(res);
    // Mais recente primeiro: o novo aceite, depois o revogado (preservado como prova)
    expect(data).toHaveLength(2);
    expect(data[0]?.revogadoEm).toBeNull();
    expect(data[1]?.id).toBe(consentimento.id);
    expect(data[1]?.revogadoEm).not.toBeNull();
  });

  it("recusa revogar duas vezes e mantém a data da primeira revogação", async () => {
    const { id } = await registrarERetornar();
    await revogar(id);
    const { revogadoEm } = await noBanco(id);

    expect((await revogar(id)).status).toBe(409);
    expect((await noBanco(id)).revogadoEm).toEqual(revogadoEm);
  });

  it("não revoga consentimento de outro paciente (404)", async () => {
    const { id } = await registrarERetornar();
    const outro = await criarTitular();

    expect((await revogar(id, outro.token)).status).toBe(404);
    expect((await noBanco(id)).revogadoEm).toBeNull();
  });

  it("valida o id do consentimento", async () => {
    expect((await revogar("1")).status).toBe(400);
  });
});

describe("portabilidade (RF25)", () => {
  type Dados = {
    cadastro: { cpf: string; telefone: string | null };
    consentimentos: { ip: string }[];
    consultas: { id: string }[];
    exames: { id: string }[];
    prontuario: { consultaId: string; conteudo: string }[];
    notificacoes: { id: string }[];
  };

  it("exporta todos os dados do titular, decifrados, como arquivo JSON", async () => {
    await requisitar("POST", "/pacientes/me/consentimentos", {
      token: titular.token,
    });
    const consulta = await criarConsulta({
      pacienteId: titular.pacienteId,
      status: "REALIZADA",
    });
    const { profissionalId } = await prisma.horarioAgenda.findUniqueOrThrow({
      where: { id: consulta.horarioId },
    });
    await prisma.registroProntuario.create({
      data: {
        consultaId: consulta.id,
        autorId: profissionalId,
        conteudoCifrado: encrypt("Paciente estável."),
      },
    });
    const exame = await criarExame({ pacienteId: titular.pacienteId });
    await criarNotificacao(titular.usuarioId);
    // Dados de outro paciente não podem aparecer
    await criarConsulta();

    const res = await requisitar("GET", "/pacientes/me/dados", {
      token: titular.token,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("meus-dados.json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const texto = await res.text();
    const { data } = JSON.parse(texto) as { data: Dados };
    expect(data.cadastro).toMatchObject({
      cpf: titular.cpf,
      telefone: "41987654321",
    });
    expect(data.consentimentos).toHaveLength(1);
    expect(data.consentimentos[0]?.ip).toBeString();
    expect(data.consultas.map((c) => c.id)).toEqual([consulta.id]);
    expect(data.exames.map((e) => e.id)).toEqual([exame.id]);
    expect(data.prontuario).toEqual([
      expect.objectContaining({
        consultaId: consulta.id,
        conteudo: "Paciente estável.",
      }),
    ]);
    expect(data.notificacoes).toHaveLength(1);
    // Só dados decifrados: nada de hashes ou cifras internas
    expect(texto).not.toMatch(/senhaHash|cpfHash|Cifrado/);

    const [log] = await logsDe(AcaoAuditoria.DADOS_EXPORTADOS);
    expect(log).toMatchObject({
      usuarioId: titular.usuarioId,
      entidadeId: titular.pacienteId,
    });
  });
});

describe("anonimização (RF26)", () => {
  const anonimizar = (body: unknown = { senha: SENHA }) =>
    requisitar("POST", "/pacientes/me/anonimizacao", {
      token: titular.token,
      body,
    });

  const pacienteNoBanco = () =>
    prisma.paciente.findUniqueOrThrow({
      where: { id: titular.pacienteId },
      include: { usuario: true },
    });

  it("exige a senha correta e não altera nada sem ela", async () => {
    expect((await anonimizar({})).status).toBe(400);
    // 403: o token continua válido, só a confirmação falhou
    expect((await anonimizar({ senha: "SenhaErrada1" })).status).toBe(403);

    const paciente = await pacienteNoBanco();
    expect(paciente).toMatchObject({
      nome: "Maria Titular",
      anonimizadoEm: null,
    });
    expect(paciente.usuario.ativo).toBe(true);
  });

  it("limita as tentativas de senha por usuário", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await anonimizar({ senha: "SenhaErrada1" })).status).toBe(403);
    }

    const bloqueada = await anonimizar();
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.headers.get("Retry-After")).not.toBeNull();
    expect((await pacienteNoBanco()).anonimizadoEm).toBeNull();
  });

  it("recusa com consulta agendada ou internação em andamento", async () => {
    const agendada = await criarConsulta({ pacienteId: titular.pacienteId });
    expect((await anonimizar()).status).toBe(409);

    await prisma.consulta.update({
      where: { id: agendada.id },
      data: { status: "CANCELADA" },
    });
    const leito = await criarLeito();
    await prisma.internacao.create({
      data: {
        pacienteId: titular.pacienteId,
        leitoId: leito.id,
        motivo: "Observação",
      },
    });
    expect((await anonimizar()).status).toBe(409);
    expect((await pacienteNoBanco()).anonimizadoEm).toBeNull();
  });

  it("remove a identificação, preserva os registros clínicos e encerra o acesso", async () => {
    const consulta = await criarConsulta({
      pacienteId: titular.pacienteId,
      status: "REALIZADA",
    });
    await requisitar("POST", "/pacientes/me/consentimentos", {
      token: titular.token,
    });
    await criarNotificacao(titular.usuarioId);
    const emailOriginal = (await pacienteNoBanco()).usuario.email;

    expect((await anonimizar()).status).toBe(204);

    const paciente = await pacienteNoBanco();
    expect(paciente).toMatchObject({
      nome: "Paciente anonimizado",
      telefoneCifrado: null,
      dataNascimento: new Date("1985-01-01"),
    });
    expect(paciente.anonimizadoEm).not.toBeNull();
    expect(paciente.usuario.ativo).toBe(false);
    expect(paciente.usuario.email).not.toBe(emailOriginal);

    // Consulta preservada, consentimento revogado (não apagado), notificações apagadas
    expect(
      await prisma.consulta.findUnique({ where: { id: consulta.id } }),
    ).not.toBeNull();
    const consentimentos = await prisma.consentimentoLgpd.findMany({
      where: { pacienteId: titular.pacienteId },
    });
    expect(consentimentos).toHaveLength(1);
    expect(consentimentos[0]?.revogadoEm).not.toBeNull();
    expect(
      await prisma.notificacao.count({
        where: { usuarioId: titular.usuarioId },
      }),
    ).toBe(0);
    expect(await logsDe(AcaoAuditoria.PACIENTE_ANONIMIZADO)).toHaveLength(1);

    // O token deixa de valer e o login com os dados antigos falha
    const perfil = await requisitar("GET", "/pacientes/me", {
      token: titular.token,
    });
    expect(perfil.status).toBe(401);
    const login = await requisitar("POST", "/auth/login", {
      body: { email: emailOriginal, senha: SENHA },
    });
    expect(login.status).toBe(401);
  });

  it("impede que o ADMIN reidentifique o paciente pelo CPF ou pela edição", async () => {
    await anonimizar();
    const admin = await autenticar(Perfil.ADMIN);

    const busca = await requisitar("POST", "/pacientes/busca", {
      token: admin,
      body: { cpf: titular.cpf },
    });
    expect(busca.status).toBe(404);

    const edicao = await requisitar("PUT", `/pacientes/${titular.pacienteId}`, {
      token: admin,
      body: {
        nome: "Maria Titular",
        cpf: titular.cpf,
        dataNascimento: "1985-07-15",
        ativo: true,
      },
    });
    expect(edicao.status).toBe(409);
    expect((await pacienteNoBanco()).usuario.ativo).toBe(false);
  });
});
