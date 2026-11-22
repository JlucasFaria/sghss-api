// Schemas de entrada e saída dos lançamentos financeiros (RF31)
import { z } from "@hono/zod-openapi";
import { TipoLancamento } from "../../../generated/prisma/client";
import { paginationQuerySchema } from "../../utils/pagination";
import {
  comPeriodoValido,
  dataSchema,
  mensagem,
  safeText,
} from "../../utils/validators";

// Limite da coluna decimal(12, 2): 10 dígitos inteiros e 2 decimais
const VALOR_MAXIMO = 9_999_999_999.99;

// Valores monetários saem como texto com 2 casas ("1500.00"): número em JSON
// perderia precisão em somas e totais
export const valorMonetarioSchema = z.string().openapi({ example: "1500.00" });

export const lancamentoSchema = z
  .object({
    id: z.uuid(),
    tipo: z.enum(TipoLancamento),
    categoria: z.string(),
    descricao: z.string(),
    valor: valorMonetarioSchema,
    competencia: z.iso.date(),
    unidade: z.object({ id: z.uuid(), nome: z.string() }),
    criadoEm: z.date(),
  })
  .openapi("LancamentoFinanceiro");

export const criarLancamentoSchema = z
  .object({
    unidadeId: z.uuid(mensagem("Identificador inválido.")),
    tipo: z.enum(TipoLancamento).openapi({ example: "DESPESA" }),
    categoria: safeText(100).openapi({ example: "Suprimentos" }),
    descricao: safeText(255).openapi({ example: "Compra de luvas" }),
    valor: z
      .number()
      .positive("Deve ser maior que zero.")
      .max(VALOR_MAXIMO, "Valor acima do permitido.")
      .multipleOf(0.01, "Use no máximo 2 casas decimais.")
      .openapi({ example: 1500 }),
    // Mês/dia a que o lançamento se refere (pode diferir da data de registro)
    competencia: dataSchema.openapi({ example: "2026-12-01" }),
  })
  .openapi("LancamentoEntrada");

// Filtro pela competência; "ate" inclusivo
export const listarLancamentosQuerySchema = comPeriodoValido(
  paginationQuerySchema.extend({
    unidadeId: z.uuid(mensagem("Identificador inválido.")).optional(),
    tipo: z.enum(TipoLancamento).optional(),
    de: dataSchema.optional().openapi({ example: "2026-12-01" }),
    ate: dataSchema.optional().openapi({ example: "2026-12-31" }),
  }),
);

export type CriarLancamentoInput = z.infer<typeof criarLancamentoSchema>;
export type ListarLancamentosQuery = z.infer<
  typeof listarLancamentosQuerySchema
>;
