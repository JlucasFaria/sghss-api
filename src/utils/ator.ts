// Quem executa a ação (usuário autenticado + IP), repassado aos serviços para a auditoria
import type { Context } from "hono";
import { getClientIp } from "./client-ip";

export type Ator = { usuarioId: string; ip: string };

export const getAtor = (c: Context): Ator => ({
  usuarioId: c.get("usuario").id,
  ip: getClientIp(c),
});
