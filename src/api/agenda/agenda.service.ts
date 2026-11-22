// Regras de negócio da agenda do profissional (RF07)
import {
  Perfil,
  StatusHorario,
  type Prisma,
} from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { conflict, forbidden, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { intervaloDoDia } from "../../utils/datas";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import type { AbrirHorarioInput, AtualizarHorarioInput } from "./agenda.schema";

const horarioPublico = {
  id: true,
  inicio: true,
  fim: true,
  status: true,
} satisfies Prisma.HorarioAgendaSelect;

// Só o próprio profissional (ativo) ou o ADMIN mexem na agenda
async function exigirGestorDaAgenda(
  profissionalId: string,
  ator: Ator,
  db: Prisma.TransactionClient,
) {
  const profissional = await db.profissional.findUnique({
    where: { id: profissionalId },
    select: { usuarioId: true, usuario: { select: { ativo: true } } },
  });
  if (!profissional) throw notFound("Profissional não encontrado.");

  const admin = ator.perfil === Perfil.ADMIN;
  if (!admin && profissional.usuarioId !== ator.usuarioId) throw forbidden();
  if (!profissional.usuario.ativo) {
    throw conflict("Profissional inativo não pode ter horários alterados.");
  }
}

// Agenda de um dia; profissionais inativos só são visíveis para o ADMIN
export async function listarAgendaDoDia(
  profissionalId: string,
  data: string,
  ator: Ator,
) {
  const profissional = await prisma.profissional.findUnique({
    where: { id: profissionalId },
    select: { usuario: { select: { ativo: true } } },
  });
  if (
    !profissional ||
    (!profissional.usuario.ativo && ator.perfil !== Perfil.ADMIN)
  ) {
    throw notFound("Profissional não encontrado.");
  }

  const { inicio, fim } = intervaloDoDia(data);
  return prisma.horarioAgenda.findMany({
    where: { profissionalId, inicio: { gte: inicio, lt: fim } },
    select: horarioPublico,
    orderBy: { inicio: "asc" },
  });
}

export function abrirHorario(
  profissionalId: string,
  { inicio, fim }: AbrirHorarioInput,
  ator: Ator,
) {
  return prisma.$transaction(async (tx) => {
    await exigirGestorDaAgenda(profissionalId, ator, tx);

    // Trava a linha do profissional até o fim da transação: duas aberturas
    // simultâneas não conseguem criar horários sobrepostos
    await tx.$executeRaw`SELECT 1 FROM profissional WHERE id = ${profissionalId}::uuid FOR UPDATE`;

    const sobreposto = await tx.horarioAgenda.findFirst({
      where: { profissionalId, inicio: { lt: fim }, fim: { gt: inicio } },
      select: { id: true },
    });
    if (sobreposto) {
      throw conflict("Já existe um horário que se sobrepõe a este período.");
    }

    const horario = await tx.horarioAgenda.create({
      data: { profissionalId, inicio, fim },
      select: horarioPublico,
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.HORARIO_ABERTO,
        entidade: "horario_agenda",
        entidadeId: horario.id,
      },
      tx,
    );

    return horario;
  });
}

export function atualizarHorario(
  profissionalId: string,
  horarioId: string,
  { status }: AtualizarHorarioInput,
  ator: Ator,
) {
  return prisma.$transaction(async (tx) => {
    await exigirGestorDaAgenda(profissionalId, ator, tx);

    // Atualização condicional: se uma consulta reservar o horário ao mesmo
    // tempo, a escrita não acontece e o horário continua RESERVADO
    const { count } = await tx.horarioAgenda.updateMany({
      where: {
        id: horarioId,
        profissionalId,
        status: { not: StatusHorario.RESERVADO },
      },
      data: { status },
    });

    if (count === 0) {
      const existe = await tx.horarioAgenda.findFirst({
        where: { id: horarioId, profissionalId },
        select: { id: true },
      });
      if (!existe) throw notFound("Horário não encontrado.");
      throw conflict(
        "Horário reservado para uma consulta não pode ser alterado.",
      );
    }

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.HORARIO_ATUALIZADO,
        entidade: "horario_agenda",
        entidadeId: horarioId,
        detalhes: { status },
      },
      tx,
    );

    return tx.horarioAgenda.findUniqueOrThrow({
      where: { id: horarioId },
      select: horarioPublico,
    });
  });
}
