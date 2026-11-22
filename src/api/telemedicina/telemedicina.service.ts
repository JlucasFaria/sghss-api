// Teleconsulta (RF18, RF19): sala no provedor de vídeo e controle de quem entra e quando
import {
  ModalidadeConsulta,
  StatusConsulta,
  type Prisma,
} from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { badGateway, conflict, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { logger } from "../../utils/logger";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import { provedorVideo } from "./provedor-video";

const selecaoTeleconsulta = {
  id: true,
  consultaId: true,
  provedor: true,
  urlSala: true,
  iniciadaEm: true,
  encerradaEm: true,
  criadoEm: true,
} satisfies Prisma.TeleconsultaSelect;

async function buscarConsulta(id: string) {
  const consulta = await prisma.consulta.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      modalidade: true,
      paciente: { select: { usuarioId: true } },
      horario: {
        select: {
          inicio: true,
          fim: true,
          profissional: { select: { usuarioId: true } },
        },
      },
      teleconsulta: { select: { ...selecaoTeleconsulta, salaId: true } },
    },
  });
  if (!consulta) throw notFound("Consulta não encontrada.");
  return consulta;
}

type ConsultaDaTeleconsulta = Awaited<ReturnType<typeof buscarConsulta>>;

// Só o profissional da consulta gerencia a sala; para os demais ela "não existe"
async function consultaDoProfissional(id: string, ator: Ator) {
  const consulta = await buscarConsulta(id);
  if (consulta.horario.profissional.usuarioId !== ator.usuarioId) {
    throw notFound("Consulta não encontrada.");
  }
  return consulta;
}

const exigirTeleconsultaAgendada = (consulta: ConsultaDaTeleconsulta) => {
  if (consulta.modalidade !== ModalidadeConsulta.TELEMEDICINA) {
    throw conflict("A consulta não é de telemedicina.");
  }
  if (consulta.status !== StatusConsulta.AGENDADA) {
    throw conflict("A consulta não está agendada.");
  }
};

// Falha do provedor externo vira 502, sem expor detalhes internos ao cliente
async function chamarProvedor<T>(operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (error) {
    logger.error("provedor_video_falhou", {
      provedor: provedorVideo().nome,
      error: error instanceof Error ? error.message : String(error),
    });
    throw badGateway(
      "Provedor de vídeo indisponível. Tente novamente em instantes.",
    );
  }
}

// Cria a sala no provedor. Se ela já existe, devolve a mesma (chamada idempotente).
// A sala é criada antes da gravação: se a gravação falhar, a sala fica órfã no
// provedor, onde expira sozinha.
export async function criarSala(consultaId: string, ator: Ator) {
  const consulta = await consultaDoProfissional(consultaId, ator);
  exigirTeleconsultaAgendada(consulta);

  if (consulta.teleconsulta) {
    const { salaId: _, ...existente } = consulta.teleconsulta;
    return { criada: false, teleconsulta: existente };
  }
  if (consulta.horario.fim <= new Date()) {
    throw conflict("O horário da consulta já terminou.");
  }

  const provedor = provedorVideo();
  const sala = await chamarProvedor(() =>
    provedor.criarSala({
      consultaId,
      inicio: consulta.horario.inicio,
      fim: consulta.horario.fim,
    }),
  );

  const teleconsulta = await prisma.$transaction(async (tx) => {
    const criada = await tx.teleconsulta.create({
      data: { consultaId, provedor: provedor.nome, ...sala },
      select: selecaoTeleconsulta,
    });
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.TELECONSULTA_CRIADA,
        entidade: "consulta",
        entidadeId: consultaId,
      },
      tx,
    );
    return criada;
  });

  return { criada: true, teleconsulta };
}
