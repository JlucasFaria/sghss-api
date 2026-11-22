import { beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import {
  criarConsulta,
  criarHorario,
  criarProfissional,
  criarUsuario,
} from "../../../test/factories";
import {
  autenticarPaciente,
  lerJson,
  requisitar,
  tokenDe,
} from "../../../test/http";
import { formatarDataHora } from "../../../utils/datas";
import type { PaginationMeta } from "../../../utils/pagination";
import { gerarLembretes } from "../notificacoes.service";

type Notificacao = {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  consultaId: string | null;
  lidaEm: string | null;
};
type Pagina = { data: Notificacao[]; meta: PaginationMeta };

const HORA = 60 * 60 * 1000;

let paciente: Awaited<ReturnType<typeof autenticarPaciente>>;
let medico: Awaited<ReturnType<typeof criarProfissional>>;

const horarioEm = (horas: number) =>
  criarHorario({
    profissionalId: medico.id,
    inicio: new Date(Date.now() + horas * HORA),
    fim: new Date(Date.now() + horas * HORA + HORA / 2),
  });

const notificacoesDoPaciente = () =>
  prisma.notificacao.findMany({
    where: { usuarioId: paciente.paciente.usuarioId },
    orderBy: { criadoEm: "asc" },
  });

beforeEach(async () => {
  await resetDatabase();
  paciente = await autenticarPaciente();
  medico = await criarProfissional({ nome: "Dra. Ana Souza" });
});

describe("geração nos eventos da consulta", () => {
  it("notifica agendamento, reagendamento e cancelamento, ligados à consulta", async () => {
    const primeiro = await horarioEm(48);
    const segundo = await horarioEm(72);

    const res = await requisitar("POST", "/consultas", {
      token: paciente.token,
      body: { horarioId: primeiro.id, modalidade: "TELEMEDICINA" },
    });
    const { data: consulta } = await lerJson<{ data: { id: string } }>(res);
    await requisitar("POST", `/consultas/${consulta.id}/reagendamento`, {
      token: paciente.token,
      body: { horarioId: segundo.id },
    });
    await requisitar("POST", `/consultas/${consulta.id}/cancelamento`, {
      token: paciente.token,
    });

    const notificacoes = await notificacoesDoPaciente();

    expect(notificacoes.map((n) => n.tipo)).toEqual([
      "CONSULTA_AGENDADA",
      "CONSULTA_REAGENDADA",
      "CONSULTA_CANCELADA",
    ]);
    expect(notificacoes.every((n) => n.consultaId === consulta.id)).toBe(true);
    expect(notificacoes[0]?.mensagem).toBe(
      `Sua consulta por telemedicina com Dra. Ana Souza está agendada para ${formatarDataHora(primeiro.inicio)}.`,
    );
    expect(notificacoes[1]?.mensagem).toContain(
      formatarDataHora(segundo.inicio),
    );
  });

  it("não inclui o motivo (dado clínico) na mensagem", async () => {
    const horario = await horarioEm(48);

    await requisitar("POST", "/consultas", {
      token: paciente.token,
      body: {
        horarioId: horario.id,
        modalidade: "PRESENCIAL",
        motivo: "Dor torácica intensa",
      },
    });

    const [notificacao] = await notificacoesDoPaciente();
    expect(notificacao?.mensagem).not.toContain("Dor torácica");
  });

  it("não grava notificação quando o agendamento falha", async () => {
    const horario = await horarioEm(48);
    await prisma.horarioAgenda.update({
      where: { id: horario.id },
      data: { status: "BLOQUEADO" },
    });

    const res = await requisitar("POST", "/consultas", {
      token: paciente.token,
      body: { horarioId: horario.id, modalidade: "PRESENCIAL" },
    });

    expect(res.status).toBe(409);
    expect(await prisma.notificacao.count()).toBe(0);
  });
});

describe("gerarLembretes", () => {
  const consultaEm = async (horas: number, status?: "CANCELADA") =>
    criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: (await horarioEm(horas)).id,
      status,
    });

  it("lembra só as consultas agendadas das próximas 24 horas", async () => {
    const proxima = await consultaEm(10);
    await consultaEm(30); // fora da janela
    await consultaEm(-2); // já passou
    await consultaEm(5, "CANCELADA");

    const total = await gerarLembretes();
    const lembretes = await prisma.notificacao.findMany({
      where: { tipo: "LEMBRETE_CONSULTA" },
    });

    expect(total).toBe(1);
    expect(lembretes.map((l) => l.consultaId)).toEqual([proxima.id]);
  });

  it("não repete o lembrete da mesma consulta", async () => {
    await consultaEm(10);

    await gerarLembretes();
    const segundaRodada = await gerarLembretes();

    expect(segundaRodada).toBe(0);
    expect(
      await prisma.notificacao.count({ where: { tipo: "LEMBRETE_CONSULTA" } }),
    ).toBe(1);
  });

  it("execuções simultâneas não duplicam lembretes", async () => {
    await consultaEm(10);
    await consultaEm(20);

    const totais = await Promise.all([gerarLembretes(), gerarLembretes()]);

    expect(totais.reduce((soma, n) => soma + n, 0)).toBe(2);
    expect(
      await prisma.notificacao.count({ where: { tipo: "LEMBRETE_CONSULTA" } }),
    ).toBe(2);
  });
});

