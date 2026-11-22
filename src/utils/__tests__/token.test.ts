import { describe, expect, it } from "bun:test";
import { sign } from "hono/jwt";
import { env } from "../../config/env";
import { signToken, verifyToken } from "../token";

const sub = crypto.randomUUID();
const now = () => Math.floor(Date.now() / 1000);

describe("token de acesso (JWT)", () => {
  it("emite token verificável com id e perfil do usuário", async () => {
    const token = await signToken({ sub, perfil: "MEDICO" });

    expect(await verifyToken(token)).toEqual({ sub, perfil: "MEDICO" });
  });

  it("expira conforme JWT_EXPIRES_IN", async () => {
    const token = await signToken({ sub, perfil: "ADMIN" });
    const payload = JSON.parse(atob(token.split(".")[1]!)) as {
      iat: number;
      exp: number;
    };

    expect(payload.exp - payload.iat).toBe(env.JWT_EXPIRES_IN);
  });

  it.each([
    [
      "expirado",
      () =>
        sign(
          { sub, perfil: "ADMIN", exp: now() - 10 },
          env.JWT_SECRET,
          "HS256",
        ),
    ],
    [
      "assinado com outro segredo",
      () =>
        sign(
          { sub, perfil: "ADMIN", exp: now() + 60 },
          "outro-segredo-com-mais-de-32-caracteres!!",
          "HS256",
        ),
    ],
    [
      "com perfil inexistente",
      () =>
        sign({ sub, perfil: "ROOT", exp: now() + 60 }, env.JWT_SECRET, "HS256"),
    ],
  ])("rejeita token %s com 401", async (_, gerar) => {
    const erro = await verifyToken(await gerar()).catch((e: unknown) => e);

    expect(erro).toMatchObject({ status: 401, code: "NAO_AUTENTICADO" });
  });

  it("rejeita token adulterado", async () => {
    const token = await signToken({ sub, perfil: "PACIENTE" });
    const [header, , signature] = token.split(".");
    const payloadAdmin = btoa(JSON.stringify({ sub, perfil: "ADMIN" }));

    const erro = await verifyToken(
      `${header}.${payloadAdmin}.${signature}`,
    ).catch((e: unknown) => e);

    expect(erro).toMatchObject({ status: 401 });
  });
});
