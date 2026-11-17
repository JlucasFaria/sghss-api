// Validadores reutilizáveis na borda da API: CPF, telefone e texto livre sem HTML
import { z } from "zod";

export const onlyDigits = (value: string) => value.replace(/\D/g, "");

// Calcula os dois dígitos verificadores do CPF (módulo 11)
export const isValidCpf = (value: string): boolean => {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map(Number);
  const checkDigit = (length: number) => {
    const sum = digits
      .slice(0, length)
      .reduce((acc, digit, i) => acc + digit * (length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return checkDigit(9) === digits[9] && checkDigit(10) === digits[10];
};

// Aceita "123.456.789-09" ou "12345678909" e normaliza para apenas dígitos
export const cpfSchema = z
  .string()
  .trim()
  .regex(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/, "CPF deve conter 11 dígitos.")
  .refine(isValidCpf, "CPF inválido.")
  .transform(onlyDigits);

// Telefone brasileiro com DDD: fixo (8 dígitos) ou celular (9 dígitos iniciando em 9),
// com ou sem +55 e máscara; normaliza para apenas dígitos sem o código do país
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[\d\s()+-]+$/, "Telefone contém caracteres inválidos.")
  .transform((value) => onlyDigits(value).replace(/^55(?=\d{10,11}$)/, ""))
  .refine(
    (value) => /^[1-9]{2}(9\d{8}|[2-5]\d{7})$/.test(value),
    "Telefone inválido. Informe DDD e número, ex.: (11) 98765-4321.",
  );

// Detecta marcação HTML (<tag, </tag, <!-- ...) para barrar XSS armazenado já na entrada
const HTML_PATTERN = /<[a-z!/?]/i;

export const containsHtml = (value: string) => HTML_PATTERN.test(value);

export const safeText = (max = 255) =>
  z
    .string()
    .trim()
    .min(1, "Campo obrigatório.")
    .max(max, `Deve ter no máximo ${max} caracteres.`)
    .refine(
      (value) => !containsHtml(value),
      "Não é permitido HTML ou script neste campo.",
    );
