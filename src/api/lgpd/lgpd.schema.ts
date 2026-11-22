// Schemas dos direitos do titular (LGPD): consentimentos e portabilidade
import { z } from "@hono/zod-openapi";
import { Perfil } from "../../../generated/prisma/client";
import { TERMO_DE_USO } from "../../config/termo-de-uso";
import { notificacaoSchema } from "../notificacoes/notificacoes.schema";
import { historicoSchema } from "../pacientes/historico.schema";
import { pacienteSchema } from "../pacientes/pacientes.schema";
import { evolucaoSchema } from "../prontuario/prontuario.schema";

export const consentimentoSchema = z
  .object({
    id: z.uuid(),
    finalidade: z.string().openapi({ example: TERMO_DE_USO.finalidade }),
    versaoTermo: z.string().openapi({ example: TERMO_DE_USO.versao }),
    concedidoEm: z.date(),
    revogadoEm: z.date().nullable(),
  })
  .openapi("Consentimento");

export type ConsentimentoResponse = z.infer<typeof consentimentoSchema>;

// Portabilidade (RF25): tudo o que a VidaPlus guarda sobre o titular, em JSON
export const dadosDoTitularSchema = z
  .object({
    geradoEm: z.date(),
    conta: z.object({
      email: z.string(),
      perfil: z.enum(Perfil),
      criadoEm: z.date(),
    }),
    cadastro: pacienteSchema,
    consentimentos: z.array(consentimentoSchema.extend({ ip: z.string() })),
    ...historicoSchema.omit({ paciente: true }).shape,
    prontuario: z.array(evolucaoSchema.extend({ consultaId: z.uuid() })),
    notificacoes: z.array(notificacaoSchema),
  })
  .openapi("DadosDoTitular");

export type DadosDoTitular = z.infer<typeof dadosDoTitularSchema>;
