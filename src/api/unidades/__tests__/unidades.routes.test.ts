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
import type { PaginationMeta } from "../../../utils/pagination";
import type { ErrorResponse } from "../../../utils/response";

type Unidade = { id: string; nome: string; uf: string; ativo: boolean };

const dados = {
  nome: "Clínica VidaPlus Sul",
  tipo: "CLINICA",
  endereco: "Rua das Araucárias, 50",
  cidade: "Curitiba",
  uf: "pr",
};

let admin: string;
let paciente: string;

beforeEach(async () => {
  await resetDatabase();
  admin = await autenticar(Perfil.ADMIN);
  paciente = await autenticar(Perfil.PACIENTE);
});

describe("POST /unidades", () => {
  it("cadastra a unidade, normaliza a UF e audita", async () => {
    const res = await requisitar("POST", "/unidades", {
      token: admin,
      body: dados,
    });
    const { data } = await lerJson<{ data: Unidade }>(res);

    expect(res.status).toBe(201);
    expect(data).toMatchObject({ nome: dados.nome, uf: "PR", ativo: true });
    expect(
      await prisma.logAuditoria.count({
        where: { acao: "UNIDADE_CRIADA", entidadeId: data.id },
      }),
    ).toBe(1);
  });

  it("responde 403 para quem não é ADMIN", async () => {
    const res = await requisitar("POST", "/unidades", {
      token: paciente,
      body: dados,
    });

    expect(res.status).toBe(403);
  });

  it("responde 401 sem token", async () => {
    expect(
      (await requisitar("POST", "/unidades", { body: dados })).status,
    ).toBe(401);
  });

  it.each([
    ["UF inexistente", { uf: "XX" }, "uf"],
    ["tipo inválido", { tipo: "FARMACIA" }, "tipo"],
    ["HTML no nome", { nome: "<b>Clínica</b>" }, "nome"],
  ])("responde 400 com %s", async (_, campos, campo) => {
    const res = await requisitar("POST", "/unidades", {
      token: admin,
      body: { ...dados, ...campos },
    });
    const body = await lerJson<ErrorResponse>(res);

    expect(res.status).toBe(400);
    expect(body.error.details?.map((d) => d.field)).toContain(campo);
  });
});

describe("GET /unidades", () => {
  it("lista paginado em ordem alfabética", async () => {
    await criarUnidade({ nome: "B" });
    await criarUnidade({ nome: "A" });
    await criarUnidade({ nome: "C" });

    const res = await requisitar("GET", "/unidades?page=1&limit=2", {
      token: paciente,
    });
    const body = await lerJson<{ data: Unidade[]; meta: PaginationMeta }>(res);

    expect(res.status).toBe(200);
    expect(body.data.map((u) => u.nome)).toEqual(["A", "B"]);
    expect(body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it("mostra unidades inativas só para o ADMIN", async () => {
    await criarUnidade({ ativo: false });

    const paraPaciente = await requisitar("GET", "/unidades", {
      token: paciente,
    });
    const paraAdmin = await requisitar("GET", "/unidades", { token: admin });

    expect(
      (await lerJson<{ meta: PaginationMeta }>(paraPaciente)).meta.total,
    ).toBe(0);
    expect(
      (await lerJson<{ meta: PaginationMeta }>(paraAdmin)).meta.total,
    ).toBe(1);
  });

  it("filtra por tipo", async () => {
    await criarUnidade({ tipo: "HOSPITAL" });
    await criarUnidade({ tipo: "LABORATORIO" });

    const res = await requisitar("GET", "/unidades?tipo=LABORATORIO", {
      token: paciente,
    });

    expect((await lerJson<{ meta: PaginationMeta }>(res)).meta.total).toBe(1);
  });
});

describe("GET /unidades/:id", () => {
  it("responde 404 para unidade inexistente e 400 para id inválido", async () => {
    const inexistente = await requisitar(
      "GET",
      `/unidades/${crypto.randomUUID()}`,
      {
        token: paciente,
      },
    );
    const invalido = await requisitar("GET", "/unidades/123", {
      token: paciente,
    });

    expect(inexistente.status).toBe(404);
    expect(invalido.status).toBe(400);
  });
});

describe("PUT e DELETE /unidades/:id", () => {
  it("atualiza os dados da unidade", async () => {
    const unidade = await criarUnidade();

    const res = await requisitar("PUT", `/unidades/${unidade.id}`, {
      token: admin,
      body: { ...dados, nome: "Novo Nome" },
    });

    expect(res.status).toBe(200);
    expect((await lerJson<{ data: Unidade }>(res)).data.nome).toBe("Novo Nome");
  });

  it("inativa com DELETE e reativa com PUT, preservando o registro", async () => {
    const unidade = await criarUnidade();

    const removida = await requisitar("DELETE", `/unidades/${unidade.id}`, {
      token: admin,
    });
    const inativa = await prisma.unidade.findUniqueOrThrow({
      where: { id: unidade.id },
    });
    const reativada = await requisitar("PUT", `/unidades/${unidade.id}`, {
      token: admin,
      body: { ...dados, ativo: true },
    });

    expect(removida.status).toBe(204);
    expect(inativa.ativo).toBe(false);
    expect((await lerJson<{ data: Unidade }>(reativada)).data.ativo).toBe(true);
  });

  it("recusa inativar unidade com paciente internado, até a alta", async () => {
    const unidade = await criarUnidade();
    const leito = await criarLeito({
      unidadeId: unidade.id,
      status: "OCUPADO",
    });
    const internacao = await prisma.internacao.create({
      data: {
        pacienteId: (await criarPaciente()).id,
        leitoId: leito.id,
        motivo: "Observação",
      },
    });

    const porDelete = await requisitar("DELETE", `/unidades/${unidade.id}`, {
      token: admin,
    });
    const porPut = await requisitar("PUT", `/unidades/${unidade.id}`, {
      token: admin,
      body: { ...dados, ativo: false },
    });
    expect(porDelete.status).toBe(409);
    expect(porPut.status).toBe(409);
    expect(
      (await prisma.unidade.findUniqueOrThrow({ where: { id: unidade.id } }))
        .ativo,
    ).toBe(true);

    await prisma.internacao.update({
      where: { id: internacao.id },
      data: { altaEm: new Date() },
    });
    const depoisDaAlta = await requisitar("DELETE", `/unidades/${unidade.id}`, {
      token: admin,
    });
    expect(depoisDaAlta.status).toBe(204);
  });

  it("responde 404 ao inativar unidade inexistente", async () => {
    const res = await requisitar("DELETE", `/unidades/${crypto.randomUUID()}`, {
      token: admin,
    });

    expect(res.status).toBe(404);
  });
});

describe("GET /unidades/:id de unidade inativa", () => {
  it("responde 404 para quem não é ADMIN e 200 para o ADMIN", async () => {
    const unidade = await criarUnidade({ ativo: false });

    const paraPaciente = await requisitar("GET", `/unidades/${unidade.id}`, {
      token: paciente,
    });
    const paraAdmin = await requisitar("GET", `/unidades/${unidade.id}`, {
      token: admin,
    });

    expect(paraPaciente.status).toBe(404);
    expect(paraAdmin.status).toBe(200);
  });
});
