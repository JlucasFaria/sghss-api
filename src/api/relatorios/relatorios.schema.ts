// Schemas dos relatórios gerenciais (RF29): só dados agregados, sem dados pessoais
import { z } from "@hono/zod-openapi";
import {
  ModalidadeConsulta,
  StatusConsulta,
} from "../../../generated/prisma/client";
import { comPeriodoValido, dataSchema, mensagem } from "../../utils/validators";

const referencia = z.object({ id: z.uuid(), nome: z.string() });
const unidadeIdSchema = z.uuid(mensagem("Identificador inválido.")).optional();

export const ocupacaoQuerySchema = z.object({ unidadeId: unidadeIdSchema });

const ocupacaoSchema = z.object({
  total: z.number().int(),
  livres: z.number().int(),
  ocupados: z.number().int(),
  manutencao: z.number().int(),
  // Percentual de ocupados entre os leitos em operação (fora de manutenção)
  taxaOcupacao: z.number().openapi({ example: 75 }),
});

export const relatorioOcupacaoSchema = z
  .object({
    geradoEm: z.date(),
    unidades: z.array(ocupacaoSchema.extend({ unidade: referencia })),
    total: ocupacaoSchema,
  })
  .openapi("RelatorioOcupacaoLeitos");

// Período obrigatório: um relatório sem recorte de datas cresceria sem limite
export const consultasQuerySchema = comPeriodoValido(
  z.object({
    de: dataSchema.openapi({ example: "2026-12-01" }),
    ate: dataSchema.openapi({ example: "2026-12-31" }),
    unidadeId: unidadeIdSchema,
  }),
);

const contagemConsultasSchema = z.object({
  total: z.number().int(),
  porStatus: z.record(z.enum(StatusConsulta), z.number().int()),
  porModalidade: z.record(z.enum(ModalidadeConsulta), z.number().int()),
});

export const relatorioConsultasSchema = z
  .object({
    periodo: z.object({ de: z.iso.date(), ate: z.iso.date() }),
    unidades: z.array(contagemConsultasSchema.extend({ unidade: referencia })),
    total: contagemConsultasSchema,
  })
  .openapi("RelatorioConsultas");

export type OcupacaoQuery = z.infer<typeof ocupacaoQuerySchema>;
export type ConsultasQuery = z.infer<typeof consultasQuerySchema>;
export type RelatorioOcupacao = z.infer<typeof relatorioOcupacaoSchema>;
export type RelatorioConsultas = z.infer<typeof relatorioConsultasSchema>;
