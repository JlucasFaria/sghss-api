// Lançamentos financeiros (RF31): somente inclusão. Uma correção é um novo
// lançamento de sentido contrário (estorno), preservando o histórico contábil.
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { conflict } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { buildPaginationMeta, toSkipTake } from "../../utils/pagination";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import { buscarUnidade } from "../unidades/unidades.service";
import type {
  CriarLancamentoInput,
  ListarLancamentosQuery,
} from "./financeiro.schema";

const selecao = {
  id: true,
  tipo: true,
  categoria: true,
  descricao: true,
  valor: true,
  competencia: true,
  unidade: { select: { id: true, nome: true } },
  criadoEm: true,
} satisfies Prisma.LancamentoFinanceiroSelect;

type LancamentoSelecionado = Prisma.LancamentoFinanceiroGetPayload<{
  select: typeof selecao;
}>;

const paraResposta = ({ valor, competencia, ...l }: LancamentoSelecionado) => ({
  ...l,
  valor: valor.toFixed(2),
  competencia: competencia.toISOString().slice(0, 10),
});

// Colunas date: "AAAA-MM-DD" vira meia-noite UTC, o mesmo formato gravado no banco
export const filtroCompetencia = (de?: string, ate?: string) => ({
  gte: de ? new Date(de) : undefined,
  lte: ate ? new Date(ate) : undefined,
});

export async function listarLancamentos({
  unidadeId,
  tipo,
  de,
  ate,
  ...paginacao
}: ListarLancamentosQuery) {
  const where: Prisma.LancamentoFinanceiroWhereInput = {
    unidadeId,
    tipo,
    competencia: filtroCompetencia(de, ate),
  };

  const [lancamentos, total] = await Promise.all([
    prisma.lancamentoFinanceiro.findMany({
      where,
      select: selecao,
      orderBy: [{ competencia: "desc" }, { criadoEm: "desc" }, { id: "desc" }],
      ...toSkipTake(paginacao),
    }),
    prisma.lancamentoFinanceiro.count({ where }),
  ]);

  return {
    data: lancamentos.map(paraResposta),
    meta: buildPaginationMeta(paginacao, total),
  };
}

export async function criarLancamento(
  { competencia, ...input }: CriarLancamentoInput,
  ator: Ator,
) {
  const id = await prisma.$transaction(async (tx) => {
    const unidade = await buscarUnidade(input.unidadeId, tx);
    if (!unidade.ativo) throw conflict("A unidade está inativa.");

    const { id } = await tx.lancamentoFinanceiro.create({
      data: { ...input, competencia: new Date(competencia) },
      select: { id: true },
    });
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.LANCAMENTO_REGISTRADO,
        entidade: "lancamento_financeiro",
        entidadeId: id,
        detalhes: { tipo: input.tipo },
      },
      tx,
    );
    return id;
  });

  return paraResposta(
    await prisma.lancamentoFinanceiro.findUniqueOrThrow({
      where: { id },
      select: selecao,
    }),
  );
}
