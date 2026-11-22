import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import {
  criarConsulta,
  criarHorario,
  criarLeito,
  criarProfissional,
  criarUnidade,
} from "../../../test/factories";
import { autenticar, lerJson, requisitar } from "../../../test/http";

type Ocupacao = {
  total: number;
  livres: number;
  ocupados: number;
  manutencao: number;
  taxaOcupacao: number;
};
type Contagem = {
  total: number;
  porStatus: Record<string, number>;
  porModalidade: Record<string, number>;
};
type Resumo = { receitas: string; despesas: string; saldo: string };
type Relatorio<T> = {
  unidades: (T & { unidade: { id: string; nome: string } })[];
  total: T;
};

let token: string;

async function gerar<T>(path: string) {
  const res = await requisitar("GET", `/relatorios/${path}`, { token });
  expect(res.status).toBe(200);
  return (await lerJson<{ data: Relatorio<T> }>(res)).data;
}

beforeEach(async () => {
  await resetDatabase();
  token = await autenticar(Perfil.ADMIN);
});

it.each(["ocupacao-leitos", "consultas", "financeiro"])(
  "/relatorios/%s é exclusivo do ADMIN",
  async (path) => {
    const url = `/relatorios/${path}?de=2026-12-01&ate=2026-12-31`;
    expect((await requisitar("GET", url)).status).toBe(401);
    const res = await requisitar("GET", url, {
      token: await autenticar(Perfil.MEDICO),
    });
    expect(res.status).toBe(403);
  },
);

describe("ocupação de leitos", () => {
  it("conta por unidade e calcula a taxa sobre os leitos em operação", async () => {
    const a = await criarUnidade({ nome: "Hospital A" });
    const b = await criarUnidade({ nome: "Hospital B" });
    for (const status of [
      "OCUPADO",
      "OCUPADO",
      "LIVRE",
      "MANUTENCAO",
    ] as const) {
      await criarLeito({ unidadeId: a.id, status });
    }
    await criarLeito({ unidadeId: b.id });
    // Unidade inativa não entra no relatório
    await criarLeito({ unidadeId: (await criarUnidade({ ativo: false })).id });

    const relatorio = await gerar<Ocupacao>("ocupacao-leitos");

    expect(relatorio.unidades.map((u) => u.unidade.nome)).toEqual([
      "Hospital A",
      "Hospital B",
    ]);
    // 2 ocupados de 3 em operação (o de manutenção fica fora da conta)
    expect(relatorio.unidades[0]).toMatchObject({
      total: 4,
      livres: 1,
      ocupados: 2,
      manutencao: 1,
      taxaOcupacao: 66.7,
    });
    expect(relatorio.total).toEqual({
      total: 5,
      livres: 2,
      ocupados: 2,
      manutencao: 1,
      taxaOcupacao: 50,
    });
  });

  it("filtra por unidade e devolve taxa 0 sem leitos em operação", async () => {
    const a = await criarUnidade();
    await criarLeito({ unidadeId: a.id, status: "MANUTENCAO" });
    await criarLeito();

    const relatorio = await gerar<Ocupacao>(
      `ocupacao-leitos?unidadeId=${a.id}`,
    );

    expect(relatorio.unidades).toHaveLength(1);
    expect(relatorio.total).toMatchObject({ total: 1, taxaOcupacao: 0 });
  });
});