describe("GET /notificacoes e PATCH /notificacoes/:id/leitura", () => {
  const criarNotificacao = (usuarioId: string, titulo: string) =>
    prisma.notificacao.create({
      data: { usuarioId, tipo: "LEMBRETE_CONSULTA", titulo, mensagem: "Teste" },
    });

  it("lista só as notificações do usuário, das mais recentes para as mais antigas", async () => {
    await criarNotificacao(paciente.paciente.usuarioId, "Primeira");
    await criarNotificacao(paciente.paciente.usuarioId, "Segunda");
    await criarNotificacao((await criarUsuario()).id, "De outra pessoa");

    const res = await requisitar("GET", "/notificacoes", {
      token: paciente.token,
    });
    const { data, meta } = await lerJson<Pagina>(res);

    expect(res.status).toBe(200);
    expect(meta.total).toBe(2);
    expect(data.map((n) => n.titulo)).toEqual(["Segunda", "Primeira"]);
  });

  it("marca como lida, mantém a data em nova chamada e filtra as não lidas", async () => {
    const lida = await criarNotificacao(paciente.paciente.usuarioId, "A");
    await criarNotificacao(paciente.paciente.usuarioId, "B");
    const url = `/notificacoes/${lida.id}/leitura`;

    const primeira = await lerJson<{ data: Notificacao }>(
      await requisitar("PATCH", url, { token: paciente.token }),
    );
    const segunda = await lerJson<{ data: Notificacao }>(
      await requisitar("PATCH", url, { token: paciente.token }),
    );
    const naoLidas = await lerJson<Pagina>(
      await requisitar("GET", "/notificacoes?naoLidas=true", {
        token: paciente.token,
      }),
    );
    const todas = await lerJson<Pagina>(
      await requisitar("GET", "/notificacoes?naoLidas=false", {
        token: paciente.token,
      }),
    );

    expect(primeira.data.lidaEm).not.toBeNull();
    expect(segunda.data.lidaEm).toBe(primeira.data.lidaEm);
    expect(naoLidas.data.map((n) => n.titulo)).toEqual(["B"]);
    expect(todas.meta.total).toBe(2);
  });

  it("responde 404 para notificação de outro usuário e 401 sem token", async () => {
    const outro = await criarUsuario();
    const alheia = await criarNotificacao(outro.id, "Alheia");

    const res = await requisitar(
      "PATCH",
      `/notificacoes/${alheia.id}/leitura`,
      {
        token: paciente.token,
      },
    );
    const intacta = await prisma.notificacao.findUniqueOrThrow({
      where: { id: alheia.id },
    });

    expect(res.status).toBe(404);
    expect(intacta.lidaEm).toBeNull();
    expect((await requisitar("GET", "/notificacoes")).status).toBe(401);
    expect(
      (
        await lerJson<Pagina>(
          await requisitar("GET", "/notificacoes", {
            token: await tokenDe(outro),
          }),
        )
      ).meta.total,
    ).toBe(1);
  });
});
