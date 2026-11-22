import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import { criarUnidade, criarUsuario } from "../../../test/factories";
import { autenticar, lerJson, requisitar, tokenDe } from "../../../test/http";
import { AcaoAuditoria } from "../../auditoria/auditoria.service";

type Suprimento = {
  id: string;
  quantidade: number;
  estoqueMinimo: number;
  estoqueBaixo: boolean;
};
type Movimentacao = {
  movimentacao: { id: string; tipo: string; quantidade: number };
  suprimento: Suprimento;
};

let token: string;
let admin: Awaited<ReturnType<typeof criarUsuario>>;
let unidade: Awaited<ReturnType<typeof criarUnidade>>;

async function cadastrar(estoqueMinimo = 10, unidadeId = unidade.id) {
  const res = await requisitar("POST", "/suprimentos", {
    token,
    body: { unidadeId, nome: "Luva M", unidadeMedida: "caixa", estoqueMinimo },
  });
  return (await lerJson<{ data: Suprimento }>(res)).data;
}

const movimentar = (id: string, body: object) =>
  requisitar("POST", `/suprimentos/${id}/movimentacoes`, { token, body });

const saldo = async (id: string) =>
  (await prisma.suprimento.findUniqueOrThrow({ where: { id } })).quantidade;

beforeEach(async () => {
  await resetDatabase();
  admin = await criarUsuario({ perfil: Perfil.ADMIN });
  token = await tokenDe(admin);
  unidade = await criarUnidade();
});

it("é exclusivo do ADMIN", async () => {
  expect((await requisitar("GET", "/suprimentos")).status).toBe(401);
  const res = await requisitar("GET", "/suprimentos", {
    token: await autenticar(Perfil.ENFERMEIRO),
  });
  expect(res.status).toBe(403);
});

describe("cadastro", () => {
  it("começa com saldo zero (em alerta) e ignora saldo enviado", async () => {
    const res = await requisitar("POST", "/suprimentos", {
      token,
      body: {
        unidadeId: unidade.id,
        nome: "Seringa 5 ml",
        unidadeMedida: "unidade",
        estoqueMinimo: 50,
        quantidade: 999,
      },
    });

    expect(res.status).toBe(201);
    const { data } = await lerJson<{ data: Suprimento }>(res);
    expect(data).toMatchObject({
      quantidade: 0,
      estoqueMinimo: 50,
      estoqueBaixo: true,
    });
  });

  it("recusa unidade inativa e estoque mínimo negativo", async () => {
    const inativa = await criarUnidade({ ativo: false });

    const emInativa = await requisitar("POST", "/suprimentos", {
      token,
      body: { unidadeId: inativa.id, nome: "X", unidadeMedida: "un" },
    });
    const negativo = await requisitar("POST", "/suprimentos", {
      token,
      body: {
        unidadeId: unidade.id,
        nome: "X",
        unidadeMedida: "un",
        estoqueMinimo: -1,
      },
    });

    expect(emInativa.status).toBe(409);
    expect(negativo.status).toBe(400);
  });
});

describe("movimentações", () => {
  it("entrada soma, saída subtrai e o alerta acompanha o saldo", async () => {
    const { id } = await cadastrar(10);

    const entrada = await movimentar(id, { tipo: "ENTRADA", quantidade: 15 });
    expect(entrada.status).toBe(201);
    expect(
      (await lerJson<{ data: Movimentacao }>(entrada)).data.suprimento,
    ).toMatchObject({ quantidade: 15, estoqueBaixo: false });

    const saida = await movimentar(id, {
      tipo: "SAIDA",
      quantidade: 5,
      observacao: "Centro cirúrgico",
    });
    // 10 = mínimo: já está em alerta
    expect(
      (await lerJson<{ data: Movimentacao }>(saida)).data.suprimento,
    ).toMatchObject({ quantidade: 10, estoqueBaixo: true });
  });

  it("registra o responsável e audita cada movimentação", async () => {
    const { id } = await cadastrar();

    await movimentar(id, { tipo: "ENTRADA", quantidade: 3 });

    const [mov] = await prisma.movimentacaoEstoque.findMany();
    expect(mov).toMatchObject({ responsavelId: admin.id, quantidade: 3 });
    const [log] = await prisma.logAuditoria.findMany({
      where: { acao: AcaoAuditoria.ESTOQUE_MOVIMENTADO },
    });
    expect(log).toMatchObject({ usuarioId: admin.id, entidadeId: id });
  });

  it("recusa saída maior que o saldo sem registrar nada", async () => {
    const { id } = await cadastrar();
    await movimentar(id, { tipo: "ENTRADA", quantidade: 5 });

    const res = await movimentar(id, { tipo: "SAIDA", quantidade: 6 });

    expect(res.status).toBe(409);
    expect(await saldo(id)).toBe(5);
    expect(await prisma.movimentacaoEstoque.count()).toBe(1);
  });

  it("saídas simultâneas nunca deixam o saldo negativo", async () => {
    const { id } = await cadastrar();
    await movimentar(id, { tipo: "ENTRADA", quantidade: 5 });

    const respostas = await Promise.all([
      movimentar(id, { tipo: "SAIDA", quantidade: 4 }),
      movimentar(id, { tipo: "SAIDA", quantidade: 4 }),
    ]);

    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await saldo(id)).toBe(1);
  });

  it.each([
    [{ tipo: "SAIDA", quantidade: 0 }, "quantidade"],
    [{ tipo: "SAIDA", quantidade: 1.5 }, "quantidade"],
    [{ tipo: "SAIDA", quantidade: 100_001 }, "quantidade"],
    [{ tipo: "AJUSTE", quantidade: 1 }, "tipo"],
  ])("valida a movimentação %j", async (body, campo) => {
    const { id } = await cadastrar();

    const res = await movimentar(id, body);

    expect(res.status).toBe(400);
    const { error } = await lerJson<{
      error: { details: { field: string }[] };
    }>(res);
    expect(error.details.map((d) => d.field)).toContain(campo);
  });

  it("responde 404 para suprimento inexistente", async () => {
    const res = await movimentar(crypto.randomUUID(), {
      tipo: "ENTRADA",
      quantidade: 1,
    });
    expect(res.status).toBe(404);
  });
});

describe("listagem", () => {
  it("pagina de forma estável com itens de mesmo nome", async () => {
    for (let i = 0; i < 3; i++) await cadastrar();

    const ids: string[] = [];
    for (const page of [1, 2]) {
      const res = await requisitar("GET", `/suprimentos?limit=2&page=${page}`, {
        token,
      });
      ids.push(
        ...(await lerJson<{ data: Suprimento[] }>(res)).data.map((s) => s.id),
      );
    }

    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([...ids].sort());
  });

  it("filtra os itens em alerta e por unidade", async () => {
    const baixo = await cadastrar(10);
    const ok = await cadastrar(1);
    await movimentar(ok.id, { tipo: "ENTRADA", quantidade: 5 });
    const outraUnidade = await cadastrar(10, (await criarUnidade()).id);

    const listar = async (query: string) => {
      const res = await requisitar("GET", `/suprimentos${query}`, { token });
      const { data } = await lerJson<{ data: Suprimento[] }>(res);
      return data.map((s) => s.id).sort();
    };

    expect(await listar("?estoqueBaixo=true")).toEqual(
      [baixo.id, outraUnidade.id].sort(),
    );
    expect(await listar(`?estoqueBaixo=true&unidadeId=${unidade.id}`)).toEqual([
      baixo.id,
    ]);
    expect(await listar("")).toHaveLength(3);
  });
});
