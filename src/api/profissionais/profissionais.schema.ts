// Schemas de entrada e saída das rotas de profissionais de saúde
import { z } from "@hono/zod-openapi";
import { Conselho } from "../../../generated/prisma/client";
import { paginationQuerySchema } from "../../utils/pagination";
import {
  emailSchema,
  mensagem,
  safeText,
  senhaSchema,
} from "../../utils/validators";

// Perfis de profissional de saúde e o conselho exigido para cada um
// (o técnico de enfermagem também é registrado no COREN)
const CONSELHO_POR_PERFIL = {
  MEDICO: Conselho.CRM,
  ENFERMEIRO: Conselho.COREN,
  TECNICO: Conselho.COREN,
} as const;

const perfilProfissionalSchema = z.enum(["MEDICO", "ENFERMEIRO", "TECNICO"]);

// Número do registro com a UF do conselho regional, ex.: "123456-PR". A UF é
// obrigatória porque o mesmo número pode existir em conselhos de estados diferentes
const registroSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^\d{1,10}-[A-Z]{2}$/,
    "Registro inválido. Use número-UF, ex.: 123456-PR.",
  );

const dadosProfissionalSchema = z.object({
  nome: safeText(150).openapi({ example: "Dra. Ana Souza" }),
  perfil: perfilProfissionalSchema.openapi({ example: "MEDICO" }),
  conselho: z.enum(Conselho).openapi({ example: "CRM" }),
  registro: registroSchema.openapi({ example: "123456-PR" }),
  especialidade: safeText(100).optional().openapi({ example: "Cardiologia" }),
  unidadeId: z.uuid(mensagem("Identificador inválido.")),
});

const conselhoCompativel = {
  check: (dados: {
    perfil: keyof typeof CONSELHO_POR_PERFIL;
    conselho: Conselho;
  }) => CONSELHO_POR_PERFIL[dados.perfil] === dados.conselho,
  params: {
    path: ["conselho"],
    message:
      "Conselho incompatível com o perfil (MEDICO: CRM; ENFERMEIRO e TECNICO: COREN).",
  },
};

export const criarProfissionalSchema = dadosProfissionalSchema
  .extend({
    email: emailSchema.openapi({ example: "ana.souza@vidaplus.example" }),
    // Senha inicial definida pelo administrador
    senha: senhaSchema.openapi({ example: "SenhaInicial123" }),
  })
  .refine(conselhoCompativel.check, conselhoCompativel.params)
  .openapi("ProfissionalEntrada");

// PUT substitui os dados profissionais e permite reativar o acesso
export const atualizarProfissionalSchema = dadosProfissionalSchema
  .extend({ ativo: z.boolean().optional() })
  .refine(conselhoCompativel.check, conselhoCompativel.params)
  .openapi("ProfissionalAtualizacao");

export const profissionalSchema = z
  .object({
    id: z.uuid(),
    nome: z.string(),
    perfil: perfilProfissionalSchema,
    conselho: z.enum(Conselho),
    registro: z.string(),
    especialidade: z.string().nullable(),
    ativo: z.boolean(),
    unidade: z.object({ id: z.uuid(), nome: z.string() }),
    // Só é exibido para o ADMIN
    email: z.string().optional(),
  })
  .openapi("Profissional");

export const listarProfissionaisQuerySchema = paginationQuerySchema.extend({
  unidadeId: z.uuid(mensagem("Identificador inválido.")).optional(),
  especialidade: z.string().trim().max(100).optional(),
});

export type CriarProfissionalInput = z.infer<typeof criarProfissionalSchema>;
export type AtualizarProfissionalInput = z.infer<
  typeof atualizarProfissionalSchema
>;
export type ListarProfissionaisQuery = z.infer<
  typeof listarProfissionaisQuerySchema
>;
export type ProfissionalResponse = z.infer<typeof profissionalSchema>;
