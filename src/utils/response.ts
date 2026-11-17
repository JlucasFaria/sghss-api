// Envelope padrão das respostas: sucesso em { data } e falha em { error }
import { z } from "zod";

export const dataResponseSchema = <T extends z.ZodType>(data: T) =>
  z.object({ data });

const errorDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
  }),
});

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
