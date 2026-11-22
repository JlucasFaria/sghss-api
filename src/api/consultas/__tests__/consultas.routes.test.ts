import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import {
  criarConsulta,
  criarHorario,
  criarProfissional,
} from "../../../test/factories";
import {
  autenticar,
  autenticarPaciente,
  lerJson,
  requisitar,
  tokenDoProfissional,
} from "../../../test/http";
import type { PaginationMeta } from "../../../utils/pagination";
import type { ErrorResponse } from "../../../utils/response";

type Consulta = {
  id: string;
  status: string;
  modalidade: string;
  motivo?: string | null;
  motivoCancelamento: string | null;
  inicio: string;
  profissional: { id: string };
};

const HORA = 60 * 60 * 1000;

// Horário do profissional começando daqui a `horas`, com 30 minutos
const horarioEm = (profissionalId: string, horas: number) => {
  const inicio = new Date(Date.now() + horas * HORA);
  return criarHorario({
    profissionalId,
    inicio,
    fim: new Date(inicio.getTime() + HORA / 2),
  });
};

const statusDoHorario = async (id: string) =>
  (await prisma.horarioAgenda.findUniqueOrThrow({ where: { id } })).status;

let paciente: Awaited<ReturnType<typeof autenticarPaciente>>;
let profissional: Awaited<ReturnType<typeof criarProfissional>>;

const agendar = (horarioId: string, token = paciente.token, extra = {}) =>
  requisitar("POST", "/consultas", {
    token,
    body: { horarioId, modalidade: "PRESENCIAL", ...extra },
  });

beforeEach(async () => {
  await resetDatabase();
  paciente = await autenticarPaciente();
  profissional = await criarProfissional();
});

describe("POST /consultas", () => {
  it.each(["PRESENCIAL", "TELEMEDICINA"])(
    "agenda consulta %s, reserva o horário e audita",
    async (modalidade) => {
      const horario = await horarioEm(profissional.id, 48);

      const res = await agendar(horario.id, paciente.token, {
        modalidade,
        motivo: "Dor de cabeça frequente",
      });
      const { data } = await lerJson<{ data: Consulta }>(res);

      expect(res.status).toBe(201);
      expect(data).toMatchObject({
        status: "AGENDADA",
        modalidade,
        motivo: "Dor de cabeça frequente",
        profissional: { id: profissional.id },
      });
      expect(await statusDoHorario(horario.id)).toBe("RESERVADO");
      expect(
        await prisma.logAuditoria.count({
          where: { acao: "CONSULTA_AGENDADA" },
        }),
      ).toBe(1);
    },
  );

  it("responde 409 para horário já reservado ou bloqueado", async () => {
    const reservado = await horarioEm(profissional.id, 48);
    const bloqueado = await criarHorario({
      profissionalId: profissional.id,
      status: "BLOQUEADO",
    });
    await agendar(reservado.id, (await autenticarPaciente()).token);

    expect((await agendar(reservado.id)).status).toBe(409);
    expect((await agendar(bloqueado.id)).status).toBe(409);
  });

  it("só um paciente consegue o horário em agendamentos simultâneos", async () => {
    const horario = await horarioEm(profissional.id, 48);
    const outro = await autenticarPaciente();

    const respostas = await Promise.all([
      agendar(horario.id),
      agendar(horario.id, outro.token),
    ]);

    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.consulta.count()).toBe(1);
  });

  it("impede o paciente de ter duas consultas no mesmo período", async () => {
    const primeiro = await horarioEm(profissional.id, 48);
    const outroProfissional = await criarProfissional();
    const sobreposto = await criarHorario({
      profissionalId: outroProfissional.id,
      inicio: new Date(primeiro.inicio.getTime() + HORA / 4),
      fim: new Date(primeiro.fim.getTime() + HORA / 4),
    });
    await agendar(primeiro.id);

    const res = await agendar(sobreposto.id);

    expect(res.status).toBe(409);
    expect(await statusDoHorario(sobreposto.id)).toBe("DISPONIVEL");
  });

  it("responde 409 para horário no passado", async () => {
    const horario = await horarioEm(profissional.id, -2);

    expect((await agendar(horario.id)).status).toBe(409);
  });

  it("responde 409 quando o profissional ou a unidade está inativo", async () => {
    const horario = await horarioEm(profissional.id, 48);
    await prisma.usuario.update({
      where: { id: profissional.usuarioId },
      data: { ativo: false },
    });
    const outro = await criarProfissional();
    const daUnidadeInativa = await horarioEm(outro.id, 48);
    await prisma.unidade.update({
      where: { id: outro.unidadeId },
      data: { ativo: false },
    });

    expect((await agendar(horario.id)).status).toBe(409);
    expect((await agendar(daUnidadeInativa.id)).status).toBe(409);
  });

  it("responde 404 para horário inexistente e 403 para quem não é paciente", async () => {
    const horario = await horarioEm(profissional.id, 48);

    expect((await agendar(crypto.randomUUID())).status).toBe(404);
    expect(
      (await agendar(horario.id, await tokenDoProfissional(profissional)))
        .status,
    ).toBe(403);
  });
});

