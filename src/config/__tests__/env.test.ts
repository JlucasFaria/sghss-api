import { describe, expect, it } from "bun:test";
import { envSchema } from "../env";

const chave = (texto: string) =>
  Buffer.from(texto.padEnd(32, "!")).toString("base64");

const producao = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:s@localhost:5432/sghss",
  CORS_ORIGIN: "https://vidaplus.example",
  JWT_SECRET: "segredo-real-de-producao-com-mais-de-32-caracteres",
  ENCRYPTION_KEY: chave("chave-aes-producao"),
  CPF_HASH_KEY: chave("chave-hmac-producao"),
};

const exemplos = {
  JWT_SECRET: "troque_por_um_segredo_aleatorio_de_32_caracteres_ou_mais",
  ENCRYPTION_KEY: "Y2hhdmUtYWVzLWRlc2Vudm9sdmltZW50by0zMi1ieXQ=",
  CPF_HASH_KEY: "Y2hhdmUtaG1hYy1kZXNlbnZvbHZpbWVudG8tMzItYnk=",
};

describe("envSchema", () => {
  it("aceita configuração de produção com segredos próprios", () => {
    expect(envSchema.safeParse(producao).success).toBe(true);
  });

  it.each(Object.entries(exemplos))(
    "recusa %s com o valor do .env.example em produção",
    (nome, valor) => {
      const result = envSchema.safeParse({ ...producao, [nome]: valor });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual([nome]);
    },
  );

  it("lê TRUST_PROXY como lista de IPs e recusa valores que não são IP", () => {
    const valido = envSchema.safeParse({
      ...producao,
      TRUST_PROXY: "10.0.0.2, ::1",
    });
    expect(valido.data?.TRUST_PROXY).toEqual(["10.0.0.2", "::1"]);
    expect(envSchema.safeParse(producao).data?.TRUST_PROXY).toEqual([]);

    const invalido = envSchema.safeParse({
      ...producao,
      TRUST_PROXY: "10.0.0.0/8",
    });
    expect(invalido.success).toBe(false);
    expect(invalido.error?.issues[0]?.path).toEqual(["TRUST_PROXY"]);
  });

  it("aceita os valores de exemplo em desenvolvimento", () => {
    const result = envSchema.safeParse({
      ...producao,
      ...exemplos,
      NODE_ENV: "development",
    });

    expect(result.success).toBe(true);
  });

  it("recusa chave de criptografia com tamanho diferente de 32 bytes", () => {
    const result = envSchema.safeParse({
      ...producao,
      ENCRYPTION_KEY: Buffer.from("curta").toString("base64"),
    });

    expect(result.success).toBe(false);
  });
});
