import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import { criarUnidade } from "../../../test/factories";
import { autenticar, lerJson, requisitar } from "../../../test/http";
import { AcaoAuditoria } from "../../auditoria/auditoria.service";

type Lancamento = {
  id: string;
  tipo: string;
  valor: string;
  competencia: string;
};

let token: string;
let unidade: Awaited<ReturnType<typeof criarUnidade>>;

const lancar = (body: object = {}) =>
  requisitar("POST", "/financeiro/lancamentos", {
    token,
    body: {
      unidadeId: unidade.id,
      tipo: "DESPESA",
      categoria: "Suprimentos",
      descricao: "Compra de luvas",
      valor: 1500,
      competencia: "2026-12-01",
      ...body,
    },
  });

beforeEach(async () => {
  await resetDatabase();
  token = await autenticar(Perfil.ADMIN);
  unidade = await criarUnidade();
});

it("é exclusivo do ADMIN", async () => {
  expect((await requisitar("GET", "/financeiro/lancamentos")).status).toBe(401);
  const res = await requisitar("GET", "/financeiro/lancamentos", {
    token: await autenticar(Perfil.MEDICO),
  });
  expect(res.status).toBe(403);
});

describe("registro", () => {
  it("registra com valor em texto de 2 casas e audita", async () => {
    const res = await lancar({ valor: 1234.5 });

    expect(res.status).toBe(201);
    const { data } = await lerJson<{ data: Lancamento }>(res);
    expect(data).toMatchObject({
      tipo: "DESPESA",
      valor: "1234.50",
      competencia: "2026-12-01",
    });
    expect(
      await prisma.logAuditoria.count({
        where: {
          acao: AcaoAuditoria.LANCAMENTO_REGISTRADO,
          entidadeId: data.id,
        },
      }),
    ).toBe(1);
  });

  it.each([
    [{ valor: 0 }, "valor"],
    [{ valor: -10 }, "valor"],
    [{ valor: 1.234 }, "valor"],
    [{ valor: 10_000_000_000 }, "valor"],
    [{ tipo: "OUTRO" }, "tipo"],
    [{ competencia: "01/12/2026" }, "competencia"],
    [{ descricao: "<script>x</script>" }, "descricao"],
  ])("valida o lançamento %j", async (body, campo) => {
    const res = await lancar(body);

    expect(res.status).toBe(400);
    const { error } = await lerJson<{
      error: { details: { field: string }[] };
    }>(res);
    expect(error.details.map((d) => d.field)).toContain(campo);
  });

  it("recusa unidade inativa", async () => {
    const inativa = await criarUnidade({ ativo: false });
    expect((await lancar({ unidadeId: inativa.id })).status).toBe(409);
  });

  it("não expõe rotas de edição ou exclusão", async () => {
    const { data } = await lerJson<{ data: Lancamento }>(await lancar());

    for (const method of ["PUT", "DELETE"]) {
      const res = await requisitar(
        method,
        `/financeiro/lancamentos/${data.id}`,
        { token, body: method === "PUT" ? { valor: 1 } : undefined },
      );
      expect(res.status).toBe(404);
    }
  });
});

describe("listagem", () => {
  it("filtra por tipo e competência, com data final inclusiva", async () => {
    await lancar({ competencia: "2026-11-30" });
    const inicio = await lancar({ competencia: "2026-12-01" });
    const fim = await lancar({ competencia: "2026-12-31" });
    await lancar({ competencia: "2026-12-15", tipo: "RECEITA" });

    const res = await requisitar(
      "GET",
      "/financeiro/lancamentos?tipo=DESPESA&de=2026-12-01&ate=2026-12-31",
      { token },
    );

    const { data } = await lerJson<{ data: Lancamento[] }>(res);
    const ids = await Promise.all(
      [fim, inicio].map(
        async (r) => (await lerJson<{ data: Lancamento }>(r)).data.id,
      ),
    );
    // Competência mais recente primeiro
    expect(data.map((l) => l.id)).toEqual(ids);
  });
});