describe("POST /consultas/:id/cancelamento", () => {
  const cancelar = (id: string, token: string, motivo?: string) =>
    requisitar("POST", `/consultas/${id}/cancelamento`, {
      token,
      body: motivo ? { motivo } : {},
    });

  it("cancela com 24 horas de antecedência e devolve o horário à agenda", async () => {
    const horario = await horarioEm(profissional.id, 30);
    const consulta = await criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: horario.id,
    });

    const res = await cancelar(consulta.id, paciente.token, "Viagem");
    const { data } = await lerJson<{ data: Consulta }>(res);

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      status: "CANCELADA",
      motivoCancelamento: "Viagem",
    });
    expect(await statusDoHorario(horario.id)).toBe("DISPONIVEL");
  });

  it("bloqueia o paciente a menos de 24 horas, mas libera profissional e ADMIN", async () => {
    const primeira = await criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: (await horarioEm(profissional.id, 10)).id,
    });
    const segunda = await criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: (await horarioEm(profissional.id, 11)).id,
    });

    const peloPaciente = await cancelar(primeira.id, paciente.token);
    const peloProfissional = await cancelar(
      primeira.id,
      await tokenDoProfissional(profissional),
    );
    const peloAdmin = await cancelar(
      segunda.id,
      await autenticar(Perfil.ADMIN),
    );

    expect(peloPaciente.status).toBe(409);
    expect(
      (await lerJson<ErrorResponse>(peloPaciente)).error.message,
    ).toContain("24 horas");
    expect(peloProfissional.status).toBe(200);
    expect(peloAdmin.status).toBe(200);
  });

  it("responde 409 ao cancelar consulta já cancelada", async () => {
    const consulta = await criarConsulta({
      pacienteId: paciente.paciente.id,
      status: "CANCELADA",
    });

    expect((await cancelar(consulta.id, paciente.token)).status).toBe(409);
  });

  it("responde 404 para quem não participa da consulta", async () => {
    const consulta = await criarConsulta({ pacienteId: paciente.paciente.id });
    const estranho = await autenticarPaciente();

    expect((await cancelar(consulta.id, estranho.token)).status).toBe(404);
  });
});

describe("POST /consultas/:id/reagendamento", () => {
  const reagendar = (id: string, horarioId: string, token = paciente.token) =>
    requisitar("POST", `/consultas/${id}/reagendamento`, {
      token,
      body: { horarioId },
    });

  it("move para outro horário do mesmo profissional, trocando as reservas", async () => {
    const atual = await horarioEm(profissional.id, 48);
    const novo = await horarioEm(profissional.id, 72);
    const consulta = await criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: atual.id,
    });

    const res = await reagendar(consulta.id, novo.id);
    const { data } = await lerJson<{ data: Consulta }>(res);

    expect(res.status).toBe(200);
    expect(new Date(data.inicio).getTime()).toBe(novo.inicio.getTime());
    expect(data.status).toBe("AGENDADA");
    expect(await statusDoHorario(atual.id)).toBe("DISPONIVEL");
    expect(await statusDoHorario(novo.id)).toBe("RESERVADO");
  });

  it("responde 409 para horário de outro profissional ou indisponível", async () => {
    const consulta = await criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: (await horarioEm(profissional.id, 48)).id,
    });
    const deOutro = await horarioEm((await criarProfissional()).id, 72);
    const bloqueado = await criarHorario({
      profissionalId: profissional.id,
      status: "BLOQUEADO",
    });

    expect((await reagendar(consulta.id, deOutro.id)).status).toBe(409);
    expect((await reagendar(consulta.id, bloqueado.id)).status).toBe(409);
  });

  it("aplica ao paciente o mesmo prazo de 24 horas", async () => {
    const consulta = await criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: (await horarioEm(profissional.id, 5)).id,
    });
    const novo = await horarioEm(profissional.id, 72);

    expect((await reagendar(consulta.id, novo.id)).status).toBe(409);
  });
});

