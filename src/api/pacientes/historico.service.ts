// Histórico clínico (RF10): o paciente vê o seu; o profissional, o de quem atende
import { StatusConsulta, type Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { forbidden, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { decrypt } from "../../utils/crypto";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import type { Historico } from "./historico.schema";

const referencia = { select: { id: true, nome: true } } as const;

// Tudo do paciente em uma consulta, do mais recente para o mais antigo
const selecao = {
  id: true,
  nome: true,
  consultas: {
    orderBy: { horario: { inicio: "desc" } },
    select: {
      id: true,
      modalidade: true,
      status: true,
      motivo: true,
      unidade: referencia,
      horario: {
        select: {
          inicio: true,
          fim: true,
          profissional: {
            select: { id: true, nome: true, especialidade: true },
          },
        },
      },
      prescricoes: {
        orderBy: { emitidaEm: "desc" },
        select: {
          id: true,
          consultaId: true,
          emitidaEm: true,
          validaAte: true,
          observacoes: true,
          itens: {
            select: {
              medicamento: true,
              dosagem: true,
              posologia: true,
              quantidade: true,
            },
          },
        },
      },
    },
  },
  exames: {
    orderBy: { dataHora: "desc" },
    select: {
      id: true,
      tipo: true,
      dataHora: true,
      status: true,
      resultadoCifrado: true,
      resultadoEm: true,
      unidade: referencia,
      responsavel: referencia,
    },
  },
  internacoes: {
    orderBy: { admitidoEm: "desc" },
    select: {
      id: true,
      motivo: true,
      admitidoEm: true,
      altaEm: true,
      leito: { select: { codigo: true, ala: true, unidade: referencia } },
    },
  },
} satisfies Prisma.PacienteSelect;

type PacienteComHistorico = Prisma.PacienteGetPayload<{
  select: typeof selecao;
}>;

const paraHistorico = (p: PacienteComHistorico): Historico => ({
  paciente: { id: p.id, nome: p.nome },
  consultas: p.consultas.map(({ horario, prescricoes: _, ...consulta }) => ({
    ...consulta,
    inicio: horario.inicio,
    fim: horario.fim,
    profissional: horario.profissional,
  })),
  exames: p.exames.map(({ resultadoCifrado, ...exame }) => ({
    ...exame,
    resultado: resultadoCifrado ? decrypt(resultadoCifrado) : null,
  })),
  prescricoes: p.consultas
    .flatMap((consulta) => consulta.prescricoes)
    .sort((a, b) => b.emitidaEm.getTime() - a.emitidaEm.getTime())
    .map((prescricao) => ({
      ...prescricao,
      validaAte: prescricao.validaAte.toISOString().slice(0, 10),
    })),
  internacoes: p.internacoes,
});

async function carregarHistorico(where: Prisma.PacienteWhereUniqueInput) {
  const paciente = await prisma.paciente.findUnique({ where, select: selecao });
  if (!paciente) throw notFound("Paciente não encontrado.");
  return paraHistorico(paciente);
}

export function meuHistorico(usuarioId: string) {
  return carregarHistorico({ usuarioId });
}

// O profissional atende o paciente se tem com ele consulta agendada ou realizada,
// ou se é o responsável por algum exame dele
async function atendePaciente(usuarioId: string, pacienteId: string) {
  const vinculo = await prisma.profissional.findFirst({
    where: {
      usuarioId,
      OR: [
        {
          horarios: {
            some: {
              consultas: {
                some: {
                  pacienteId,
                  status: {
                    in: [StatusConsulta.AGENDADA, StatusConsulta.REALIZADA],
                  },
                },
              },
            },
          },
        },
        { exames: { some: { pacienteId } } },
      ],
    },
    select: { id: true },
  });
  return vinculo !== null;
}

export async function historicoDoPaciente(pacienteId: string, ator: Ator) {
  const existe = await prisma.paciente.findUnique({
    where: { id: pacienteId },
    select: { id: true },
  });
  if (!existe) throw notFound("Paciente não encontrado.");

  if (!(await atendePaciente(ator.usuarioId, pacienteId))) {
    throw forbidden("Você só pode ver o histórico de pacientes que atende.");
  }

  const historico = await carregarHistorico({ id: pacienteId });

  await registrarAuditoria({
    ...ator,
    acao: AcaoAuditoria.HISTORICO_CONSULTADO,
    entidade: "paciente",
    entidadeId: pacienteId,
  });

  return historico;
}
