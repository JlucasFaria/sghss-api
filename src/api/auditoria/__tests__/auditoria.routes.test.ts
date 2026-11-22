import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import { criarUsuario } from "../../../test/factories";
import { autenticar, lerJson, requisitar, tokenDe } from "../../../test/http";
import type { PaginationMeta } from "../../../utils/pagination";
import { AcaoAuditoria } from "../auditoria.service";

type Log = {
  id: string;
  usuarioId: string | null;
  acao: string;
  entidade: string;
  ip: string;
  criadoEm: string;
};
type Pagina = { data: Log[]; meta: PaginationMeta };
type Erro = { error: { details?: { field: string }[] } };

let admin: Awaited<ReturnType<typeof criarUsuario>>;
let token: string;

const criarLog = (data: { usuarioId?: string; acao: string; criadoEm: Date }) =>
  prisma.logAuditoria.create({
    data: { entidade: "usuario", ip: "10.0.0.1", ...data },
  });

// Lista os registros pedidos, ignorando o log da própria consulta (gravado depois)
async function listar(query = "") {
  const res = await requisitar("GET", `/auditoria${query}`, { token });
  expect(res.status).toBe(200);
  return lerJson<Pagina>(res);
}

beforeEach(async () => {
  await resetDatabase();
  admin = await criarUsuario({ perfil: Perfil.ADMIN });
  token = await tokenDe(admin);
});

describe("acesso", () => {
  it("é exclusivo do ADMIN", async () => {
    expect((await requisitar("GET", "/auditoria")).status).toBe(401);
    for (const perfil of [Perfil.PACIENTE, Perfil.MEDICO, Perfil.ENFERMEIRO]) {
      const res = await requisitar("GET", "/auditoria", {
        token: await autenticar(perfil),
      });
      expect(res.status).toBe(403);
    }
  });

  it("não expõe rotas de alteração ou exclusão (RNF05)", async () => {
    const log = await criarLog({ acao: "LOGIN", criadoEm: new Date() });

    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await requisitar(method, `/auditoria/${log.id}`, {
        token,
        body: method === "DELETE" ? undefined : { acao: "OUTRA" },
      });
      expect(res.status).toBe(404);
    }
    expect(
      await prisma.logAuditoria.findUnique({ where: { id: log.id } }),
    ).toMatchObject({ acao: "LOGIN" });
  });

  it("audita a própria consulta à trilha", async () => {
    await listar();

    const logs = await prisma.logAuditoria.findMany({
      where: { acao: AcaoAuditoria.AUDITORIA_CONSULTADA },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      usuarioId: admin.id,
      entidade: "log_auditoria",
    });
  });
});

describe("filtros", () => {
  it("lista do mais recente para o mais antigo, com paginação", async () => {
    const antigo = await criarLog({
      acao: "LOGIN",
      criadoEm: new Date("2026-01-01T12:00:00Z"),
    });
    const recente = await criarLog({
      acao: "LOGIN",
      criadoEm: new Date("2026-02-01T12:00:00Z"),
    });

    const { data, meta } = await listar("?limit=1&page=2");

    // A consulta anterior não interfere: o log dela é gravado depois da leitura
    expect(data.map((l) => l.id)).toEqual([antigo.id]);
    expect(meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });

    const primeira = await listar("?acao=LOGIN&limit=1");
    expect(primeira.data[0]?.id).toBe(recente.id);
  });

  it("filtra por usuário e por ação", async () => {
    const outro = await criarUsuario();
    const agora = new Date();
    const alvo = await criarLog({
      usuarioId: outro.id,
      acao: "LOGIN",
      criadoEm: agora,
    });
    await criarLog({
      usuarioId: outro.id,
      acao: "LOGIN_FALHA",
      criadoEm: agora,
    });
    await criarLog({ usuarioId: admin.id, acao: "LOGIN", criadoEm: agora });

    const porUsuario = await listar(`?usuarioId=${outro.id}`);
    expect(porUsuario.data).toHaveLength(2);
    expect(porUsuario.data.every((l) => l.usuarioId === outro.id)).toBe(true);

    const combinado = await listar(`?usuarioId=${outro.id}&acao=LOGIN`);
    expect(combinado.data.map((l) => l.id)).toEqual([alvo.id]);
  });

  it("filtra por período no horário de Brasília, com data final inclusiva", async () => {
    // 10/03 às 23h em Brasília ainda é dia 10, embora já seja dia 11 em UTC
    const noDia = await criarLog({
      acao: "LOGIN",
      criadoEm: new Date("2026-03-10T12:00:00Z"),
    });
    const fimDoDia = await criarLog({
      acao: "LOGIN",
      criadoEm: new Date("2026-03-11T02:00:00Z"),
    });
    await criarLog({
      acao: "LOGIN",
      criadoEm: new Date("2026-03-11T04:00:00Z"),
    });
    await criarLog({
      acao: "LOGIN",
      criadoEm: new Date("2026-03-09T12:00:00Z"),
    });

    const { data } = await listar("?de=2026-03-10&ate=2026-03-10");

    expect(data.map((l) => l.id)).toEqual([fimDoDia.id, noDia.id]);
  });

  it.each([
    ["?de=2026-03-10&ate=2026-03-01", "ate"],
    ["?de=10/03/2026", "de"],
    ["?acao=INEXISTENTE", "acao"],
    ["?usuarioId=123", "usuarioId"],
  ])("rejeita filtro inválido %s", async (query, campo) => {
    const res = await requisitar("GET", `/auditoria${query}`, { token });

    expect(res.status).toBe(400);
    const { error } = await lerJson<Erro>(res);
    expect(error.details?.map((d) => d.field)).toContain(campo);
  });
});
