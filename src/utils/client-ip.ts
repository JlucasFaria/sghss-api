// IP do cliente para auditoria, consentimento e rate limit
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { isIP } from "node:net";
import { env } from "../config/env";

const DESCONHECIDO = "desconhecido";

// IPv4 que chega pela pilha IPv6 vem como "::ffff:10.0.0.1"
const normalizar = (ip: string) => ip.trim().replace(/^::ffff:/i, "");

// Por padrão vale o endereço da conexão TCP, que o cliente não consegue forjar. Só
// quando a conexão vem de um proxy confiável o X-Forwarded-For é lido, da direita para
// a esquerda: cada proxy acrescenta à direita o IP de quem o chamou, então o primeiro
// endereço não confiável é o do cliente. Entradas à esquerda dele podem ter sido
// forjadas pelo próprio cliente e são ignoradas.
export function resolverIpCliente(
  remoto: string | undefined,
  forwardedFor: string | undefined,
  confiaveis: readonly string[],
): string {
  if (!remoto) return DESCONHECIDO;
  const conexao = normalizar(remoto);
  if (!confiaveis.includes(conexao) || !forwardedFor) return conexao;

  const cadeia = forwardedFor.split(",").map(normalizar).reverse();
  for (const ip of cadeia) {
    if (confiaveis.includes(ip)) continue;
    // Valor malformado: não confia no cabeçalho e usa o endereço da conexão
    return isIP(ip) ? ip : conexao;
  }
  // Toda a cadeia é de proxies confiáveis: o mais distante é o melhor que se sabe
  return cadeia.at(-1) ?? conexao;
}

export const getClientIp = (c: Context): string => {
  let remoto: string | undefined;
  try {
    remoto = getConnInfo(c).remote.address;
  } catch {
    // Sem servidor Bun (ex.: app.request nos testes) não há conexão
    return DESCONHECIDO;
  }
  return resolverIpCliente(
    remoto,
    c.req.header("X-Forwarded-For"),
    env.TRUST_PROXY,
  );
};
