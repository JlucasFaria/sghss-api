// Schemas de saída da teleconsulta
import { z } from "@hono/zod-openapi";

export const teleconsultaSchema = z
  .object({
    id: z.uuid(),
    consultaId: z.uuid(),
    provedor: z.string().openapi({ example: "simulado" }),
    urlSala: z.string().openapi({
      example:
        "https://video.vidaplus.example/0b6f8f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
    }),
    iniciadaEm: z.date().nullable(),
    encerradaEm: z.date().nullable(),
    criadoEm: z.date(),
  })
  .openapi("Teleconsulta");

export type TeleconsultaResponse = z.infer<typeof teleconsultaSchema>;
