// Schemas de entrada e saída do prontuário (evoluções da consulta)
import { z } from "@hono/zod-openapi";
import { safeText } from "../../utils/validators";

// Texto clínico livre, sem HTML; gravado cifrado (AES-256-GCM)
export const registrarEvolucaoSchema = z
  .object({
    conteudo: safeText(10000).openapi({
      example:
        "Paciente relata melhora da dor torácica. PA 12x8. Mantida a conduta.",
    }),
  })
  .openapi("EvolucaoEntrada");

export const evolucaoSchema = z
  .object({
    id: z.uuid(),
    conteudo: z.string(),
    autor: z.object({ id: z.uuid(), nome: z.string() }),
    criadoEm: z.date(),
  })
  .openapi("Evolucao");

export type RegistrarEvolucaoInput = z.infer<typeof registrarEvolucaoSchema>;
