// Teleconsulta (RF18, RF19): sala no provedor de vídeo, entrada na janela de horário
// e encerramento, que conclui a consulta
import {
  ModalidadeConsulta,
  Prisma,
  StatusConsulta,
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

const exigirTelemedicina = (consulta: ConsultaDaTeleconsulta) => {
  if (consulta.modalidade !== ModalidadeConsulta.TELEMEDICINA) {
    throw conflict("A consulta não é de telemedicina.");
  }
};

const exigirTeleconsultaAgendada = (consulta: ConsultaDaTeleconsulta) => {
  exigirTelemedicina(consulta);
  if (consulta.status !== StatusConsulta.AGENDADA) {
    throw conflict("A consulta não está agendada.");
  }
};

const MINUTO = 60 * 1000;
// A sala abre 15 min antes do início e aceita entradas até 30 min após o fim previsto
const ABERTURA_ANTECIPADA_MIN = 15;
const TOLERANCIA_ATRASO_MIN = 30;

// Fim da janela da teleconsulta: limite para criar a sala, entrar e validade do token
const fimDaJanela = (consulta: ConsultaDaTeleconsulta) =>
  new Date(consulta.horario.fim.getTime() + TOLERANCIA_ATRASO_MIN * MINUTO);

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
  if (fimDaJanela(consulta) <= new Date()) {
    throw conflict("A janela desta teleconsulta já terminou.");
  }

  const provedor = provedorVideo();
  const sala = await chamarProvedor(() =>
    provedor.criarSala({
      consultaId,
      inicio: consulta.horario.inicio,
      fim: consulta.horario.fim,
    }),
  );

  try {
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
  } catch (error) {
    // Duas criações simultâneas: a outra gravou primeiro; devolve a sala dela
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existente = await prisma.teleconsulta.findUniqueOrThrow({
        where: { consultaId },
        select: selecaoTeleconsulta,
      });
      return { criada: false, teleconsulta: existente };
    }
    throw error;
  }
}

// ---------- Entrada e encerramento (RF19) ----------

// Sala existente e ainda não encerrada
const exigirSalaAberta = (consulta: ConsultaDaTeleconsulta) => {
  const sala = consulta.teleconsulta;
  if (!sala) throw conflict("A sala ainda não foi criada pelo profissional.");
  if (sala.encerradaEm) throw conflict("A teleconsulta já foi encerrada.");
  return sala;
};

// Só o paciente e o profissional da consulta entram, dentro da janela de horário
export async function entrarNaTeleconsulta(consultaId: string, ator: Ator) {
  const consulta = await buscarConsulta(consultaId);
  const participante =
    consulta.paciente.usuarioId === ator.usuarioId ||
    consulta.horario.profissional.usuarioId === ator.usuarioId;
  if (!participante) throw notFound("Consulta não encontrada.");

  exigirTeleconsultaAgendada(consulta);
  const sala = exigirSalaAberta(consulta);

  const agora = Date.now();
  const abertura =
    consulta.horario.inicio.getTime() - ABERTURA_ANTECIPADA_MIN * MINUTO;
  const expiraEm = fimDaJanela(consulta);
  if (agora < abertura) {
    throw conflict(
      `A sala abre ${ABERTURA_ANTECIPADA_MIN} minutos antes do horário da consulta.`,
    );
  }
  if (agora > expiraEm.getTime()) {
    throw conflict("O horário desta teleconsulta já terminou.");
  }

  const token = await chamarProvedor(() =>
    provedorVideo().gerarToken({
      salaId: sala.salaId,
      participanteId: ator.usuarioId,
      expiraEm,
    }),
  );

  await prisma.$transaction(async (tx) => {
    // A primeira entrada marca o início da teleconsulta
    await tx.teleconsulta.updateMany({
      where: { id: sala.id, iniciadaEm: null },
      data: { iniciadaEm: new Date() },
    });
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.TELECONSULTA_ENTRADA,
        entidade: "consulta",
        entidadeId: consultaId,
      },
      tx,
    );
  });

  return { urlSala: sala.urlSala, token, expiraEm };
}

// Encerra a sala no provedor e conclui a consulta (REALIZADA). Só o profissional
// da consulta, depois que a teleconsulta foi iniciada. Se a consulta já foi
// concluída pelo prontuário, só fecha a sala, sem mexer no status.
export async function encerrarTeleconsulta(consultaId: string, ator: Ator) {
  const consulta = await consultaDoProfissional(consultaId, ator);
  exigirTelemedicina(consulta);
  if (consulta.status === StatusConsulta.CANCELADA) {
    throw conflict("A consulta foi cancelada.");
  }
  const sala = exigirSalaAberta(consulta);
  if (!sala.iniciadaEm) {
    throw conflict("Ninguém entrou na teleconsulta ainda.");
  }

  await chamarProvedor(() => provedorVideo().encerrarSala(sala.salaId));

  return prisma.$transaction(async (tx) => {
    // Condicional: com dois encerramentos simultâneos, só um vale
    const { count } = await tx.teleconsulta.updateMany({
      where: { id: sala.id, encerradaEm: null },
      data: { encerradaEm: new Date() },
    });
    if (count === 0) throw conflict("A teleconsulta já foi encerrada.");

    // Condicional: não sobrescreve um cancelamento feito ao mesmo tempo
    // (consulta já REALIZADA pelo prontuário continua REALIZADA)
    const concluida = await tx.consulta.updateMany({
      where: { id: consultaId, status: { not: StatusConsulta.CANCELADA } },
      data: { status: StatusConsulta.REALIZADA },
    });
    if (concluida.count === 0) {
      throw conflict("A consulta foi cancelada por outra operação.");
    }
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.TELECONSULTA_ENCERRADA,
        entidade: "consulta",
        entidadeId: consultaId,
      },
      tx,
    );

    return tx.teleconsulta.findUniqueOrThrow({
      where: { id: sala.id },
      select: selecaoTeleconsulta,
    });
  });
}
