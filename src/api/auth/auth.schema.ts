// Schemas de entrada e saída das rotas de autenticação
import { z } from "@hono/zod-openapi";
import { Perfil } from "../../../generated/prisma/client";
import {
  cpfSchema,
  emailSchema,
  phoneSchema,
  safeText,
  senhaSchema,
} from "../../utils/validators";

const dataNascimentoSchema = z.iso
  .date("Data inválida. Use o formato AAAA-MM-DD.")
  .transform((value) => new Date(value))
  .refine(
    (date) => date <= new Date() && date.getUTCFullYear() >= 1900,
    "Data de nascimento inválida.",
  );

export const registerBodySchema = z
  .object({
    email: emailSchema.openapi({ example: "paciente@exemplo.com" }),
    senha: senhaSchema.openapi({ example: "SenhaForte123" }),
    nome: safeText(150).openapi({ example: "Ana Paula Ribeiro" }),
    cpf: cpfSchema.openapi({ example: "529.982.247-25" }),
    dataNascimento: dataNascimentoSchema.openapi({
      type: "string",
      format: "date",
      example: "1990-05-20",
    }),
    telefone: phoneSchema.optional().openapi({ example: "(41) 98765-4321" }),
    aceiteTermo: z.literal(true, "É necessário aceitar o termo de uso."),
  })
  .openapi("RegistroPaciente");

export const loginBodySchema = z
  .object({
    email: emailSchema.openapi({ example: "paciente@exemplo.com" }),
    // Sem regras de formato no login, para não revelar a política de senha
    senha: z.string().min(1).max(128).openapi({ example: "SenhaForte123" }),
  })
  .openapi("Login");

export const usuarioSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    perfil: z.enum(Perfil),
  })
  .openapi("Usuario");

export const tokenSchema = z
  .object({
    token: z.string(),
    tipo: z.literal("Bearer"),
    expiraEm: z.number().int().openapi({ description: "Validade em segundos" }),
  })
  .openapi("Token");

export type RegisterInput = z.infer<typeof registerBodySchema>;
export type LoginInput = z.infer<typeof loginBodySchema>;