describe("consultas por período", () => {
  it("totaliza por status e modalidade, pela data no horário de Brasília", async () => {
    const medico = await criarProfissional();
    const horario = (inicio: string) =>
      criarHorario({
        profissionalId: medico.id,
        inicio: new Date(inicio),
        fim: new Date(new Date(inicio).getTime() + 30 * 60 * 1000),
      });
    // 10/03 às 23h em Brasília (já é dia 11 em UTC) entra no dia 10
    const noDia = await horario("2026-03-10T23:00:00-03:00");
    const outroNoDia = await horario("2026-03-10T09:00:00-03:00");
    const diaSeguinte = await horario("2026-03-11T00:30:00-03:00");
    await criarConsulta({ horarioId: noDia.id, modalidade: "TELEMEDICINA" });
    await criarConsulta({ horarioId: outroNoDia.id, status: "CANCELADA" });
    await criarConsulta({ horarioId: diaSeguinte.id });

    const relatorio = await gerar<Contagem>(
      "consultas?de=2026-03-10&ate=2026-03-10",
    );

    expect(relatorio.unidades).toHaveLength(1);
    expect(relatorio.unidades[0]?.unidade.id).toBe(medico.unidadeId);
    expect(relatorio.total).toEqual({
      total: 2,
      porStatus: { AGENDADA: 1, REALIZADA: 0, CANCELADA: 1 },
      porModalidade: { PRESENCIAL: 1, TELEMEDICINA: 1 },
    });
  });

  it("separa por unidade e filtra por unidade", async () => {
    // Horários fixos: com o horário padrão (agora + 24 h), as duas consultas
    // poderiam cair em dias diferentes se o teste rodasse perto da meia-noite
    const consultaEm = async (inicio: string) => {
      const horario = await criarHorario({
        inicio: new Date(inicio),
        fim: new Date(new Date(inicio).getTime() + 30 * 60 * 1000),
      });
      return criarConsulta({ horarioId: horario.id });
    };
    const primeira = await consultaEm("2026-03-10T09:00:00-03:00");
    await consultaEm("2026-03-10T10:00:00-03:00");
    const dia = "2026-03-10";

    const todas = await gerar<Contagem>(`consultas?de=${dia}&ate=${dia}`);
    const filtrada = await gerar<Contagem>(
      `consultas?de=${dia}&ate=${dia}&unidadeId=${primeira.unidadeId}`,
    );

    expect(todas.unidades).toHaveLength(2);
    expect(todas.total.total).toBe(2);
    expect(filtrada.unidades.map((u) => u.unidade.id)).toEqual([
      primeira.unidadeId,
    ]);
    expect(filtrada.total.total).toBe(1);
  });

  it.each([
    ["", "de"],
    ["?de=2026-03-10&ate=2026-03-01", "ate"],
    ["?de=10/03/2026&ate=2026-03-10", "de"],
  ])("exige período válido (%s)", async (query, campo) => {
    const res = await requisitar("GET", `/relatorios/consultas${query}`, {
      token,
    });

    expect(res.status).toBe(400);
    const { error } = await lerJson<{
      error: { details: { field: string }[] };
    }>(res);
    expect(error.details.map((d) => d.field)).toContain(campo);
  });
});

describe("resumo financeiro", () => {
  const lancar = (
    unidadeId: string,
    tipo: "RECEITA" | "DESPESA",
    valor: string,
    competencia = "2026-12-01",
  ) =>
    prisma.lancamentoFinanceiro.create({
      data: {
        unidadeId,
        tipo,
        valor,
        competencia: new Date(competencia),
        categoria: "Geral",
        descricao: "Lançamento de teste",
      },
    });

  it("soma receitas e despesas em decimal e calcula o saldo", async () => {
    const a = await criarUnidade({ nome: "Hospital A" });
    const b = await criarUnidade({ nome: "Hospital B" });
    await lancar(a.id, "RECEITA", "0.10");
    await lancar(a.id, "RECEITA", "0.20");
    await lancar(a.id, "DESPESA", "1000.50");
    await lancar(b.id, "RECEITA", "500.00", "2026-12-31");
    // Fora do período
    await lancar(b.id, "RECEITA", "999.00", "2027-01-01");

    const relatorio = await gerar<Resumo>(
      "financeiro?de=2026-12-01&ate=2026-12-31",
    );

    expect(relatorio.unidades).toEqual([
      {
        unidade: { id: a.id, nome: "Hospital A" },
        receitas: "0.30",
        despesas: "1000.50",
        saldo: "-1000.20",
      },
      {
        unidade: { id: b.id, nome: "Hospital B" },
        receitas: "500.00",
        despesas: "0.00",
        saldo: "500.00",
      },
    ]);
    expect(relatorio.total).toEqual({
      receitas: "500.30",
      despesas: "1000.50",
      saldo: "-500.20",
    });
  });

  it("devolve zeros quando não há lançamentos", async () => {
    const relatorio = await gerar<Resumo>(
      "financeiro?de=2026-12-01&ate=2026-12-31",
    );

    expect(relatorio.unidades).toEqual([]);
    expect(relatorio.total).toEqual({
      receitas: "0.00",
      despesas: "0.00",
      saldo: "0.00",
    });
  });
});
