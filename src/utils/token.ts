// Emissão e verificação do token de acesso (JWT HS256 de curta duração)
import { z } from "@hono/zod-openapi";
import { sign, verify } from "hono/jwt";
import { Perfil } from "../../generated/prisma/client";
import { env } from "../config/env";
import { unauthorized } from "./app-error";

const ALGORITHM = "HS256";

// Claims próprias: só o necessário para autorizar (sem dados pessoais no token)
const tokenPayloadSchema = z.object({
  sub: z.uuid(),
  perfil: z.enum(Perfil),
});

export type TokenPayload = z.infer<typeof tokenPayloadSchema>;

export const signToken = ({ sub, perfil }: TokenPayload) => {
  const now = Math.floor(Date.now() / 1000);

  return sign(
    { sub, perfil, iat: now, exp: now + env.JWT_EXPIRES_IN },
    env.JWT_SECRET,
    ALGORITHM,
  );
};

// Assinatura inválida, token expirado ou claims fora do formato resultam em 401
export const verifyToken = async (token: string): Promise<TokenPayload> => {
  try {
    const payload = await verify(token, env.JWT_SECRET, ALGORITHM);
    return tokenPayloadSchema.parse(payload);
  } catch {
    throw unauthorized("Token inválido ou expirado.");
  }
};
