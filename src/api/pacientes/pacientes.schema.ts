// Schemas de entrada e saída das rotas de pacientes
import { z } from "@hono/zod-openapi";
import {
  cpfSchema,
  dataNascimentoSchema,
  phoneSchema,
  safeText,
} from "../../utils/validators";

// Listagem: dados mínimos e CPF mascarado (LGPD)
export const pacienteResumoSchema = z
  .object({
    id: z.uuid(),
    nome: z.string(),
    cpf: z.string().openapi({ example: "***.982.247-**" }),
    dataNascimento: z.iso.date(),
    email: z.string(),
    ativo: z.boolean(),
  })
  .openapi("PacienteResumo");

// Consulta individual: dados completos, decifrados
export const pacienteSchema = pacienteResumoSchema
  .extend({
    cpf: z.string().openapi({ example: "52998224725" }),
    telefone: z.string().nullable().openapi({ example: "41987654321" }),
    criadoEm: z.date(),
  })
  .openapi("Paciente");

export const buscaCpfSchema = z
  .object({ cpf: cpfSchema.openapi({ example: "529.982.247-25" }) })
  .openapi("BuscaPorCpf");

// PUT do ADMIN: substitui os dados cadastrais (inclusive CPF) e permite reativar
export const atualizarPacienteSchema = z
  .object({
    nome: safeText(150).openapi({ example: "Ana Paula Ribeiro" }),
    cpf: cpfSchema.openapi({ example: "529.982.247-25" }),
    dataNascimento: dataNascimentoSchema,
    telefone: phoneSchema.optional().openapi({ example: "(41) 98765-4321" }),
    ativo: z.boolean().optional(),
  })
  .openapi("PacienteAtualizacao");

export type AtualizarPacienteInput = z.infer<typeof atualizarPacienteSchema>;
export type PacienteResponse = z.infer<typeof pacienteSchema>;
export type PacienteResumo = z.infer<typeof pacienteResumoSchema>;

// PUT do próprio paciente: o CPF identifica o titular e só o ADMIN corrige
export const atualizarPerfilSchema = atualizarPacienteSchema
  .pick({ nome: true, dataNascimento: true, telefone: true })
  .openapi("PerfilPacienteAtualizacao");

export type AtualizarPerfilInput = z.infer<typeof atualizarPerfilSchema>;
