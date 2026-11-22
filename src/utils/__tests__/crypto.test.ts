import { describe, expect, it } from "bun:test";
import { decrypt, encrypt, hashCpf } from "../crypto";
import { hashPassword, verifyPassword } from "../password";

describe("criptografia AES-256-GCM", () => {
  it("decifra o valor original", () => {
    expect(decrypt(encrypt("529.982.247-25"))).toBe("529.982.247-25");
  });

  it("não grava o valor em claro e gera cifras diferentes para o mesmo texto", () => {
    const a = encrypt("52998224725");
    const b = encrypt("52998224725");

    expect(a).not.toContain("52998224725");
    expect(a).not.toBe(b);
  });

  it("detecta conteúdo adulterado", () => {
    const [iv, tag] = encrypt("prontuário").split(".");
    const adulterado = `${iv}.${tag}.${btoa("outro conteúdo")}`;

    expect(() => decrypt(adulterado)).toThrow();
  });

  it("rejeita valor fora do formato iv.tag.cifra", () => {
    expect(() => decrypt("sem-separadores")).toThrow(
      "Valor cifrado em formato inválido.",
    );
    expect(() => decrypt(`${encrypt("x")}.extra`)).toThrow(
      "Valor cifrado em formato inválido.",
    );
  });
});

describe("hashCpf (HMAC-SHA-256)", () => {
  it("é determinístico, com 64 caracteres hexadecimais", () => {
    expect(hashCpf("52998224725")).toBe(hashCpf("52998224725"));
    expect(hashCpf("52998224725")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gera hashes diferentes para CPFs diferentes", () => {
    expect(hashCpf("52998224725")).not.toBe(hashCpf("16899535009"));
  });
});

describe("hash de senha", () => {
  it("usa argon2id e confere apenas a senha correta", async () => {
    const hash = await hashPassword("SenhaForte123");

    expect(hash).toStartWith("$argon2id$");
    expect(await verifyPassword("SenhaForte123", hash)).toBe(true);
    expect(await verifyPassword("senhaforte123", hash)).toBe(false);
  });
});
