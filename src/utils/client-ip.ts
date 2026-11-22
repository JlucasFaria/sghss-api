// IP do cliente para auditoria, consentimento e rate limit
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

// Usa o endereço da conexão TCP, que o cliente não consegue forjar (ao contrário
// do X-Forwarded-For). Sem servidor Bun (ex.: app.request nos testes) não há conexão.
export const getClientIp = (c: Context): string => {
  try {
    return getConnInfo(c).remote.address ?? "desconhecido";
  } catch {
    return "desconhecido";
  }
};
