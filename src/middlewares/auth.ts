// Autenticação (token Bearer → usuário no contexto) e autorização por perfil (RBAC)
import { createMiddleware } from "hono/factory";
import type { Perfil } from "../../generated/prisma/client";
import { prisma } from "../db/client";
import { forbidden, unauthorized } from "../utils/app-error";
import { verifyToken } from "../utils/token";

export type UsuarioAutenticado = { id: string; perfil: Perfil };

declare module "hono" {
  interface ContextVariableMap {
    usuario: UsuarioAutenticado;
  }
}

export const authenticate = createMiddleware(async (c, next) => {
  const [scheme, token] = c.req.header("Authorization")?.split(" ") ?? [];
  // O esquema de autenticação não diferencia maiúsculas (RFC 7235)
  if (scheme?.toLowerCase() !== "bearer" || !token) throw unauthorized();

  const { sub } = await verifyToken(token);

  // Consulta o banco a cada requisição: inativação e troca de perfil valem na hora,
  // sem esperar o token expirar
  const usuario = await prisma.usuario.findUnique({
    where: { id: sub },
    select: { id: true, perfil: true, ativo: true },
  });
  if (!usuario?.ativo) throw unauthorized("Token inválido ou expirado.");

  c.set("usuario", { id: usuario.id, perfil: usuario.perfil });
  await next();
});

// Autorização por perfil (RBAC). Usar depois de `authenticate`:
// middleware: [authenticate, requireRole(Perfil.ADMIN)]
export const requireRole = (...perfis: Perfil[]) =>
  createMiddleware(async (c, next) => {
    const usuario = c.get("usuario");
    if (!usuario) throw unauthorized();
    if (!perfis.includes(usuario.perfil)) throw forbidden();
    await next();
  });