describe("GET /consultas", () => {
  type Pagina = { data: Consulta[]; meta: PaginationMeta };
  const listar = async (token: string, query = "") =>
    lerJson<Pagina>(await requisitar("GET", `/consultas${query}`, { token }));

  // 23:30 de 09/03 em Brasília = 02:30 de 10/03 em UTC
  const emUtc = (iso: string) =>
    criarHorario({
      profissionalId: profissional.id,
      inicio: new Date(iso),
      fim: new Date(new Date(iso).getTime() + HORA / 2),
    });

  beforeEach(async () => {
    const pacienteId = paciente.paciente.id;
    await criarConsulta({
      pacienteId,
      horarioId: (await emUtc("2030-03-10T02:30:00Z")).id,
      motivo: "Retorno",
    });
    await criarConsulta({
      pacienteId,
      horarioId: (await emUtc("2030-03-10T12:00:00Z")).id,
    });
    await criarConsulta({
      pacienteId,
      horarioId: (await emUtc("2030-03-12T12:00:00Z")).id,
      status: "CANCELADA",
    });
    await criarConsulta(); // de outro paciente e outro profissional
  });

  it("restringe ao escopo de cada perfil", async () => {
    const doPaciente = await listar(paciente.token);
    const doProfissional = await listar(
      await tokenDoProfissional(profissional),
    );
    const doAdmin = await listar(await autenticar(Perfil.ADMIN));

    expect(doPaciente.meta.total).toBe(3);
    expect(doProfissional.meta.total).toBe(3);
    expect(doAdmin.meta.total).toBe(4);
  });

  it("omite o motivo para o ADMIN", async () => {
    const doAdmin = await listar(await autenticar(Perfil.ADMIN));
    const doPaciente = await listar(paciente.token);

    expect(doAdmin.data.every((c) => !("motivo" in c))).toBe(true);
    expect(doPaciente.data.map((c) => c.motivo)).toContain("Retorno");
  });

  it("filtra por período no horário de Brasília e por status", async () => {
    const dia10 = await listar(paciente.token, "?de=2030-03-10&ate=2030-03-10");
    const dia09 = await listar(paciente.token, "?de=2030-03-09&ate=2030-03-09");
    const canceladas = await listar(paciente.token, "?status=CANCELADA");

    expect(dia10.meta.total).toBe(1);
    expect(dia09.meta.total).toBe(1);
    expect(canceladas.meta.total).toBe(1);
  });

  it("ordena por data e responde 400 para período invertido", async () => {
    const { data } = await listar(paciente.token);
    const invertido = await requisitar(
      "GET",
      "/consultas?de=2030-03-11&ate=2030-03-10",
      { token: paciente.token },
    );

    expect(data.map((c) => c.inicio)).toEqual(
      [...data.map((c) => c.inicio)].sort(),
    );
    expect(invertido.status).toBe(400);
  });
});

describe("GET /consultas com filtro inválido", () => {
  it("aponta só o campo inválido, sem o erro de período", async () => {
    const res = await requisitar(
      "GET",
      "/consultas?de=2030-13-01&ate=2030-01-01",
      {
        token: paciente.token,
      },
    );

    expect(res.status).toBe(400);
    expect((await lerJson<ErrorResponse>(res)).error.details).toEqual([
      { field: "de", message: "Data inválida. Use o formato AAAA-MM-DD." },
    ]);
  });
});

describe("GET /consultas/:id", () => {
  it("mostra a consulta aos participantes e 404 para os demais", async () => {
    const consulta = await criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: (await horarioEm(profissional.id, 48)).id,
    });
    const url = `/consultas/${consulta.id}`;

    expect(
      (await requisitar("GET", url, { token: paciente.token })).status,
    ).toBe(200);
    expect(
      (
        await requisitar("GET", url, {
          token: await tokenDoProfissional(profissional),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await requisitar("GET", url, {
          token: (await autenticarPaciente()).token,
        })
      ).status,
    ).toBe(404);
  });
});

describe("inativação com consultas futuras", () => {
  it("bloqueia inativar profissional ou unidade com consultas agendadas", async () => {
    await criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: (await horarioEm(profissional.id, 48)).id,
    });
    const admin = await autenticar(Perfil.ADMIN);

    const deleteProfissional = await requisitar(
      "DELETE",
      `/profissionais/${profissional.id}`,
      { token: admin },
    );
    const deleteUnidade = await requisitar(
      "DELETE",
      `/unidades/${profissional.unidadeId}`,
      { token: admin },
    );

    expect(deleteProfissional.status).toBe(409);
    expect(deleteUnidade.status).toBe(409);
  });

  it("libera a inativação quando só há consultas passadas ou canceladas", async () => {
    await criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: (await horarioEm(profissional.id, -48)).id,
    });
    await criarConsulta({
      pacienteId: paciente.paciente.id,
      horarioId: (await horarioEm(profissional.id, 48)).id,
      status: "CANCELADA",
    });

    const res = await requisitar(
      "DELETE",
      `/profissionais/${profissional.id}`,
      {
        token: await autenticar(Perfil.ADMIN),
      },
    );

    expect(res.status).toBe(204);
  });
});
