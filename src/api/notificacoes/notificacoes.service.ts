// Notificações (RF20): geradas nos eventos da consulta e persistidas no banco.
// O envio externo (e-mail, SMS, push) é uma integração futura.
import {
  type ModalidadeConsulta,
  StatusConsulta,
  TipoNotificacao,
  type Prisma,
} from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { formatarDataHora } from "../../utils/datas";

// Texto de cada evento: só data, profissional e modalidade (nada de dado clínico)
const mensagens: Record<
  TipoNotificacao,
  (c: { quando: string; profissional: string; modalidade: string }) => {
    titulo: string;
    mensagem: string;
  }
> = {
  CONSULTA_AGENDADA: (c) => ({
    titulo: "Consulta agendada",
    mensagem: `Sua consulta ${c.modalidade} com ${c.profissional} está agendada para ${c.quando}.`,
  }),
  CONSULTA_CANCELADA: (c) => ({
    titulo: "Consulta cancelada",
    mensagem: `Sua consulta ${c.modalidade} com ${c.profissional} marcada para ${c.quando} foi cancelada.`,
  }),
  CONSULTA_REAGENDADA: (c) => ({
    titulo: "Consulta reagendada",
    mensagem: `Sua consulta ${c.modalidade} com ${c.profissional} foi remarcada para ${c.quando}.`,
  }),
  LEMBRETE_CONSULTA: (c) => ({
    titulo: "Lembrete de consulta",
    mensagem: `Lembrete: sua consulta ${c.modalidade} com ${c.profissional} é em ${c.quando}.`,
  }),
};

const modalidadeNoTexto: Record<ModalidadeConsulta, string> = {
  PRESENCIAL: "presencial",
  TELEMEDICINA: "por telemedicina",
};

// Notifica o paciente sobre um evento da consulta. Recebe o cliente da transação do
// evento: se o evento falhar, a notificação também não é gravada. As leituras são
// sequenciais (uma relação por vez) para não disparar queries paralelas na transação.
export async function notificarConsulta(
  consultaId: string,
  tipo: TipoNotificacao,
  db: Prisma.TransactionClient = prisma,
) {
  const consulta = await db.consulta.findUniqueOrThrow({
    where: { id: consultaId },
    select: {
      horarioId: true,
      modalidade: true,
      paciente: { select: { usuarioId: true } },
    },
  });
  const horario = await db.horarioAgenda.findUniqueOrThrow({
    where: { id: consulta.horarioId },
    select: { inicio: true, profissional: { select: { nome: true } } },
  });

  await db.notificacao.create({
    data: {
      usuarioId: consulta.paciente.usuarioId,
      consultaId,
      tipo,
      ...mensagens[tipo]({
        quando: formatarDataHora(horario.inicio),
        profissional: horario.profissional.nome,
        modalidade: modalidadeNoTexto[consulta.modalidade],
      }),
    },
  });
}

const ANTECEDENCIA_LEMBRETE_MS = 24 * 60 * 60 * 1000;
// Chave da trava da rotina no PostgreSQL (qualquer número fixo e exclusivo da rotina)
const TRAVA_LEMBRETES = 20_201;

// Lembra as consultas agendadas que começam nas próximas 24 horas e ainda não foram
// lembradas. A trava transacional garante uma execução por vez, mesmo com várias
// instâncias da API. Devolve quantos lembretes foram gerados.
export function gerarLembretes(agora = new Date()) {
  return prisma.$transaction(async (tx) => {
    const [trava] = await tx.$queryRaw<{ obtida: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${TRAVA_LEMBRETES}) AS obtida
    `;
    if (!trava?.obtida) return 0;

    const consultas = await tx.consulta.findMany({
      where: {
        status: StatusConsulta.AGENDADA,
        horario: {
          inicio: {
            gt: agora,
            lte: new Date(agora.getTime() + ANTECEDENCIA_LEMBRETE_MS),
          },
        },
        notificacoes: { none: { tipo: TipoNotificacao.LEMBRETE_CONSULTA } },
      },
      select: { id: true },
    });

    for (const { id } of consultas) {
      await notificarConsulta(id, TipoNotificacao.LEMBRETE_CONSULTA, tx);
    }
    return consultas.length;
  });
}
