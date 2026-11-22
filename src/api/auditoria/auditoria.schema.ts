// Schemas da consulta à trilha de auditoria (RF23)
import { z } from "@hono/zod-openapi";
import { paginationQuerySchema } from "../../utils/pagination";
import { comPeriodoValido, dataSchema, mensagem } from "../../utils/validators";
import { AcaoAuditoria } from "./auditoria.service";

export const logAuditoriaSchema = z
  .object({
    id: z.uuid(),
    usuarioId: z.uuid().nullable(),
    acao: z.string().openapi({ example: AcaoAuditoria.LOGIN }),
    entidade: z.string().openapi({ example: "usuario" }),
    entidadeId: z.uuid().nullable(),
    ip: z.string().openapi({ example: "127.0.0.1" }),
    detalhes: z
      .unknown()
      .nullable()
      .openapi({ example: { via: "cpf" } }),
    criadoEm: z.date(),
  })
  .openapi("LogAuditoria");

// Datas no horário de Brasília; "ate" é inclusivo
export const listarAuditoriaQuerySchema = comPeriodoValido(
  paginationQuerySchema.extend({
    usuarioId: z.uuid(mensagem("Identificador inválido.")).optional(),
    acao: z
      .enum(AcaoAuditoria, mensagem("Ação de auditoria inválida."))
      .optional(),
    de: dataSchema.optional().openapi({ example: "2026-12-01" }),
    ate: dataSchema.optional().openapi({ example: "2026-12-31" }),
  }),
);

export type ListarAuditoriaQuery = z.infer<typeof listarAuditoriaQuerySchema>;
