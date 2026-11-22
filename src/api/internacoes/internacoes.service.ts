// Internações (RF28): internar ocupa o leito, transferir troca de leito e a alta o
// libera. Internação e status dos leitos mudam sempre na mesma transação.
import { StatusLeito, type Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { conflict, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { buildPaginationMeta, toSkipTake } from "../../utils/pagination";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import type {
  InternarInput,
  ListarInternacoesQuery,
  TransferenciaInput,
} from "./internacoes.schema";

const referencia = { select: { id: true, nome: true } } as const;

const selecao = {
  id: true,
  admitidoEm: true,
  altaEm: true,
  paciente: referencia,
  leito: {
    select: { id: true, codigo: true, ala: true, unidade: referencia },
  },
} satisfies Prisma.InternacaoSelect;

// Lida depois do commit: com relações aninhadas, o Prisma 7 dispara queries
// paralelas, o que não é permitido na conexão de uma transação
const buscarInternacaoCompleta = (id: string) =>
  prisma.internacao.findUniqueOrThrow({ where: { id }, select: selecao });

const filtroSituacao = {
  ATIVA: null,
  ENCERRADA: { not: null },
} satisfies Record<string, Prisma.InternacaoWhereInput["altaEm"]>;

// Impede inativar uma unidade com pacientes internados: eles ficariam em uma
// unidade inativa e sumiriam do relatório de ocupação. O ADMIN dá alta ou transfere antes.
export async function exigirSemInternacoesAtivas(
  unidadeId: string,
  db: Prisma.TransactionClient,
) {
  const total = await db.internacao.count({
    where: { altaEm: null, leito: { unidadeId } },
  });
  if (total > 0) {
    throw conflict(
      `Há ${total} paciente(s) internado(s). Dê alta ou transfira antes de inativar.`,
    );
  }
}

export async function listarInternacoes({
  situacao,
  unidadeId,
  pacienteId,
  ...paginacao
}: ListarInternacoesQuery) {
  const where: Prisma.InternacaoWhereInput = {
    pacienteId,
    leito: unidadeId ? { unidadeId } : undefined,
    altaEm: situacao ? filtroSituacao[situacao] : undefined,
  };

  const [internacoes, total] = await Promise.all([
    prisma.internacao.findMany({
      where,
      select: selecao,
      orderBy: [{ admitidoEm: "desc" }, { id: "desc" }],
      ...toSkipTake(paginacao),
    }),
    prisma.internacao.count({ where }),
  ]);

  return { data: internacoes, meta: buildPaginationMeta(paginacao, total) };
}

// Ocupa o leito só se estiver LIVRE e a unidade ativa. A condição vai na própria
// escrita: com duas internações simultâneas no mesmo leito, só uma consegue.
async function ocuparLeito(leitoId: string, db: Prisma.TransactionClient) {
  const leito = await db.leito.findUnique({
    where: { id: leitoId },
    select: { unidade: { select: { ativo: true } } },
  });
  if (!leito) throw notFound("Leito não encontrado.");
  if (!leito.unidade.ativo) throw conflict("A unidade do leito está inativa.");

  const { count } = await db.leito.updateMany({
    where: { id: leitoId, status: StatusLeito.LIVRE },
    data: { status: StatusLeito.OCUPADO },
  });
  if (count === 0) throw conflict("O leito não está livre.");
}

const liberarLeito = (leitoId: string, db: Prisma.TransactionClient) =>
  db.leito.update({
    where: { id: leitoId },
    data: { status: StatusLeito.LIVRE },
  });

export async function internar(
  { pacienteId, leitoId, motivo }: InternarInput,
  ator: Ator,
) {
  const id = await prisma.$transaction(async (tx) => {
    // Serializa as internações do mesmo paciente: a checagem de internação ativa
    // não pode ser driblada por requisições simultâneas
    await tx.$executeRaw`SELECT 1 FROM paciente WHERE id = ${pacienteId}::uuid FOR UPDATE`;

    const paciente = await tx.paciente.findUnique({
      where: { id: pacienteId },
      select: { anonimizadoEm: true },
    });
    if (!paciente) throw notFound("Paciente não encontrado.");
    if (paciente.anonimizadoEm) throw conflict("O paciente foi anonimizado.");

    const ativas = await tx.internacao.count({
      where: { pacienteId, altaEm: null },
    });
    if (ativas > 0) throw conflict("O paciente já está internado.");

    await ocuparLeito(leitoId, tx);
    const { id } = await tx.internacao.create({
      data: { pacienteId, leitoId, motivo },
      select: { id: true },
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.INTERNACAO_REGISTRADA,
        entidade: "internacao",
        entidadeId: id,
        detalhes: { leitoId },
      },
      tx,
    );
    return id;
  });

  return buscarInternacaoCompleta(id);
}

// Trava a internação até o fim da transação: transferência e alta simultâneas
// não podem liberar o leito errado
async function buscarInternacaoAtiva(id: string, db: Prisma.TransactionClient) {
  await db.$executeRaw`SELECT 1 FROM internacao WHERE id = ${id}::uuid FOR UPDATE`;

  const internacao = await db.internacao.findUnique({
    where: { id },
    select: { leitoId: true, altaEm: true },
  });
  if (!internacao) throw notFound("Internação não encontrada.");
  if (internacao.altaEm) throw conflict("A internação já foi encerrada.");
  return internacao;
}

export async function transferir(
  id: string,
  { leitoId }: TransferenciaInput,
  ator: Ator,
) {
  await prisma.$transaction(async (tx) => {
    const { leitoId: origem } = await buscarInternacaoAtiva(id, tx);
    if (origem === leitoId) throw conflict("O paciente já está neste leito.");

    await ocuparLeito(leitoId, tx);
    await tx.internacao.update({ where: { id }, data: { leitoId } });
    await liberarLeito(origem, tx);

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.INTERNACAO_TRANSFERIDA,
        entidade: "internacao",
        entidadeId: id,
        detalhes: { leitoOrigemId: origem, leitoDestinoId: leitoId },
      },
      tx,
    );
  });

  return buscarInternacaoCompleta(id);
}

export async function darAlta(id: string, ator: Ator) {
  await prisma.$transaction(async (tx) => {
    const { leitoId } = await buscarInternacaoAtiva(id, tx);

    await tx.internacao.update({
      where: { id },
      data: { altaEm: new Date() },
    });
    await liberarLeito(leitoId, tx);

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.INTERNACAO_ALTA,
        entidade: "internacao",
        entidadeId: id,
      },
      tx,
    );
  });

  return buscarInternacaoCompleta(id);
}
