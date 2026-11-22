import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import {
  criarLeito,
  criarPaciente,
  criarUnidade,
} from "../../../test/factories";
import { autenticar, lerJson, requisitar } from "../../../test/http";
import { AcaoAuditoria } from "../../auditoria/auditoria.service";

type Leito = { id: string; codigo: string; status: string; ala: string };

let token: string;
let unidade: Awaited<ReturnType<typeof criarUnidade>>;

const dados = { codigo: "ENF-101", ala: "Clínica Médica", tipo: "ENFERMARIA" };

const atualizar = (id: string, body: object) =>
  requisitar("PUT", `/leitos/${id}`, { token, body: { ...dados, ...body } });

beforeEach(async () => {
  await resetDatabase();
  token = await autenticar(Perfil.ADMIN);
  unidade = await criarUnidade();
});

it("é exclusivo do ADMIN", async () => {
  expect((await requisitar("GET", "/leitos")).status).toBe(401);
  for (const perfil of [Perfil.MEDICO, Perfil.ENFERMEIRO, Perfil.PACIENTE]) {
    const res = await requisitar("GET", "/leitos", {
      token: await autenticar(perfil),
    });
    expect(res.status).toBe(403);
  }
});

describe("cadastro", () => {
  it("cadastra o leito LIVRE e audita", async () => {
    const res = await requisitar("POST", "/leitos", {
      token,
      body: { ...dados, unidadeId: unidade.id },
    });

    expect(res.status).toBe(201);
    const { data } = await lerJson<{ data: Leito }>(res);
    expect(data).toMatchObject({ codigo: "ENF-101", status: "LIVRE" });
    expect(
      await prisma.logAuditoria.count({
        where: { acao: AcaoAuditoria.LEITO_CRIADO, entidadeId: data.id },
      }),
    ).toBe(1);
  });

  it("ignora status enviado no cadastro", async () => {
    const res = await requisitar("POST", "/leitos", {
      token,
      body: { ...dados, unidadeId: unidade.id, status: "OCUPADO" },
    });
    expect((await lerJson<{ data: Leito }>(res)).data.status).toBe("LIVRE");
  });

  it("recusa código repetido na mesma unidade, mas aceita em outra", async () => {
    await criarLeito({ unidadeId: unidade.id, codigo: "ENF-101" });
    const outra = await criarUnidade();

    const repetido = await requisitar("POST", "/leitos", {
      token,
      body: { ...dados, unidadeId: unidade.id },
    });
    const emOutra = await requisitar("POST", "/leitos", {
      token,
      body: { ...dados, unidadeId: outra.id },
    });

    expect(repetido.status).toBe(409);
    expect(emOutra.status).toBe(201);
  });

  it("recusa unidade inexistente (404) ou inativa (409)", async () => {
    const inativa = await criarUnidade({ ativo: false });
    const cadastrar = (unidadeId: string) =>
      requisitar("POST", "/leitos", {
        token,
        body: { ...dados, unidadeId },
      });

    expect((await cadastrar(crypto.randomUUID())).status).toBe(404);
    expect((await cadastrar(inativa.id)).status).toBe(409);
  });
});

describe("consulta", () => {
  it("lista com filtros por unidade, status e tipo", async () => {
    const outra = await criarUnidade();
    const alvo = await criarLeito({
      unidadeId: unidade.id,
      tipo: "UTI",
      status: "MANUTENCAO",
    });
    await criarLeito({ unidadeId: unidade.id, tipo: "UTI" });
    await criarLeito({ unidadeId: outra.id, status: "MANUTENCAO" });

    const res = await requisitar(
      "GET",
      `/leitos?unidadeId=${unidade.id}&status=MANUTENCAO&tipo=UTI`,
      { token },
    );

    const { data, meta } = await lerJson<{
      data: Leito[];
      meta: { total: number };
    }>(res);
    expect(data.map((l) => l.id)).toEqual([alvo.id]);
    expect(meta.total).toBe(1);
  });

  it("consulta um leito pelo id (404 se não existe)", async () => {
    const leito = await criarLeito({ unidadeId: unidade.id });

    const res = await requisitar("GET", `/leitos/${leito.id}`, { token });
    expect((await lerJson<{ data: Leito }>(res)).data.id).toBe(leito.id);

    const inexistente = await requisitar(
      "GET",
      `/leitos/${crypto.randomUUID()}`,
      { token },
    );
    expect(inexistente.status).toBe(404);
  });
});

describe("atualização", () => {
  it("coloca em manutenção e devolve para LIVRE", async () => {
    const leito = await criarLeito({ unidadeId: unidade.id });

    const manutencao = await atualizar(leito.id, { status: "MANUTENCAO" });
    expect((await lerJson<{ data: Leito }>(manutencao)).data.status).toBe(
      "MANUTENCAO",
    );

    const livre = await atualizar(leito.id, { status: "LIVRE" });
    expect((await lerJson<{ data: Leito }>(livre)).data.status).toBe("LIVRE");
  });

  it("não aceita OCUPADO como status manual", async () => {
    const leito = await criarLeito({ unidadeId: unidade.id });

    expect((await atualizar(leito.id, { status: "OCUPADO" })).status).toBe(400);
  });

  it("em leito ocupado, corrige os dados mas não muda o status", async () => {
    const leito = await criarLeito({
      unidadeId: unidade.id,
      status: "OCUPADO",
    });

    const dadosNovos = await atualizar(leito.id, { ala: "Ala Nova" });
    expect(dadosNovos.status).toBe(200);
    expect((await lerJson<{ data: Leito }>(dadosNovos)).data).toMatchObject({
      ala: "Ala Nova",
      status: "OCUPADO",
    });

    const status = await atualizar(leito.id, { status: "MANUTENCAO" });
    expect(status.status).toBe(409);
    expect(
      (await prisma.leito.findUniqueOrThrow({ where: { id: leito.id } }))
        .status,
    ).toBe("OCUPADO");
  });
});

describe("exclusão", () => {
  it("exclui leito sem histórico", async () => {
    const leito = await criarLeito({ unidadeId: unidade.id });

    const res = await requisitar("DELETE", `/leitos/${leito.id}`, { token });

    expect(res.status).toBe(204);
    expect(await prisma.leito.count()).toBe(0);
  });

  it("recusa excluir leito com internação no histórico", async () => {
    const leito = await criarLeito({ unidadeId: unidade.id });
    const paciente = await criarPaciente();
    await prisma.internacao.create({
      data: {
        pacienteId: paciente.id,
        leitoId: leito.id,
        motivo: "Observação",
        altaEm: new Date(),
      },
    });

    const res = await requisitar("DELETE", `/leitos/${leito.id}`, { token });

    expect(res.status).toBe(409);
    expect(await prisma.leito.count()).toBe(1);
  });
});
