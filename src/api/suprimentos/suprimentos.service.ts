// Suprimentos e estoque (RF30): o saldo só muda por movimentações registradas,
// e o alerta de estoque baixo é calculado a cada leitura
import {
  TipoMovimentacao,
  type Prisma,
} from "../../../generated/prisma/client";
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
  CriarSuprimentoInput,
  ListarSuprimentosQuery,
  MovimentacaoInput,
} from "./suprimentos.schema";

const selecao = {
  id: true,
  nome: true,
  unidadeMedida: true,
  quantidade: true,
  estoqueMinimo: true,
  unidade: { select: { id: true, nome: true } },
  atualizadoEm: true,
} satisfies Prisma.SuprimentoSelect;

type SuprimentoSelecionado = Prisma.SuprimentoGetPayload<{
  select: typeof selecao;
}>;

const comAlerta = (s: SuprimentoSelecionado) => ({
  ...s,
  estoqueBaixo: s.quantidade <= s.estoqueMinimo,
});

const buscarSuprimento = async (id: string) =>
  comAlerta(
    await prisma.suprimento.findUniqueOrThrow({
      where: { id },
      select: selecao,
    }),
  );

export async function listarSuprimentos({
  unidadeId,
  estoqueBaixo,
  ...paginacao
}: ListarSuprimentosQuery) {
  const where: Prisma.SuprimentoWhereInput = {
    unidadeId,
    // Compara duas colunas da mesma linha (saldo <= mínimo) direto no banco
    quantidade: estoqueBaixo
      ? { lte: prisma.suprimento.fields.estoqueMinimo }
      : undefined,
  };

  const [suprimentos, total] = await Promise.all([
    prisma.suprimento.findMany({
      where,
      select: selecao,
      // id desempata itens de mesmo nome, para a paginação não repetir nem pular
      orderBy: [{ unidade: { nome: "asc" } }, { nome: "asc" }, { id: "asc" }],
      ...toSkipTake(paginacao),
    }),
    prisma.suprimento.count({ where }),
  ]);

  return {
    data: suprimentos.map(comAlerta),
    meta: buildPaginationMeta(paginacao, total),
  };
}

export async function criarSuprimento(input: CriarSuprimentoInput, ator: Ator) {
  const id = await prisma.$transaction(async (tx) => {
    const unidade = await buscarUnidade(input.unidadeId, tx);
    if (!unidade.ativo) throw conflict("A unidade está inativa.");

    const { id } = await tx.suprimento.create({
      data: input,
      select: { id: true },
    });
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.SUPRIMENTO_CRIADO,
        entidade: "suprimento",
        entidadeId: id,
      },
      tx,
    );
    return id;
  });

  return buscarSuprimento(id);
}

// Entrada soma ao saldo. Saída só acontece se houver saldo suficiente: a condição
// vai na própria escrita, então duas saídas simultâneas nunca deixam o saldo negativo.
export async function movimentarEstoque(
  suprimentoId: string,
  { tipo, quantidade, observacao }: MovimentacaoInput,
  ator: Ator,
) {
  const movimentacao = await prisma.$transaction(async (tx) => {
    const saida = tipo === TipoMovimentacao.SAIDA;
    const { count } = await tx.suprimento.updateMany({
      where: {
        id: suprimentoId,
        quantidade: saida ? { gte: quantidade } : undefined,
      },
      data: {
        quantidade: saida
          ? { decrement: quantidade }
          : { increment: quantidade },
      },
    });
    if (count === 0) {
      const existe = await tx.suprimento.findUnique({
        where: { id: suprimentoId },
        select: { id: true },
      });
      if (!existe) throw notFound("Suprimento não encontrado.");
      throw conflict("Estoque insuficiente para esta saída.");
    }

    const movimentacao = await tx.movimentacaoEstoque.create({
      data: {
        suprimentoId,
        responsavelId: ator.usuarioId,
        tipo,
        quantidade,
        observacao,
      },
      select: {
        id: true,
        tipo: true,
        quantidade: true,
        observacao: true,
        criadoEm: true,
      },
    });
    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.ESTOQUE_MOVIMENTADO,
        entidade: "suprimento",
        entidadeId: suprimentoId,
        detalhes: { movimentacaoId: movimentacao.id, tipo, quantidade },
      },
      tx,
    );
    return movimentacao;
  });

  return { movimentacao, suprimento: await buscarSuprimento(suprimentoId) };
}
