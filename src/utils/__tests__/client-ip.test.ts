import { describe, expect, it } from "bun:test";
import { resolverIpCliente } from "../client-ip";

const PROXY = "10.0.0.2";
const CONFIAVEIS = [PROXY];

describe("resolverIpCliente", () => {
  it("sem proxy configurado, usa a conexão e ignora o X-Forwarded-For", () => {
    expect(resolverIpCliente("203.0.113.7", "1.1.1.1", [])).toBe("203.0.113.7");
  });

  it("ignora o X-Forwarded-For de conexão que não vem do proxy confiável", () => {
    // Cliente falando direto com a API tentando se passar por outro IP
    expect(resolverIpCliente("203.0.113.7", "1.1.1.1", CONFIAVEIS)).toBe(
      "203.0.113.7",
    );
  });

  it("atrás do proxy confiável, usa o IP que o proxy registrou", () => {
    expect(resolverIpCliente(PROXY, "198.51.100.20", CONFIAVEIS)).toBe(
      "198.51.100.20",
    );
  });

  it("descarta entradas forjadas à esquerda pelo cliente", () => {
    // O cliente enviou "X-Forwarded-For: 1.1.1.1"; o proxy acrescentou o IP real
    expect(resolverIpCliente(PROXY, "1.1.1.1, 198.51.100.20", CONFIAVEIS)).toBe(
      "198.51.100.20",
    );
  });

  it("pula os proxies confiáveis encadeados", () => {
    const confiaveis = [PROXY, "10.0.0.3"];
    expect(
      resolverIpCliente(PROXY, "198.51.100.20, 10.0.0.3", confiaveis),
    ).toBe("198.51.100.20");
  });

  it("normaliza IPv4 mapeado em IPv6", () => {
    expect(
      resolverIpCliente("::ffff:10.0.0.2", "::ffff:198.51.100.20", CONFIAVEIS),
    ).toBe("198.51.100.20");
  });

  it("volta para a conexão se o cabeçalho estiver ausente ou malformado", () => {
    expect(resolverIpCliente(PROXY, undefined, CONFIAVEIS)).toBe(PROXY);
    expect(resolverIpCliente(PROXY, "nao-e-ip", CONFIAVEIS)).toBe(PROXY);
  });

  it("responde desconhecido sem endereço de conexão", () => {
    expect(resolverIpCliente(undefined, "1.1.1.1", CONFIAVEIS)).toBe(
      "desconhecido",
    );
  });
});
