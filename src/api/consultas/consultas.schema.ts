// Schemas de entrada e saída das rotas de consultas
import { z } from "@hono/zod-openapi";
import {
  ModalidadeConsulta,
  StatusConsulta,
} from "../../../generated/prisma/client";
import { paginationQuerySchema } from "../../utils/pagination";
import { mensagem, safeText, seSemErros } from "../../utils/validators";

const referencia = z.object({ id: z.uuid(), nome: z.string() });

export const agendarConsultaSchema = z
  .object({
    horarioId: z.uuid(mensagem("Identificador inválido.")),
    modalidade: z.enum(ModalidadeConsulta).openapi({ example: "PRESENCIAL" }),
    motivo: safeText(500)
      .optional()
      .openapi({ example: "Dor no peito ao fazer esforço" }),
  })
  .openapi("ConsultaAgendamento");

export const consultaSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(StatusConsulta),
    modalidade: z.enum(ModalidadeConsulta),
    // Texto clínico: omitido para o ADMIN (minimização, LGPD)
    motivo: z.string().nullable().optional(),
    motivoCancelamento: z.string().nullable(),
    inicio: z.date(),
    fim: z.date(),
    paciente: referencia,
    profissional: referencia.extend({ especialidade: z.string().nullable() }),
    unidade: referencia,
    criadoEm: z.date(),
  })
  .openapi("Consulta");

export type AgendarConsultaInput = z.infer<typeof agendarConsultaSchema>;
export type ConsultaResponse = z.infer<typeof consultaSchema>;

export const cancelarConsultaSchema = z
  .object({
    motivo: safeText(500)
      .optional()
      .openapi({ example: "Imprevisto no trabalho" }),
  })
  .openapi("ConsultaCancelamento");

export const reagendarConsultaSchema = z
  .object({ horarioId: z.uuid(mensagem("Identificador inválido.")) })
  .openapi("ConsultaReagendamento");

export type CancelarConsultaInput = z.infer<typeof cancelarConsultaSchema>;
export type ReagendarConsultaInput = z.infer<typeof reagendarConsultaSchema>;

const dataFiltro = z.iso
  .date(mensagem("Data inválida. Use o formato AAAA-MM-DD."))
  .optional();

// Datas no horário de Brasília; "ate" é inclusivo
export const listarConsultasQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(StatusConsulta).optional(),
    de: dataFiltro.openapi({ example: "2026-12-01" }),
    ate: dataFiltro.openapi({ example: "2026-12-31" }),
    pacienteId: z.uuid(mensagem("Identificador inválido.")).optional(),
    profissionalId: z.uuid(mensagem("Identificador inválido.")).optional(),
  })
  .refine(({ de, ate }) => !de || !ate || de <= ate, {
    path: ["ate"],
    message: "A data final deve ser igual ou posterior à inicial.",
    ...seSemErros,
  });

export type ListarConsultasQuery = z.infer<typeof listarConsultasQuerySchema>;
