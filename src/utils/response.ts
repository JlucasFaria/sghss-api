// Envelope padrão das respostas: sucesso em { data } e falha em { error }
import { z } from "@hono/zod-openapi";

export const dataResponseSchema = <T extends z.ZodType>(data: T) =>
  z.object({ data });

const errorDetailSchema = z.object({
  field: z.string().openapi({ example: "cpf" }),
  message: z.string().openapi({ example: "CPF inválido." }),
});

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "VALIDACAO" }),
      message: z.string().openapi({
        example: "Dados inválidos. Verifique os campos informados.",
      }),
      details: z.array(errorDetailSchema).optional(),
    }),
  })
  .openapi("ErrorResponse");

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
