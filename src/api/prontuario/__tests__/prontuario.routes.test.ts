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
import { decrypt } from "../../../utils/crypto";

type Evolucao = { id: string; conteudo: string; autor: { id: string } };

const HORA = 60 * 60 * 1000;

let paciente: Awaited<ReturnType<typeof autenticarPaciente>>;
let medico: Awaited<ReturnType<typeof criarProfissional>>;
let tokenMedico: string;

// Consulta do médico começando daqui a `horas` (negativo = já começou)
const consultaEm = async (horas: number, status?: "CANCELADA") => {
  const inicio = new Date(Date.now() + horas * HORA);
  const horario = await criarHorario({
    profissionalId: medico.id,
    inicio,
    fim: new Date(inicio.getTime() + HORA / 2),
  });
  return criarConsulta({
    pacienteId: paciente.paciente.id,
    horarioId: horario.id,
    status,
  });
};

const registrar = (consultaId: string, token: string, conteudo = "PA 12x8.") =>
  requisitar("POST", `/consultas/${consultaId}/prontuario`, {
    token,
    body: { conteudo },
  });

const concluir = (consultaId: string, token = tokenMedico) =>
  requisitar("POST", `/consultas/${consultaId}/conclusao`, { token });

beforeEach(async () => {
  await resetDatabase();
  paciente = await autenticarPaciente();
  medico = await criarProfissional();
  tokenMedico = await tokenDoProfissional(medico);
});

describe("POST /consultas/:id/prontuario", () => {
  it("registra a evolução cifrada, com o autor, e audita", async () => {
    const consulta = await consultaEm(-1);

    const res = await registrar(
      consulta.id,
      tokenMedico,
      "Dor torácica em melhora.",
    );
    const { data } = await lerJson<{ data: Evolucao }>(res);
    const salvo = await prisma.registroProntuario.findFirstOrThrow();

    expect(res.status).toBe(201);
    expect(data).toMatchObject({
      conteudo: "Dor torácica em melhora.",
      autor: { id: medico.id },
    });
    expect(salvo.conteudoCifrado).not.toContain("Dor torácica");
    expect(decrypt(salvo.conteudoCifrado)).toBe("Dor torácica em melhora.");
    expect(
      await prisma.logAuditoria.count({
        where: { acao: "PRONTUARIO_REGISTRADO" },
      }),
    ).toBe(1);
  });

  it("aceita evolução da enfermagem da mesma unidade", async () => {
    const consulta = await consultaEm(-1);
    // O middleware usa o perfil gravado no banco, não o do token
    const usuario = await criarUsuario({ perfil: Perfil.ENFERMEIRO });
    await criarProfissional({
      usuarioId: usuario.id,
      unidadeId: medico.unidadeId,
      conselho: "COREN",
    });
    const token = await tokenDe(usuario);

    expect((await registrar(consulta.id, token)).status).toBe(201);
  });

  it("responde 404 a profissional de outra unidade", async () => {
    const consulta = await consultaEm(-1);
    const deFora = await criarProfissional();

    const res = await registrar(consulta.id, await tokenDoProfissional(deFora));

    expect(res.status).toBe(404);
  });

  it("responde 409 antes do início e em consulta cancelada", async () => {
    const futura = await consultaEm(24);
    const cancelada = await consultaEm(-1, "CANCELADA");

    expect((await registrar(futura.id, tokenMedico)).status).toBe(409);
    expect((await registrar(cancelada.id, tokenMedico)).status).toBe(409);
  });

  it("rejeita HTML no conteúdo e bloqueia paciente e ADMIN", async () => {
    const consulta = await consultaEm(-1);

    expect(
      (await registrar(consulta.id, tokenMedico, "<script>x</script>")).status,
    ).toBe(400);
    expect((await registrar(consulta.id, paciente.token)).status).toBe(403);
    expect(
      (await registrar(consulta.id, await autenticar(Perfil.ADMIN))).status,
    ).toBe(403);
  });
});

describe("GET /consultas/:id/prontuario", () => {
  const listar = (consultaId: string, token: string) =>
    requisitar("GET", `/consultas/${consultaId}/prontuario`, { token });

  it("devolve as evoluções em ordem ao paciente, sem auditar a leitura dele", async () => {
    const consulta = await consultaEm(-1);
    await registrar(consulta.id, tokenMedico, "Primeira");
    await registrar(consulta.id, tokenMedico, "Segunda");

    const res = await listar(consulta.id, paciente.token);
    const { data } = await lerJson<{ data: Evolucao[] }>(res);

    expect(res.status).toBe(200);
    expect(data.map((e) => e.conteudo)).toEqual(["Primeira", "Segunda"]);
    expect(
      await prisma.logAuditoria.count({
        where: { acao: "PRONTUARIO_CONSULTADO" },
      }),
    ).toBe(0);
  });

  it("audita a leitura feita por profissional", async () => {
    const consulta = await consultaEm(-1);

    await listar(consulta.id, tokenMedico);

    expect(
      await prisma.logAuditoria.count({
        where: { acao: "PRONTUARIO_CONSULTADO" },
      }),
    ).toBe(1);
  });

  it("responde 404 a outro paciente e 403 ao ADMIN", async () => {
    const consulta = await consultaEm(-1);

    const outro = await listar(consulta.id, (await autenticarPaciente()).token);
    const admin = await listar(consulta.id, await autenticar(Perfil.ADMIN));

    expect(outro.status).toBe(404);
    expect(admin.status).toBe(403);
  });

  it("mantém o acesso do médico da consulta mesmo após mudar de unidade", async () => {
    const consulta = await consultaEm(-1);
    const novaUnidade = await criarProfissional();
    await prisma.profissional.update({
      where: { id: medico.id },
      data: { unidadeId: novaUnidade.unidadeId },
    });

    expect((await listar(consulta.id, tokenMedico)).status).toBe(200);
  });
});

describe("POST /consultas/:id/conclusao", () => {
  it("conclui a consulta iniciada que tem evolução registrada", async () => {
    const consulta = await consultaEm(-1);
    await registrar(consulta.id, tokenMedico);

    const res = await concluir(consulta.id);
    const salva = await prisma.consulta.findUniqueOrThrow({
      where: { id: consulta.id },
    });

    expect(res.status).toBe(204);
    expect(salva.status).toBe("REALIZADA");
  });

  it("exige ao menos uma evolução e não conclui duas vezes", async () => {
    const consulta = await consultaEm(-1);

    const semEvolucao = await concluir(consulta.id);
    await registrar(consulta.id, tokenMedico);
    await concluir(consulta.id);
    const segundaVez = await concluir(consulta.id);

    expect(semEvolucao.status).toBe(409);
    expect(segundaVez.status).toBe(409);
  });

  it("só o profissional da consulta conclui", async () => {
    const consulta = await consultaEm(-1);
    await registrar(consulta.id, tokenMedico);
    const colega = await criarProfissional({ unidadeId: medico.unidadeId });

    const res = await concluir(consulta.id, await tokenDoProfissional(colega));

    expect(res.status).toBe(404);
  });

  it("aceita adendo depois da conclusão (registro somente de inclusão)", async () => {
    const consulta = await consultaEm(-1);
    await registrar(consulta.id, tokenMedico);
    await concluir(consulta.id);

    const adendo = await registrar(
      consulta.id,
      tokenMedico,
      "Adendo: retorno em 30 dias.",
    );

    expect(adendo.status).toBe(201);
    expect(await prisma.registroProntuario.count()).toBe(2);
  });
});
