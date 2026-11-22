// Schemas de entrada e saída das receitas digitais
import { z } from "@hono/zod-openapi";
import { Conselho } from "../../../generated/prisma/client";
import { mensagem, safeText } from "../../utils/validators";

const DIA = 24 * 60 * 60 * 1000;
export const VALIDADE_PADRAO_DIAS = 30;
const VALIDADE_MAXIMA_DIAS = 365;

const itemSchema = z.object({
  medicamento: safeText(150).openapi({ example: "Losartana potássica" }),
  dosagem: safeText(100).openapi({ example: "50 mg" }),
  posologia: safeText(500).openapi({
    example: "1 comprimido ao dia, pela manhã",
  }),
  quantidade: z.number().int().min(1).max(999).openapi({ example: 30 }),
});

export const emitirReceitaSchema = z
  .object({
    itens: z
      .array(itemSchema)
      .min(1, "Informe ao menos um item.")
      .max(20, "A receita pode ter no máximo 20 itens."),
    observacoes: safeText(1000).optional(),
    // Padrão: 30 dias a partir da emissão
    validaAte: z.iso
      .date(mensagem("Data inválida. Use o formato AAAA-MM-DD."))
      .transform((value) => new Date(value))
      .refine((data) => {
        // Compara datas inteiras: "hoje" é aceito como validade
        const hoje = new Date(new Date().toISOString().slice(0, 10));
        const dias = (data.getTime() - hoje.getTime()) / DIA;
        return dias >= 0 && dias <= VALIDADE_MAXIMA_DIAS;
      }, `A validade deve estar entre hoje e ${VALIDADE_MAXIMA_DIAS} dias.`)
      .optional()
      .openapi({ type: "string", format: "date", example: "2026-12-31" }),
  })
  .openapi("ReceitaEmissao");

export const receitaSchema = z
  .object({
    id: z.uuid(),
    consultaId: z.uuid(),
    emitidaEm: z.date(),
    validaAte: z.iso.date(),
    observacoes: z.string().nullable(),
    itens: z.array(
      z.object({
        medicamento: z.string(),
        dosagem: z.string(),
        posologia: z.string(),
        quantidade: z.number().int(),
      }),
    ),
    medico: z.object({
      id: z.uuid(),
      nome: z.string(),
      conselho: z.enum(Conselho),
      registro: z.string(),
    }),
    paciente: z.object({ id: z.uuid(), nome: z.string() }),
  })
  .openapi("Receita");

// O código só existe nesta resposta: o banco guarda apenas o hash
export const receitaEmitidaSchema = receitaSchema
  .extend({
    codigoVerificacao: z.string().openapi({
      description:
        "Código para a farmácia validar a receita. Exibido uma única vez; não pode ser recuperado depois.",
      example: "q3Zx8b1yK0nV2mT5rL7wP9sD4fG6hJ1kA3cE5vB7nM0",
    }),
  })
  .openapi("ReceitaEmitida");

export type EmitirReceitaInput = z.infer<typeof emitirReceitaSchema>;
export type ReceitaResponse = z.infer<typeof receitaSchema>;

// Código de verificação vai no corpo, nunca na URL (que fica em logs e históricos)
export const validarReceitaSchema = z
  .object({
    codigo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{43}$/, "Código de verificação inválido.")
      .openapi({ example: "q3Zx8b1yK0nV2mT5rL7wP9sD4fG6hJ1kA3cE5vB7nM0" }),
  })
  .openapi("ReceitaValidacaoEntrada");

// Só o necessário para a farmácia conferir e dispensar: sem dados clínicos da
// consulta e com o nome do paciente abreviado
export const validacaoReceitaSchema = z
  .object({
    situacao: z.enum(["VALIDA", "EXPIRADA"]),
    emitidaEm: z.date(),
    validaAte: z.iso.date(),
    itens: receitaSchema.shape.itens,
    medico: z.object({
      nome: z.string(),
      conselho: z.enum(Conselho),
      registro: z.string(),
    }),
    paciente: z.object({
      nome: z.string().openapi({ example: "Ana P. R." }),
    }),
  })
  .openapi("ReceitaValidacao");

export type ValidacaoReceita = z.infer<typeof validacaoReceitaSchema>;
