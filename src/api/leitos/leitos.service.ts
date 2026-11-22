// Regras de negócio dos leitos (RF27). O status OCUPADO é controlado pelas
// internações; aqui o ADMIN só alterna entre LIVRE e MANUTENCAO.
import { StatusLeito, type Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { conflict, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { buildPaginationMeta, toSkipTake } from "../../utils/pagination";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import { buscarUnidade } from "../unidades/unidades.service";
import type {
  AtualizarLeitoInput,
  CriarLeitoInput,
  ListarLeitosQuery,
} from "./leitos.schema";

export const selecaoLeito = {
  id: true,
  codigo: true,
  ala: true,
  tipo: true,
  status: true,
  unidade: { select: { id: true, nome: true } },
  criadoEm: true,
  atualizadoEm: true,
} satisfies Prisma.LeitoSelect;

async function buscarLeito(id: string, db: Prisma.TransactionClient = prisma) {
  const leito = await db.leito.findUnique({
    where: { id },
    select: selecaoLeito,
  });
  if (!leito) throw notFound("Leito não encontrado.");
  return leito;
}

export async function listarLeitos({
  unidadeId,
  status,
  tipo,
  ...paginacao
}: ListarLeitosQuery) {
  const where: Prisma.LeitoWhereInput = { unidadeId, status, tipo };

  const [leitos, total] = await Promise.all([
    prisma.leito.findMany({
      where,
      select: selecaoLeito,
      orderBy: [
        { unidade: { nome: "asc" } },
        { ala: "asc" },
        { codigo: "asc" },
      ],
      ...toSkipTake(paginacao),
    }),
    prisma.leito.count({ where }),
  ]);

  return { data: leitos, meta: buildPaginationMeta(paginacao, total) };
}

export const obterLeito = (id: string) => buscarLeito(id);

// Código repetido na mesma unidade viola a unicidade e vira 409 no error handler
export function criarLeito(input: CriarLeitoInput, ator: Ator) {
  return prisma.$transaction(async (tx) => {
    const unidade = await buscarUnidade(input.unidadeId, tx);
    if (!unidade.ativo) throw conflict("A unidade está inativa.");

    const leito = await tx.leito.create({ data: input, select: selecaoLeito });
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.LEITO_CRIADO,
        entidade: "leito",
        entidadeId: leito.id,
      },
      tx,
    );
    return leito;
  });
}

// Os dados do leito podem ser corrigidos a qualquer momento; já o status de um leito
// ocupado só muda pela internação. A condição vai na própria escrita: se uma
// internação ocupar o leito ao mesmo tempo, a troca de status não acontece (409).
export function atualizarLeito(
  id: string,
  input: AtualizarLeitoInput,
  ator: Ator,
) {
  return prisma.$transaction(async (tx) => {
    await buscarLeito(id, tx);

    const { count } = await tx.leito.updateMany({
      where: input.status
        ? { id, status: { not: StatusLeito.OCUPADO } }
        : { id },
      data: input,
    });
    if (count === 0) {
      throw conflict(
        "O status de um leito ocupado só muda com a alta ou a transferência do paciente.",
      );
    }

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.LEITO_ATUALIZADO,
        entidade: "leito",
        entidadeId: id,
        detalhes: { status: input.status ?? null },
      },
      tx,
    );
    return buscarLeito(id, tx);
  });
}

// Leito sem nenhuma internação (cadastro errado) é excluído. Com histórico, a
// internação precisa continuar apontando para ele: o ADMIN usa MANUTENCAO.
export function excluirLeito(id: string, ator: Ator) {
  return prisma.$transaction(async (tx) => {
    await buscarLeito(id, tx);

    const internacoes = await tx.internacao.count({ where: { leitoId: id } });
    if (internacoes > 0) {
      throw conflict(
        "Leito com histórico de internações não pode ser excluído. Use o status MANUTENCAO para retirá-lo de uso.",
      );
    }

    await tx.leito.delete({ where: { id } });
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.LEITO_EXCLUIDO,
        entidade: "leito",
        entidadeId: id,
      },
      tx,
    );
  });
}
