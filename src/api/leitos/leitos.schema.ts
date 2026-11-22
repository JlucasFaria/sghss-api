// Schemas de entrada e saída das rotas de leitos
import { z } from "@hono/zod-openapi";
import { StatusLeito, TipoLeito } from "../../../generated/prisma/client";
import { paginationQuerySchema } from "../../utils/pagination";
import { mensagem, safeText } from "../../utils/validators";

const referencia = z.object({ id: z.uuid(), nome: z.string() });

export const leitoSchema = z
  .object({
    id: z.uuid(),
    codigo: z.string(),
    ala: z.string(),
    tipo: z.enum(TipoLeito),
    status: z.enum(StatusLeito),
    unidade: referencia,
    criadoEm: z.date(),
    atualizadoEm: z.date(),
  })
  .openapi("Leito");

const dadosLeitoSchema = z.object({
  codigo: safeText(20).openapi({ example: "ENF-101" }),
  ala: safeText(100).openapi({ example: "Clínica Médica" }),
  tipo: z.enum(TipoLeito).openapi({ example: "ENFERMARIA" }),
});

// O leito nasce LIVRE; OCUPADO só é definido pelas internações
export const criarLeitoSchema = dadosLeitoSchema
  .extend({ unidadeId: z.uuid(mensagem("Identificador inválido.")) })
  .openapi("LeitoEntrada");

// PUT substitui os dados; o status manual alterna só entre LIVRE e MANUTENCAO.
// A unidade não muda: um leito em outra unidade é um novo cadastro.
export const atualizarLeitoSchema = dadosLeitoSchema
  .extend({
    status: z
      .enum(
        [StatusLeito.LIVRE, StatusLeito.MANUTENCAO],
        mensagem("Status inválido. Use LIVRE ou MANUTENCAO."),
      )
      .optional(),
  })
  .openapi("LeitoAtualizacao");

export const listarLeitosQuerySchema = paginationQuerySchema.extend({
  unidadeId: z.uuid(mensagem("Identificador inválido.")).optional(),
  status: z.enum(StatusLeito).optional(),
  tipo: z.enum(TipoLeito).optional(),
});

export type CriarLeitoInput = z.infer<typeof criarLeitoSchema>;
export type AtualizarLeitoInput = z.infer<typeof atualizarLeitoSchema>;
export type ListarLeitosQuery = z.infer<typeof listarLeitosQuerySchema>;
