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

// Caracteres de controle (exceto tab e quebras de linha); o PostgreSQL rejeita o nulo (\u0000) em texto
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const safeText = (max = 255) =>
  z
    .string()
    .trim()
    .min(1, "Campo obrigatório.")
    .max(max, `Deve ter no máximo ${max} caracteres.`)
    .refine(
      (value) => !CONTROL_CHARS_PATTERN.test(value),
      "O texto contém caracteres inválidos.",
    )
    .refine(
      (value) => !containsHtml(value),
      "Não é permitido HTML ou script neste campo.",
    );

// E-mail normalizado (sem espaços e em minúsculas): a unicidade no banco diferencia maiúsculas
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Deve ter no máximo 254 caracteres.")
  .pipe(z.email("E-mail inválido."));

// Senha com letra e número; o máximo evita custo excessivo de hash com senhas gigantes (DoS)
export const senhaSchema = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres.")
  .max(128, "A senha deve ter no máximo 128 caracteres.")
  .regex(/[A-Za-z]/, "A senha deve conter ao menos uma letra.")
  .regex(/\d/, "A senha deve conter ao menos um número.");
