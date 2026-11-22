// Schemas dos direitos do titular (LGPD): consentimentos
import { z } from "@hono/zod-openapi";
import { TERMO_DE_USO } from "../../config/termo-de-uso";

export const consentimentoSchema = z
  .object({
    id: z.uuid(),
    finalidade: z.string().openapi({ example: TERMO_DE_USO.finalidade }),
    versaoTermo: z.string().openapi({ example: TERMO_DE_USO.versao }),
    concedidoEm: z.date(),
    revogadoEm: z.date().nullable(),
  })
  .openapi("Consentimento");

export type ConsentimentoResponse = z.infer<typeof consentimentoSchema>;
