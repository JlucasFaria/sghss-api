// Relatórios gerenciais (RF29): agregações feitas no banco (groupBy), sem carregar
// registros individuais nem dados pessoais
import {
  Prisma,
  TipoLancamento,
  type StatusLeito,
} from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { intervaloDoDia } from "../../utils/datas";
import { filtroCompetencia } from "../financeiro/financeiro.service";
import type {
  PeriodoQuery,
  OcupacaoQuery,
  RelatorioConsultas,
  RelatorioFinanceiro,
  RelatorioOcupacao,
} from "./relatorios.schema";

type Unidade = { id: string; nome: string };
type Ocupacao = Omit<RelatorioOcupacao["total"], "taxaOcupacao">;
type ContagemConsultas = RelatorioConsultas["total"];

// Unidades citadas nos agrupamentos, em ordem alfabética
const buscarUnidades = (ids: string[]): Promise<Unidade[]> =>
  prisma.unidade.findMany({
    where: { id: { in: ids } },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });

// ---------- Ocupação de leitos ----------

const ocupacaoVazia = (): Ocupacao => ({
  total: 0,
  livres: 0,
  ocupados: 0,
  manutencao: 0,
});

const campoDoStatus = {
  LIVRE: "livres",
  OCUPADO: "ocupados",
  MANUTENCAO: "manutencao",
} as const satisfies Record<StatusLeito, keyof Ocupacao>;

// Um decimal; 0 quando não há leitos em operação
const comTaxa = (o: Ocupacao) => {
  const emOperacao = o.total - o.manutencao;
  const taxa = emOperacao > 0 ? (o.ocupados / emOperacao) * 100 : 0;
  return { ...o, taxaOcupacao: Math.round(taxa * 10) / 10 };
};

// Leitos das unidades ativas, agrupados por unidade e status
export async function relatorioOcupacao({
  unidadeId,
}: OcupacaoQuery): Promise<RelatorioOcupacao> {
  const grupos = await prisma.leito.groupBy({
    by: ["unidadeId", "status"],
    where: { unidadeId, unidade: { ativo: true } },
    _count: { _all: true },
  });

  const porUnidade = new Map<string, Ocupacao>();
  const total = ocupacaoVazia();
  for (const { unidadeId, status, _count } of grupos) {
    const ocupacao = porUnidade.get(unidadeId) ?? ocupacaoVazia();
    porUnidade.set(unidadeId, ocupacao);
    for (const alvo of [ocupacao, total]) {
      alvo[campoDoStatus[status]] += _count._all;
      alvo.total += _count._all;
    }
  }

  const unidades = await buscarUnidades([...porUnidade.keys()]);
  return {
    geradoEm: new Date(),
    unidades: unidades.map((unidade) => ({
      unidade,
      ...comTaxa(porUnidade.get(unidade.id) ?? ocupacaoVazia()),
    })),
    total: comTaxa(total),
  };
}

// ---------- Consultas por período e unidade ----------

const contagemVazia = (): ContagemConsultas => ({
  total: 0,
  porStatus: { AGENDADA: 0, REALIZADA: 0, CANCELADA: 0 },
  porModalidade: { PRESENCIAL: 0, TELEMEDICINA: 0 },
});

// Consultas cuja data (início do horário) cai no período, no horário de Brasília
export async function relatorioConsultas({
  de,
  ate,
  unidadeId,
}: PeriodoQuery): Promise<RelatorioConsultas> {
  const grupos = await prisma.consulta.groupBy({
    by: ["unidadeId", "status", "modalidade"],
    where: {
      unidadeId,
      horario: {
        inicio: {
          gte: intervaloDoDia(de).inicio,
          lt: intervaloDoDia(ate).fim,
        },
      },
    },
    _count: { _all: true },
  });

  const porUnidade = new Map<string, ContagemConsultas>();
  const total = contagemVazia();
  for (const { unidadeId, status, modalidade, _count } of grupos) {
    const contagem = porUnidade.get(unidadeId) ?? contagemVazia();
    porUnidade.set(unidadeId, contagem);
    for (const alvo of [contagem, total]) {
      alvo.total += _count._all;
      alvo.porStatus[status] += _count._all;
      alvo.porModalidade[modalidade] += _count._all;
    }
  }

  const unidades = await buscarUnidades([...porUnidade.keys()]);
  return {
    periodo: { de, ate },
    unidades: unidades.map((unidade) => ({
      unidade,
      ...(porUnidade.get(unidade.id) ?? contagemVazia()),
    })),
    total,
  };
}

// ---------- Resumo financeiro (RF31) ----------

type Totais = { receitas: Prisma.Decimal; despesas: Prisma.Decimal };

const totaisVazios = (): Totais => ({
  receitas: new Prisma.Decimal(0),
  despesas: new Prisma.Decimal(0),
});

// Soma em Decimal (sem erro de ponto flutuante) e formata com 2 casas
const paraResumo = ({ receitas, despesas }: Totais) => ({
  receitas: receitas.toFixed(2),
  despesas: despesas.toFixed(2),
  saldo: receitas.minus(despesas).toFixed(2),
});

// Lançamentos cuja competência cai no período, somados por unidade e tipo
export async function relatorioFinanceiro({
  de,
  ate,
  unidadeId,
}: PeriodoQuery): Promise<RelatorioFinanceiro> {
  const grupos = await prisma.lancamentoFinanceiro.groupBy({
    by: ["unidadeId", "tipo"],
    where: { unidadeId, competencia: filtroCompetencia(de, ate) },
    _sum: { valor: true },
  });

  const porUnidade = new Map<string, Totais>();
  const total = totaisVazios();
  for (const { unidadeId, tipo, _sum } of grupos) {
    const totais = porUnidade.get(unidadeId) ?? totaisVazios();
    porUnidade.set(unidadeId, totais);
    const campo = tipo === TipoLancamento.RECEITA ? "receitas" : "despesas";
    const valor = _sum.valor ?? new Prisma.Decimal(0);
    totais[campo] = totais[campo].plus(valor);
    total[campo] = total[campo].plus(valor);
  }

  const unidades = await buscarUnidades([...porUnidade.keys()]);
  return {
    periodo: { de, ate },
    unidades: unidades.map((unidade) => ({
      unidade,
      ...paraResumo(porUnidade.get(unidade.id) ?? totaisVazios()),
    })),
    total: paraResumo(total),
  };
}
