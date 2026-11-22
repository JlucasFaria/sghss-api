// Schemas de saída e filtros das notificações
import { z } from "@hono/zod-openapi";
import { TipoNotificacao } from "../../../generated/prisma/client";
import { paginationQuerySchema } from "../../utils/pagination";

export const notificacaoSchema = z
  .object({
    id: z.uuid(),
    tipo: z.enum(TipoNotificacao),
    titulo: z.string(),
    mensagem: z.string(),
    consultaId: z.uuid().nullable(),
    lidaEm: z.date().nullable(),
    criadoEm: z.date(),
  })
  .openapi("Notificacao");

export const listarNotificacoesQuerySchema = paginationQuerySchema.extend({
  // "true" lista só as não lidas (z.stringbool: "false" não vira true)
  naoLidas: z.stringbool().optional().openapi({ example: "true" }),
});

export type ListarNotificacoesQuery = z.infer<
  typeof listarNotificacoesQuerySchema
>;
