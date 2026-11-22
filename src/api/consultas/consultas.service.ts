// Regras de negócio das consultas: agendamento (RF11), cancelamento e reagendamento (RF12) e listagem (RF13)
import {
  Perfil,
  StatusConsulta,
  StatusHorario,
  TipoNotificacao,
  type Prisma,
} from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { conflict, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { intervaloDoDia } from "../../utils/datas";
import { buildPaginationMeta, toSkipTake } from "../../utils/pagination";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import { notificarConsulta } from "../notificacoes/notificacoes.service";
import { buscarIdDoPaciente } from "../pacientes/pacientes.service";
import type {
  AgendarConsultaInput,
  CancelarConsultaInput,
  ConsultaResponse,
  ListarConsultasQuery,
  ReagendarConsultaInput,
} from "./consultas.schema";

const referencia = { select: { id: true, nome: true } } as const;

const selecao = {
  id: true,
  status: true,
  modalidade: true,
  motivo: true,
  motivoCancelamento: true,
  criadoEm: true,
  paciente: referencia,
  unidade: referencia,
  horario: {
    select: {
      inicio: true,
      fim: true,
      profissional: { select: { id: true, nome: true, especialidade: true } },
    },
  },
} satisfies Prisma.ConsultaSelect;

type ConsultaSelecionada = Prisma.ConsultaGetPayload<{
  select: typeof selecao;
}>;

// Achata o horário na resposta; o motivo (texto clínico) não vai para o ADMIN
const paraResposta = (
  { horario, motivo, ...consulta }: ConsultaSelecionada,
  ator: Ator,
): ConsultaResponse => ({
  ...consulta,
  ...(ator.perfil === Perfil.ADMIN ? {} : { motivo }),
  inicio: horario.inicio,
  fim: horario.fim,
  profissional: horario.profissional,
});

// Lê a consulta completa fora da transação, depois do commit. Dentro de uma
// transação interativa, pedir várias relações aninhadas faz o Prisma 7 disparar
// queries paralelas na mesma conexão (aviso de depreciação do pg, erro no pg@9)
async function buscarConsultaCompleta(id: string, ator: Ator) {
  const consulta = await prisma.consulta.findUniqueOrThrow({
    where: { id },
    select: selecao,
  });
  return paraResposta(consulta, ator);
}

// Impede inativar profissional ou unidade com consultas futuras agendadas: o ADMIN
// cancela ou reagenda antes, e nenhum paciente perde a consulta sem saber
export async function exigirSemConsultasFuturas(
  filtro: { profissionalId?: string; unidadeId?: string },
  db: Prisma.TransactionClient,
) {
  const total = await db.consulta.count({
    where: {
      status: StatusConsulta.AGENDADA,
      unidadeId: filtro.unidadeId,
      horario: {
        inicio: { gt: new Date() },
        profissionalId: filtro.profissionalId,
      },
    },
  });
  if (total > 0) {
    throw conflict(
      `Há ${total} consulta(s) futura(s) agendada(s). Cancele ou reagende antes de inativar.`,
    );
  }
}

// Reserva o horário só se ainda estiver DISPONIVEL: com duas requisições
// simultâneas, apenas uma consegue a reserva
async function reservarHorario(
  horarioId: string,
  db: Prisma.TransactionClient,
) {
  const { count } = await db.horarioAgenda.updateMany({
    where: { id: horarioId, status: StatusHorario.DISPONIVEL },
    data: { status: StatusHorario.RESERVADO },
  });
  if (count === 0) throw conflict("Horário indisponível para agendamento.");
}

// Horário agendável: existe, é futuro e o profissional e a unidade estão ativos
async function buscarHorarioAgendavel(
  horarioId: string,
  db: Prisma.TransactionClient,
) {
  const horario = await db.horarioAgenda.findUnique({
    where: { id: horarioId },
    select: {
      id: true,
      inicio: true,
      fim: true,
      profissionalId: true,
      profissional: {
        select: {
          unidadeId: true,
          usuario: { select: { ativo: true } },
          unidade: { select: { ativo: true } },
        },
      },
    },
  });
  if (!horario) throw notFound("Horário não encontrado.");
  if (horario.inicio <= new Date()) {
    throw conflict("Não é possível agendar em um horário que já passou.");
  }
  const { usuario, unidade } = horario.profissional;
  if (!usuario.ativo || !unidade.ativo) {
    throw conflict("Profissional ou unidade indisponível para agendamento.");
  }
  return horario;
}

// O paciente não pode ter duas consultas agendadas no mesmo período,
// mesmo com profissionais diferentes
async function exigirPacienteLivre(
  pacienteId: string,
  periodo: { inicio: Date; fim: Date },
  db: Prisma.TransactionClient,
  ignorarConsultaId?: string,
) {
  const conflitante = await db.consulta.findFirst({
    where: {
      pacienteId,
      status: StatusConsulta.AGENDADA,
      id: ignorarConsultaId ? { not: ignorarConsultaId } : undefined,
      horario: { inicio: { lt: periodo.fim }, fim: { gt: periodo.inicio } },
    },
    select: { id: true },
  });
  if (conflitante) {
    throw conflict("Você já tem uma consulta agendada neste período.");
  }
}

export async function agendarConsulta(
  { horarioId, modalidade, motivo }: AgendarConsultaInput,
  ator: Ator,
) {
  const id = await prisma.$transaction(async (tx) => {
    const pacienteId = await buscarIdDoPaciente(ator.usuarioId, tx);

    // Serializa os agendamentos do mesmo paciente até o fim da transação,
    // para a checagem de conflito não ser driblada por requisições simultâneas
    await tx.$executeRaw`SELECT 1 FROM paciente WHERE id = ${pacienteId}::uuid FOR UPDATE`;

    const horario = await buscarHorarioAgendavel(horarioId, tx);
    await exigirPacienteLivre(pacienteId, horario, tx);
    await reservarHorario(horarioId, tx);

    const { id } = await tx.consulta.create({
      data: {
        pacienteId,
        horarioId,
        unidadeId: horario.profissional.unidadeId,
        modalidade,
        motivo,
      },
      select: { id: true },
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.CONSULTA_AGENDADA,
        entidade: "consulta",
        entidadeId: id,
      },
      tx,
    );
    await notificarConsulta(id, TipoNotificacao.CONSULTA_AGENDADA, tx);

    return id;
  });

  return buscarConsultaCompleta(id, ator);
}

// ---------- Cancelamento e reagendamento (RF12) ----------

// Prazo usual de clínicas para o horário poder ser oferecido a outro paciente
const ANTECEDENCIA_MINIMA_HORAS = 24;

// Carrega a consulta e confere se o ator participa dela. Quem não participa
// recebe 404, para não descobrir quais consultas existem.
async function buscarConsultaGerenciavel(
  id: string,
  ator: Ator,
  db: Prisma.TransactionClient,
) {
  const consulta = await db.consulta.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      pacienteId: true,
      paciente: { select: { usuarioId: true } },
      horario: {
        select: {
          id: true,
          inicio: true,
          profissionalId: true,
          profissional: { select: { usuarioId: true } },
        },
      },
    },
  });

  const ehPaciente = consulta?.paciente.usuarioId === ator.usuarioId;
  const participa =
    ehPaciente ||
    consulta?.horario.profissional.usuarioId === ator.usuarioId ||
    ator.perfil === Perfil.ADMIN;
  if (!consulta || !participa) throw notFound("Consulta não encontrada.");

  if (consulta.status !== StatusConsulta.AGENDADA) {
    throw conflict(
      "Só consultas agendadas podem ser canceladas ou reagendadas.",
    );
  }

  // O prazo vale para o paciente; profissional e ADMIN tratam imprevistos
  const horasAteConsulta =
    (consulta.horario.inicio.getTime() - Date.now()) / (60 * 60 * 1000);
  if (ehPaciente && horasAteConsulta < ANTECEDENCIA_MINIMA_HORAS) {
    throw conflict(
      `Cancelamento e reagendamento exigem ${ANTECEDENCIA_MINIMA_HORAS} horas de antecedência.`,
    );
  }

  return consulta;
}

