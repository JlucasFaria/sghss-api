// Schemas de entrada e saída das rotas de exames
import { z } from "@hono/zod-openapi";
import { StatusExame } from "../../../generated/prisma/client";
import { paginationQuerySchema } from "../../utils/pagination";
import { dataHoraSchema, mensagem, safeText } from "../../utils/validators";

const referencia = z.object({ id: z.uuid(), nome: z.string() });

export const agendarExameSchema = z
  .object({
    unidadeId: z.uuid(mensagem("Identificador inválido.")),
    tipo: safeText(150).openapi({ example: "Hemograma completo" }),
    dataHora: dataHoraSchema
      .refine(
        (data) => data > new Date(),
        "O exame deve ser marcado no futuro.",
      )
      .openapi({
        type: "string",
        format: "date-time",
        example: "2026-12-05T08:00:00-03:00",
      }),
  })
  .openapi("ExameAgendamento");

// Resultado gravado cifrado (AES-256-GCM); texto livre sem HTML
export const resultadoExameSchema = z
  .object({
    resultado: safeText(5000).openapi({
      example: "Hemoglobina 14,2 g/dL. Valores dentro da referência.",
    }),
  })
  .openapi("ExameResultado");

export const exameSchema = z
  .object({
    id: z.uuid(),
    tipo: z.string(),
    dataHora: z.date(),
    status: z.enum(StatusExame),
    resultado: z.string().nullable(),
    resultadoEm: z.date().nullable(),
    paciente: referencia,
    unidade: referencia,
    responsavel: referencia.nullable(),
  })
  .openapi("Exame");

export const listarExamesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(StatusExame).optional(),
});

export type AgendarExameInput = z.infer<typeof agendarExameSchema>;
export type ResultadoExameInput = z.infer<typeof resultadoExameSchema>;
export type ListarExamesQuery = z.infer<typeof listarExamesQuerySchema>;
export type ExameResponse = z.infer<typeof exameSchema>;
