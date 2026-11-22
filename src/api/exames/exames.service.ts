// Regras de negócio dos exames (RF14): agendamento pelo paciente e resultado
// registrado por um profissional da unidade do exame
import {
  Perfil,
  StatusExame,
  type Prisma,
} from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { badRequest, conflict, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { decrypt, encrypt } from "../../utils/crypto";
import { buildPaginationMeta, toSkipTake } from "../../utils/pagination";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import type {
  AgendarExameInput,
  ExameResponse,
  ListarExamesQuery,
  ResultadoExameInput,
} from "./exames.schema";

const referencia = { select: { id: true, nome: true } } as const;

const selecao = {
  id: true,
  tipo: true,
  dataHora: true,
  status: true,
  resultadoCifrado: true,
  resultadoEm: true,
  paciente: referencia,
  unidade: referencia,
  responsavel: referencia,
} satisfies Prisma.ExameSelect;

type ExameSelecionado = Prisma.ExameGetPayload<{ select: typeof selecao }>;

const paraResposta = ({
  resultadoCifrado,
  ...exame
}: ExameSelecionado): ExameResponse => ({
  ...exame,
  resultado: resultadoCifrado ? decrypt(resultadoCifrado) : null,
});

// O paciente vê os próprios exames; o profissional, os da unidade em que atua.
// O ADMIN não chega aqui (RBAC na rota): resultado de exame é dado clínico.
const escopoDoAtor = (ator: Ator): Prisma.ExameWhereInput =>
  ator.perfil === Perfil.PACIENTE
    ? { paciente: { usuarioId: ator.usuarioId } }
    : { unidade: { profissionais: { some: { usuarioId: ator.usuarioId } } } };

// Leitura completa fora de transação: com relações aninhadas, o Prisma 7 dispara
// queries paralelas, que só são seguras no pool (cada uma em sua conexão)
async function buscarExameCompleto(id: string) {
  return paraResposta(
    await prisma.exame.findUniqueOrThrow({ where: { id }, select: selecao }),
  );
}

export async function agendarExame(
  { unidadeId, tipo, dataHora }: AgendarExameInput,
  ator: Ator,
) {
  const id = await prisma.$transaction(async (tx) => {
    const paciente = await tx.paciente.findUnique({
      where: { usuarioId: ator.usuarioId },
      select: { id: true },
    });
    if (!paciente) throw notFound("Paciente não encontrado.");

    const unidade = await tx.unidade.findUnique({
      where: { id: unidadeId },
      select: { ativo: true },
    });
    if (!unidade?.ativo) throw badRequest("Unidade inexistente ou inativa.");

    const { id } = await tx.exame.create({
      data: { pacienteId: paciente.id, unidadeId, tipo, dataHora },
      select: { id: true },
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.EXAME_AGENDADO,
        entidade: "exame",
        entidadeId: id,
      },
      tx,
    );

    return id;
  });

  return buscarExameCompleto(id);
}

export async function listarExames(
  { status, ...paginacao }: ListarExamesQuery,
  ator: Ator,
) {
  const where: Prisma.ExameWhereInput = {
    AND: [escopoDoAtor(ator), { status }],
  };

  const [exames, total] = await Promise.all([
    prisma.exame.findMany({
      where,
      select: selecao,
      orderBy: { dataHora: "desc" },
      ...toSkipTake(paginacao),
    }),
    prisma.exame.count({ where }),
  ]);

  return {
    data: exames.map(paraResposta),
    meta: buildPaginationMeta(paginacao, total),
  };
}

// Fora do escopo do ator a resposta é 404, sem revelar que o exame existe
export async function obterExame(id: string, ator: Ator) {
  const visivel = await prisma.exame.findFirst({
    where: { AND: [{ id }, escopoDoAtor(ator)] },
    select: { id: true },
  });
  if (!visivel) throw notFound("Exame não encontrado.");
  return buscarExameCompleto(id);
}

export async function registrarResultado(
  id: string,
  { resultado }: ResultadoExameInput,
  ator: Ator,
) {
  await prisma.$transaction(async (tx) => {
    const exame = await tx.exame.findFirst({
      where: { AND: [{ id }, escopoDoAtor(ator)] },
      select: { dataHora: true },
    });
    if (!exame) throw notFound("Exame não encontrado.");
    if (exame.dataHora > new Date()) {
      throw conflict(
        "O resultado só pode ser registrado após a realização do exame.",
      );
    }

    const profissional = await tx.profissional.findUniqueOrThrow({
      where: { usuarioId: ator.usuarioId },
      select: { id: true },
    });

    // Atualização condicional: só um resultado por exame, mesmo com envios simultâneos
    const { count } = await tx.exame.updateMany({
      where: { id, status: StatusExame.AGENDADO },
      data: {
        status: StatusExame.REALIZADO,
        resultadoCifrado: encrypt(resultado),
        resultadoEm: new Date(),
        responsavelId: profissional.id,
      },
    });
    if (count === 0) {
      throw conflict("Só exames agendados podem receber resultado.");
    }

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.EXAME_RESULTADO_REGISTRADO,
        entidade: "exame",
        entidadeId: id,
      },
      tx,
    );
  });

  return buscarExameCompleto(id);
}
