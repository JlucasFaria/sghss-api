// Quem executa a ação (usuário autenticado, perfil e IP), repassado aos serviços
// para regras de acesso e para a auditoria
import type { Context } from "hono";
import type { Perfil } from "../../generated/prisma/client";
import { getClientIp } from "./client-ip";

export type Ator = { usuarioId: string; perfil: Perfil; ip: string };

export const getAtor = (c: Context): Ator => {
  const { id, perfil } = c.get("usuario");
  return { usuarioId: id, perfil, ip: getClientIp(c) };
};