// Só muda a consulta se ela ainda estiver AGENDADA (evita corrida entre
// cancelamento e reagendamento simultâneos)
async function atualizarSeAgendada(
  id: string,
  data: Prisma.ConsultaUncheckedUpdateManyInput,
  db: Prisma.TransactionClient,
) {
  const { count } = await db.consulta.updateMany({
    where: { id, status: StatusConsulta.AGENDADA },
    data,
  });
  if (count === 0)
    throw conflict("A consulta foi alterada por outra operação.");
}

const liberarHorario = (horarioId: string, db: Prisma.TransactionClient) =>
  db.horarioAgenda.update({
    where: { id: horarioId },
    data: { status: StatusHorario.DISPONIVEL },
  });

// Cancela e devolve o horário para a agenda
export async function cancelarConsulta(
  id: string,
  { motivo }: CancelarConsultaInput,
  ator: Ator,
) {
  await prisma.$transaction(async (tx) => {
    const consulta = await buscarConsultaGerenciavel(id, ator, tx);

    await atualizarSeAgendada(
      id,
      { status: StatusConsulta.CANCELADA, motivoCancelamento: motivo ?? null },
      tx,
    );
    await liberarHorario(consulta.horario.id, tx);

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.CONSULTA_CANCELADA,
        entidade: "consulta",
        entidadeId: id,
      },
      tx,
    );
    await notificarConsulta(id, TipoNotificacao.CONSULTA_CANCELADA, tx);
  });

  return buscarConsultaCompleta(id, ator);
}

