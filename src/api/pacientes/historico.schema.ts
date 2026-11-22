// Schema de saída do histórico clínico do paciente (RF10)
import { z } from "@hono/zod-openapi";
import {
  ModalidadeConsulta,
  StatusConsulta,
  StatusExame,
} from "../../../generated/prisma/client";

const referencia = z.object({ id: z.uuid(), nome: z.string() });

const consultaSchema = z.object({
  id: z.uuid(),
  modalidade: z.enum(ModalidadeConsulta),
  status: z.enum(StatusConsulta),
  motivo: z.string().nullable(),
  inicio: z.date(),
  fim: z.date(),
  profissional: referencia.extend({ especialidade: z.string().nullable() }),
  unidade: referencia,
});

const exameSchema = z.object({
  id: z.uuid(),
  tipo: z.string(),
  dataHora: z.date(),
  status: z.enum(StatusExame),
  resultado: z.string().nullable(),
  resultadoEm: z.date().nullable(),
  unidade: referencia,
  responsavel: referencia.nullable(),
});

// Sem o hash do código de verificação: ele só serve à validação pela farmácia
const prescricaoSchema = z.object({
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
});

const internacaoSchema = z.object({
  id: z.uuid(),
  motivo: z.string(),
  admitidoEm: z.date(),
  altaEm: z.date().nullable(),
  leito: z.object({ codigo: z.string(), ala: z.string(), unidade: referencia }),
});

export const historicoSchema = z
  .object({
    paciente: referencia,
    consultas: z.array(consultaSchema),
    exames: z.array(exameSchema),
    prescricoes: z.array(prescricaoSchema),
    internacoes: z.array(internacaoSchema),
  })
  .openapi("HistoricoClinico");

export type Historico = z.infer<typeof historicoSchema>;
