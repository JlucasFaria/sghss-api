// Regras de negócio das consultas (RF11–RF13)
import {
  Perfil,
  StatusConsulta,
  StatusHorario,
  type Prisma,
} from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { conflict, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import type {
  AgendarConsultaInput,
  ConsultaResponse,
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
    const paciente = await tx.paciente.findUnique({
      where: { usuarioId: ator.usuarioId },
      select: { id: true },
    });
    if (!paciente) throw notFound("Paciente não encontrado.");

    // Serializa os agendamentos do mesmo paciente até o fim da transação,
    // para a checagem de conflito não ser driblada por requisições simultâneas
    await tx.$executeRaw`SELECT 1 FROM paciente WHERE id = ${paciente.id}::uuid FOR UPDATE`;

    const horario = await buscarHorarioAgendavel(horarioId, tx);
    await exigirPacienteLivre(paciente.id, horario, tx);
    await reservarHorario(horarioId, tx);

    const { id } = await tx.consulta.create({
      data: {
        pacienteId: paciente.id,
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

    return id;
  });

  return buscarConsultaCompleta(id, ator);
}
