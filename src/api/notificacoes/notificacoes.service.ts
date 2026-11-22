// Notificações: geradas nos eventos da consulta (RF20) e consultadas pelo usuário (RF21).
// O envio externo (e-mail, SMS, push) é uma integração futura.
import {
  type ModalidadeConsulta,
  StatusConsulta,
  TipoNotificacao,
  type Prisma,
} from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { notFound } from "../../utils/app-error";
import { formatarDataHora } from "../../utils/datas";
import { buildPaginationMeta, toSkipTake } from "../../utils/pagination";
import type { ListarNotificacoesQuery } from "./notificacoes.schema";

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

// ---------- Consulta pelo usuário (RF21) ----------

const selecaoNotificacao = {
  id: true,
  tipo: true,
  titulo: true,
  mensagem: true,
  consultaId: true,
  lidaEm: true,
  criadoEm: true,
} satisfies Prisma.NotificacaoSelect;

// Cada usuário vê só as próprias notificações, das mais recentes para as mais antigas
export async function listarNotificacoes(
  usuarioId: string,
  { naoLidas, ...paginacao }: ListarNotificacoesQuery,
) {
  const where: Prisma.NotificacaoWhereInput = {
    usuarioId,
    lidaEm: naoLidas ? null : undefined,
  };

  const [notificacoes, total] = await Promise.all([
    prisma.notificacao.findMany({
      where,
      select: selecaoNotificacao,
      orderBy: { criadoEm: "desc" },
      ...toSkipTake(paginacao),
    }),
    prisma.notificacao.count({ where }),
  ]);

  return { data: notificacoes, meta: buildPaginationMeta(paginacao, total) };
}

// Marca como lida; repetir a chamada mantém a data da primeira leitura.
// Notificação de outro usuário responde 404, sem revelar que existe.
export async function marcarComoLida(id: string, usuarioId: string) {
  await prisma.notificacao.updateMany({
    where: { id, usuarioId, lidaEm: null },
    data: { lidaEm: new Date() },
  });

  const notificacao = await prisma.notificacao.findFirst({
    where: { id, usuarioId },
    select: selecaoNotificacao,
  });
  if (!notificacao) throw notFound("Notificação não encontrada.");
  return notificacao;
}
