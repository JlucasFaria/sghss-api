// Schemas de entrada e saída das rotas de unidades
import { z } from "@hono/zod-openapi";
import { TipoUnidade } from "../../../generated/prisma/client";
import { paginationQuerySchema } from "../../utils/pagination";
import { safeText } from "../../utils/validators";

const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

export const unidadeBodySchema = z
  .object({
    nome: safeText(150).openapi({ example: "Hospital VidaPlus Centro" }),
    tipo: z.enum(TipoUnidade).openapi({ example: "HOSPITAL" }),
    endereco: safeText(255).openapi({ example: "Av. Central, 1000" }),
    cidade: safeText(100).openapi({ example: "Curitiba" }),
    uf: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.enum(UFS, "UF inválida."))
      .openapi({ example: "PR" }),
  })
  .openapi("UnidadeEntrada");

// PUT substitui os dados e permite reativar uma unidade inativada
export const unidadeUpdateSchema = unidadeBodySchema
  .extend({ ativo: z.boolean().optional() })
  .openapi("UnidadeAtualizacao");

export const unidadeSchema = z
  .object({
    id: z.uuid(),
    nome: z.string(),
    tipo: z.enum(TipoUnidade),
    endereco: z.string(),
    cidade: z.string(),
    uf: z.string(),
    ativo: z.boolean(),
    criadoEm: z.date(),
    atualizadoEm: z.date(),
  })
  .openapi("Unidade");

export const listarUnidadesQuerySchema = paginationQuerySchema.extend({
  tipo: z.enum(TipoUnidade).optional(),
});

export type UnidadeInput = z.infer<typeof unidadeBodySchema>;
export type UnidadeUpdateInput = z.infer<typeof unidadeUpdateSchema>;
export type ListarUnidadesQuery = z.infer<typeof listarUnidadesQuerySchema>;