// Move a consulta para outro horário livre do mesmo profissional: reserva o
// novo e libera o antigo na mesma transação
export async function reagendarConsulta(
  id: string,
  { horarioId }: ReagendarConsultaInput,
  ator: Ator,
) {
  await prisma.$transaction(async (tx) => {
    const consulta = await buscarConsultaGerenciavel(id, ator, tx);
    if (horarioId === consulta.horario.id) {
      throw conflict("A consulta já está neste horário.");
    }

    await tx.$executeRaw`SELECT 1 FROM paciente WHERE id = ${consulta.pacienteId}::uuid FOR UPDATE`;

    const novo = await buscarHorarioAgendavel(horarioId, tx);
    if (novo.profissionalId !== consulta.horario.profissionalId) {
      throw conflict("O novo horário deve ser do mesmo profissional.");
    }
    await exigirPacienteLivre(consulta.pacienteId, novo, tx, id);
    await reservarHorario(horarioId, tx);

    await atualizarSeAgendada(id, { horarioId }, tx);
    await liberarHorario(consulta.horario.id, tx);

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.CONSULTA_REAGENDADA,
        entidade: "consulta",
        entidadeId: id,
        detalhes: {
          horarioAnteriorId: consulta.horario.id,
          horarioNovoId: horarioId,
        },
      },
      tx,
    );
    await notificarConsulta(id, TipoNotificacao.CONSULTA_REAGENDADA, tx);
  });

  return buscarConsultaCompleta(id, ator);
}

// ---------- Listagem e consulta individual (RF13) ----------

// O paciente vê as próprias consultas; o profissional, as da sua agenda;
// o ADMIN, todas (sem o motivo, removido em paraResposta)
const escopoDoAtor = (ator: Ator): Prisma.ConsultaWhereInput => {
  if (ator.perfil === Perfil.ADMIN) return {};
  if (ator.perfil === Perfil.PACIENTE) {
    return { paciente: { usuarioId: ator.usuarioId } };
  }
  return { horario: { profissional: { usuarioId: ator.usuarioId } } };
};

export async function listarConsultas(
  {
    status,
    de,
    ate,
    pacienteId,
    profissionalId,
    ...paginacao
  }: ListarConsultasQuery,
  ator: Ator,
) {
  const where: Prisma.ConsultaWhereInput = {
    AND: [
      escopoDoAtor(ator),
      {
        status,
        pacienteId,
        horario: {
          profissionalId,
          inicio: {
            gte: de ? intervaloDoDia(de).inicio : undefined,
            lt: ate ? intervaloDoDia(ate).fim : undefined,
          },
        },
      },
    ],
  };

  // Fora de transação: com relações aninhadas, o Prisma 7 dispara queries
  // paralelas, e no pool cada uma usa a própria conexão
  const [consultas, total] = await Promise.all([
    prisma.consulta.findMany({
      where,
      select: selecao,
      orderBy: { horario: { inicio: "asc" } },
      ...toSkipTake(paginacao),
    }),
    prisma.consulta.count({ where }),
  ]);

  return {
    data: consultas.map((consulta) => paraResposta(consulta, ator)),
    meta: buildPaginationMeta(paginacao, total),
  };
}

// Quem não participa da consulta recebe 404
export async function obterConsulta(id: string, ator: Ator) {
  const visivel = await prisma.consulta.findFirst({
    where: { AND: [{ id }, escopoDoAtor(ator)] },
    select: { id: true },
  });
  if (!visivel) throw notFound("Consulta não encontrada.");
  return buscarConsultaCompleta(id, ator);
}
