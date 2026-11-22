// Regras de negócio das unidades de atendimento (RF05)
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { buildPaginationMeta, toSkipTake } from "../../utils/pagination";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import { exigirSemConsultasFuturas } from "../consultas/consultas.service";
import type {
  ListarUnidadesQuery,
  UnidadeInput,
  UnidadeUpdateInput,
} from "./unidades.schema";

// Unidades inativas só aparecem para quem administra o cadastro
export async function listarUnidades(
  { tipo, ...paginacao }: ListarUnidadesQuery,
  incluirInativas: boolean,
) {
  const where: Prisma.UnidadeWhereInput = {
    tipo,
    ativo: incluirInativas ? undefined : true,
  };

  const [unidades, total] = await prisma.$transaction([
    prisma.unidade.findMany({
      where,
      orderBy: { nome: "asc" },
      ...toSkipTake(paginacao),
    }),
    prisma.unidade.count({ where }),
  ]);

  return { data: unidades, meta: buildPaginationMeta(paginacao, total) };
}

export async function buscarUnidade(
  id: string,
  db: Prisma.TransactionClient = prisma,
) {
  const unidade = await db.unidade.findUnique({ where: { id } });
  if (!unidade) throw notFound("Unidade não encontrada.");
  return unidade;
}

// Consulta pública: unidade inativa só é visível para o ADMIN (igual à listagem)
export async function obterUnidade(id: string, admin: boolean) {
  const unidade = await buscarUnidade(id);
  if (!unidade.ativo && !admin) throw notFound("Unidade não encontrada.");
  return unidade;
}

export function criarUnidade(input: UnidadeInput, ator: Ator) {
  return prisma.$transaction(async (tx) => {
    const unidade = await tx.unidade.create({ data: input });
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.UNIDADE_CRIADA,
        entidade: "unidade",
        entidadeId: unidade.id,
      },
      tx,
    );
    return unidade;
  });
}

export function atualizarUnidade(
  id: string,
  input: UnidadeUpdateInput,
  ator: Ator,
) {
  return prisma.$transaction(async (tx) => {
    await buscarUnidade(id, tx);
    if (input.ativo === false) {
      await exigirSemConsultasFuturas({ unidadeId: id }, tx);
    }
    const unidade = await tx.unidade.update({ where: { id }, data: input });
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.UNIDADE_ATUALIZADA,
        entidade: "unidade",
        entidadeId: id,
      },
      tx,
    );
    return unidade;
  });
}

// Inativação lógica: profissionais, leitos e históricos vinculados são preservados
export function inativarUnidade(id: string, ator: Ator) {
  return prisma.$transaction(async (tx) => {
    await buscarUnidade(id, tx);
    await exigirSemConsultasFuturas({ unidadeId: id }, tx);
    await tx.unidade.update({ where: { id }, data: { ativo: false } });
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.UNIDADE_INATIVADA,
        entidade: "unidade",
        entidadeId: id,
      },
      tx,
    );
  });
}
