import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { Perfil } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { resetDatabase } from "../../test/db";
import { criarUsuario } from "../../test/factories";
import type { ErrorResponse } from "../../utils/response";
import { signToken } from "../../utils/token";
import { authenticate, requireRole } from "../auth";
import { errorHandler } from "../error-handler";

const router = new Hono()
  .get("/privada", authenticate, (c) => c.json({ data: c.get("usuario") }))
  .get(
    "/clinica",
    authenticate,
    requireRole(Perfil.MEDICO, Perfil.ENFERMEIRO),
    (c) => c.text("ok"),
  )
  .onError(errorHandler);

const tokenDe = async (perfil: Perfil) => {
  const usuario = await criarUsuario({ perfil });
  return { usuario, token: await signToken({ sub: usuario.id, perfil }) };
};

const get = (path: string, token?: string) =>
  router.request(
    path,
    token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  );

describe("authenticate", () => {
  beforeEach(resetDatabase);

  it("injeta o usuário do token no contexto", async () => {
    const { usuario, token } = await tokenDe(Perfil.PACIENTE);

    const res = await get("/privada", token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: usuario.id, perfil: "PACIENTE" },
    });
  });

  it("responde 401 sem token", async () => {
    const res = await get("/privada");
    const body = (await res.json()) as ErrorResponse;

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("NAO_AUTENTICADO");
  });

  it("responde 401 com esquema diferente de Bearer", async () => {
    const { token } = await tokenDe(Perfil.PACIENTE);

    const res = await router.request("/privada", {
      headers: { Authorization: `Basic ${token}` },
    });

    expect(res.status).toBe(401);
  });

  it("responde 401 com token inválido", async () => {
    expect((await get("/privada", "nao-e-um-jwt")).status).toBe(401);
  });

  it("responde 401 quando o usuário foi inativado depois da emissão do token", async () => {
    const { usuario, token } = await tokenDe(Perfil.MEDICO);
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { ativo: false },
    });

    expect((await get("/privada", token)).status).toBe(401);
  });

  it("usa o perfil atual do banco, não o do token", async () => {
    const { usuario, token } = await tokenDe(Perfil.MEDICO);
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { perfil: Perfil.PACIENTE },
    });

    expect((await get("/clinica", token)).status).toBe(403);
  });
});

describe("requireRole", () => {
  beforeEach(resetDatabase);

  it.each([Perfil.MEDICO, Perfil.ENFERMEIRO])(
    "permite o perfil autorizado %s",
    async (perfil) => {
      const { token } = await tokenDe(perfil);

      expect((await get("/clinica", token)).status).toBe(200);
    },
  );

  it.each([Perfil.PACIENTE, Perfil.TECNICO, Perfil.ADMIN])(
    "responde 403 ao perfil sem permissão %s",
    async (perfil) => {
      const { token } = await tokenDe(perfil);

      const res = await get("/clinica", token);
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(403);
      expect(body.error.code).toBe("ACESSO_NEGADO");
    },
  );

  it("responde 401 se usado sem autenticação", async () => {
    const semAuth = new Hono()
      .get("/", requireRole(Perfil.ADMIN), (c) => c.text("ok"))
      .onError(errorHandler);

    expect((await semAuth.request("/")).status).toBe(401);
  });
});
