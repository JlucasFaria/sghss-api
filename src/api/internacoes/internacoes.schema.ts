// Schemas de entrada e saída das rotas de internações
import { z } from "@hono/zod-openapi";
import { paginationQuerySchema } from "../../utils/pagination";
import { mensagem, safeText } from "../../utils/validators";

const referencia = z.object({ id: z.uuid(), nome: z.string() });
const idSchema = z.uuid(mensagem("Identificador inválido."));

// Sem o motivo: é dado clínico, visível no histórico do paciente, não na gestão de leitos
export const internacaoSchema = z
  .object({
    id: z.uuid(),
    paciente: referencia,
    leito: z.object({
      id: z.uuid(),
      codigo: z.string(),
      ala: z.string(),
      unidade: referencia,
    }),
    admitidoEm: z.date(),
    altaEm: z.date().nullable(),
  })
  .openapi("Internacao");

export const internarSchema = z
  .object({
    pacienteId: idSchema,
    leitoId: idSchema,
    motivo: safeText(500).openapi({ example: "Pneumonia comunitária" }),
  })
  .openapi("InternacaoEntrada");

export const transferenciaSchema = z
  .object({ leitoId: idSchema })
  .openapi("InternacaoTransferencia");

export const listarInternacoesQuerySchema = paginationQuerySchema.extend({
  // ATIVA = sem alta; ENCERRADA = com alta
  situacao: z.enum(["ATIVA", "ENCERRADA"]).optional(),
  unidadeId: idSchema.optional(),
  pacienteId: idSchema.optional(),
});

export type InternarInput = z.infer<typeof internarSchema>;
export type TransferenciaInput = z.infer<typeof transferenciaSchema>;
export type ListarInternacoesQuery = z.infer<
  typeof listarInternacoesQuerySchema
>;
