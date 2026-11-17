import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { cpfSchema, isValidCpf, phoneSchema, safeText } from "../validators";

describe("isValidCpf", () => {
  it.each(["529.982.247-25", "52998224725", "111.444.777-35"])(
    "aceita CPF com dígitos verificadores corretos: %s",
    (cpf) => {
      expect(isValidCpf(cpf)).toBe(true);
    },
  );

  it.each([
    ["dígito verificador errado", "529.982.247-24"],
    ["todos os dígitos iguais", "111.111.111-11"],
    ["menos de 11 dígitos", "5299822472"],
    ["mais de 11 dígitos", "529982247250"],
  ])("rejeita CPF com %s", (_, cpf) => {
    expect(isValidCpf(cpf)).toBe(false);
  });
});

describe("cpfSchema", () => {
  it("normaliza o CPF para apenas dígitos", () => {
    expect(cpfSchema.parse("529.982.247-25")).toBe("52998224725");
  });

  it("rejeita CPF inválido com mensagem em português", () => {
    const result = cpfSchema.safeParse("123.456.789-00");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("CPF inválido.");
  });

  it("rejeita CPF com letras ou formato inesperado", () => {
    expect(cpfSchema.safeParse("529a982b247c25").success).toBe(false);
  });
});

describe("phoneSchema", () => {
  it.each([
    ["(11) 98765-4321", "11987654321"],
    ["+55 11 98765-4321", "11987654321"],
    ["(41) 3265-4321", "4132654321"],
  ])("aceita e normaliza %s", (input, expected) => {
    expect(phoneSchema.parse(input)).toBe(expected);
  });

  it.each([
    ["sem DDD", "98765-4321"],
    ["DDD iniciando em zero", "(01) 98765-4321"],
    ["celular sem o 9 inicial", "(11) 88765-43210"],
    ["letras", "telefone"],
  ])("rejeita telefone %s", (_, input) => {
    expect(phoneSchema.safeParse(input).success).toBe(false);
  });
});

describe("safeText", () => {
  const pacienteSchema = z.object({ nome: safeText(120) });

  it("aceita nome comum com acentos e remove espaços nas pontas", () => {
    expect(pacienteSchema.parse({ nome: "  Maria Conceição  " })).toEqual({
      nome: "Maria Conceição",
    });
  });

  it("rejeita <script> no nome (proteção contra XSS na entrada)", () => {
    const result = pacienteSchema.safeParse({
      nome: "<script>alert('xss')</script>",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Não é permitido HTML ou script neste campo.",
    );
  });

  it.each(["<img src=x onerror=alert(1)>", "</b>", "<!-- comentario -->"])(
    "rejeita marcação HTML: %s",
    (nome) => {
      expect(pacienteSchema.safeParse({ nome }).success).toBe(false);
    },
  );

  it("permite o sinal de menor em texto comum", () => {
    expect(safeText().safeParse("pressão < 12 por 8").success).toBe(true);
  });

  it("rejeita texto vazio e acima do limite", () => {
    expect(safeText(5).safeParse("   ").success).toBe(false);
    expect(safeText(5).safeParse("123456").success).toBe(false);
  });
});
