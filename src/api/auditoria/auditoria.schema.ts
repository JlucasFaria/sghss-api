// Schemas da consulta à trilha de auditoria (RF23)
import { z } from "@hono/zod-openapi";
import { paginationQuerySchema } from "../../utils/pagination";
import { mensagem, seSemErros } from "../../utils/validators";
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

const dataFiltro = z.iso
  .date(mensagem("Data inválida. Use o formato AAAA-MM-DD."))
  .optional();

// Datas no horário de Brasília; "ate" é inclusivo
export const listarAuditoriaQuerySchema = paginationQuerySchema
  .extend({
    usuarioId: z.uuid(mensagem("Identificador inválido.")).optional(),
    acao: z
      .enum(AcaoAuditoria, mensagem("Ação de auditoria inválida."))
      .optional(),
    de: dataFiltro.openapi({ example: "2026-12-01" }),
    ate: dataFiltro.openapi({ example: "2026-12-31" }),
  })
  .refine(({ de, ate }) => !de || !ate || de <= ate, {
    path: ["ate"],
    message: "A data final deve ser igual ou posterior à inicial.",
    ...seSemErros,
  });

export type ListarAuditoriaQuery = z.infer<typeof listarAuditoriaQuerySchema>;
