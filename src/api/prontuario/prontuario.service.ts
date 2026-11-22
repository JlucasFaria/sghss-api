// Prontuário (RF15): evoluções cifradas vinculadas à consulta e conclusão do atendimento.
// Somente inclusão: correções geram um novo registro, preservando o histórico.
import {
  Perfil,
  StatusConsulta,
  type Prisma,
} from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { conflict, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { decrypt, encrypt } from "../../utils/crypto";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import type { RegistrarEvolucaoInput } from "./prontuario.schema";

// Dados da consulta usados nas regras de acesso do prontuário
async function buscarConsulta(id: string, db: Prisma.TransactionClient) {
  const consulta = await db.consulta.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      unidadeId: true,
      paciente: { select: { usuarioId: true } },
      horario: {
        select: {
          inicio: true,
          profissional: { select: { usuarioId: true } },
        },
      },
    },
  });
  if (!consulta) throw notFound("Consulta não encontrada.");
  return consulta;
}

type ConsultaDoProntuario = Awaited<ReturnType<typeof buscarConsulta>>;

// O profissional da consulta (mesmo que tenha mudado de unidade) ou um profissional
// lotado na unidade dela (médico, enfermagem ou técnico). Quem não pode acessar
// recebe 404, sem descobrir que a consulta existe.
async function profissionalComAcesso(
  consulta: ConsultaDoProntuario,
  ator: Ator,
  db: Prisma.TransactionClient,
) {
  const profissional = await db.profissional.findUnique({
    where: { usuarioId: ator.usuarioId },
    select: { id: true, unidadeId: true },
  });
  const daConsulta = consulta.horario.profissional.usuarioId === ator.usuarioId;
  if (
    !profissional ||
    (!daConsulta && profissional.unidadeId !== consulta.unidadeId)
  ) {
    throw notFound("Consulta não encontrada.");
  }
  return profissional;
}

const exigirConsultaIniciada = (consulta: ConsultaDoProntuario) => {
  if (consulta.status === StatusConsulta.CANCELADA) {
    throw conflict("Consulta cancelada não recebe registros clínicos.");
  }
  if (consulta.horario.inicio > new Date()) {
    throw conflict("A consulta ainda não começou.");
  }
};

const selecaoEvolucao = {
  id: true,
  conteudoCifrado: true,
  criadoEm: true,
  autor: { select: { id: true, nome: true } },
} satisfies Prisma.RegistroProntuarioSelect;

const paraResposta = ({
  conteudoCifrado,
  ...evolucao
}: Prisma.RegistroProntuarioGetPayload<{
  select: typeof selecaoEvolucao;
}>) => ({
  ...evolucao,
  conteudo: decrypt(conteudoCifrado),
});

export function registrarEvolucao(
  consultaId: string,
  { conteudo }: RegistrarEvolucaoInput,
  ator: Ator,
) {
  return prisma.$transaction(async (tx) => {
    const consulta = await buscarConsulta(consultaId, tx);
    const autor = await profissionalComAcesso(consulta, ator, tx);
    exigirConsultaIniciada(consulta);

    const evolucao = await tx.registroProntuario.create({
      data: {
        consultaId,
        autorId: autor.id,
        conteudoCifrado: encrypt(conteudo),
      },
      select: selecaoEvolucao,
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.PRONTUARIO_REGISTRADO,
        entidade: "consulta",
        entidadeId: consultaId,
      },
      tx,
    );

    return paraResposta(evolucao);
  });
}

// O paciente lê o próprio prontuário (direito do titular); os profissionais da
// unidade também, e essa leitura é auditada. O ADMIN é barrado pelo RBAC da rota.
export async function listarEvolucoes(consultaId: string, ator: Ator) {
  const consulta = await buscarConsulta(consultaId, prisma);

  if (ator.perfil === Perfil.PACIENTE) {
    if (consulta.paciente.usuarioId !== ator.usuarioId) {
      throw notFound("Consulta não encontrada.");
    }
  } else {
    await profissionalComAcesso(consulta, ator, prisma);
    await registrarAuditoria({
      ...ator,
      acao: AcaoAuditoria.PRONTUARIO_CONSULTADO,
      entidade: "consulta",
      entidadeId: consultaId,
    });
  }

  const evolucoes = await prisma.registroProntuario.findMany({
    where: { consultaId },
    select: selecaoEvolucao,
    orderBy: { criadoEm: "asc" },
  });
  return evolucoes.map(paraResposta);
}

// Conclui o atendimento: só o profissional da consulta, depois do início e com
// ao menos uma evolução registrada
export function concluirConsulta(consultaId: string, ator: Ator) {
  return prisma.$transaction(async (tx) => {
    const consulta = await buscarConsulta(consultaId, tx);
    if (consulta.horario.profissional.usuarioId !== ator.usuarioId) {
      throw notFound("Consulta não encontrada.");
    }
    exigirConsultaIniciada(consulta);

    const evolucoes = await tx.registroProntuario.count({
      where: { consultaId },
    });
    if (evolucoes === 0) {
      throw conflict("Registre ao menos uma evolução antes de concluir.");
    }

    const { count } = await tx.consulta.updateMany({
      where: { id: consultaId, status: StatusConsulta.AGENDADA },
      data: { status: StatusConsulta.REALIZADA },
    });
    if (count === 0) throw conflict("A consulta já foi concluída.");

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.CONSULTA_REALIZADA,
        entidade: "consulta",
        entidadeId: consultaId,
      },
      tx,
    );
  });
}
