// Schemas dos direitos do titular (LGPD): consentimentos, portabilidade e anonimização
import { z } from "@hono/zod-openapi";
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

// Portabilidade (RF25): tudo o que a VidaPlus guarda sobre o titular, em JSON.
// O cadastro já traz o e-mail de acesso e a situação da conta.
export const dadosDoTitularSchema = z
  .object({
    geradoEm: z.date(),
    cadastro: pacienteSchema,
    consentimentos: z.array(consentimentoSchema.extend({ ip: z.string() })),
    ...historicoSchema.omit({ paciente: true }).shape,
    prontuario: z.array(evolucaoSchema.extend({ consultaId: z.uuid() })),
    notificacoes: z.array(notificacaoSchema),
  })
  .openapi("DadosDoTitular");

export type DadosDoTitular = z.infer<typeof dadosDoTitularSchema>;

// Anonimização (RF26): ação irreversível, confirmada com a senha atual
export const anonimizacaoSchema = z
  .object({
    senha: z.string().min(1).max(128).openapi({ example: "SenhaForte123" }),
  })
  .openapi("AnonimizacaoConfirmacao");

export type AnonimizacaoInput = z.infer<typeof anonimizacaoSchema>;
