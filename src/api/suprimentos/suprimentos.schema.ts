// Schemas de entrada e saída das rotas de suprimentos e estoque (RF30)
import { z } from "@hono/zod-openapi";
import { TipoMovimentacao } from "../../../generated/prisma/client";
import { paginationQuerySchema } from "../../utils/pagination";
import { mensagem, safeText } from "../../utils/validators";

const referencia = z.object({ id: z.uuid(), nome: z.string() });
// Teto por operação: evita erro de digitação gigante e estouro do inteiro no banco
const MAX_QUANTIDADE = 100_000;
const quantidadeSchema = z
  .number()
  .int("Informe um número inteiro.")
  .max(MAX_QUANTIDADE, `Deve ser no máximo ${MAX_QUANTIDADE}.`);

export const suprimentoSchema = z
  .object({
    id: z.uuid(),
    nome: z.string(),
    unidadeMedida: z.string(),
    quantidade: z.number().int(),
    estoqueMinimo: z.number().int(),
    // Alerta: saldo igual ou abaixo do mínimo
    estoqueBaixo: z.boolean(),
    unidade: referencia,
    atualizadoEm: z.date(),
  })
  .openapi("Suprimento");

// O saldo começa em zero e só muda por movimentações
export const criarSuprimentoSchema = z
  .object({
    unidadeId: z.uuid(mensagem("Identificador inválido.")),
    nome: safeText(150).openapi({ example: "Luva de procedimento M" }),
    unidadeMedida: safeText(20).openapi({ example: "caixa" }),
    estoqueMinimo: quantidadeSchema
      .min(0, "Não pode ser negativo.")
      .default(0)
      .openapi({ example: 10 }),
  })
  .openapi("SuprimentoEntrada");

export const movimentacaoSchema = z
  .object({
    tipo: z.enum(TipoMovimentacao).openapi({ example: "SAIDA" }),
    quantidade: quantidadeSchema
      .min(1, "Deve ser maior que zero.")
      .openapi({ example: 5 }),
    observacao: safeText(500)
      .optional()
      .openapi({ example: "Reposição do centro cirúrgico" }),
  })
  .openapi("MovimentacaoEntrada");

export const movimentacaoResponseSchema = z
  .object({
    movimentacao: z.object({
      id: z.uuid(),
      tipo: z.enum(TipoMovimentacao),
      quantidade: z.number().int(),
      observacao: z.string().nullable(),
      criadoEm: z.date(),
    }),
    suprimento: suprimentoSchema,
  })
  .openapi("Movimentacao");

export const listarSuprimentosQuerySchema = paginationQuerySchema.extend({
  unidadeId: z.uuid(mensagem("Identificador inválido.")).optional(),
  // "true" lista só os itens em alerta
  estoqueBaixo: z.stringbool().optional().openapi({ example: "true" }),
});

export type CriarSuprimentoInput = z.infer<typeof criarSuprimentoSchema>;
export type MovimentacaoInput = z.infer<typeof movimentacaoSchema>;
export type ListarSuprimentosQuery = z.infer<
  typeof listarSuprimentosQuerySchema
>;
