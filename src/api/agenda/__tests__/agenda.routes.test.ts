import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import { criarProfissional, criarUsuario } from "../../../test/factories";
import { autenticar, lerJson, requisitar, tokenDe } from "../../../test/http";
import type { ErrorResponse } from "../../../utils/response";

type Horario = { id: string; inicio: string; fim: string; status: string };

// Horários em 2030 (sempre no futuro), no fuso de Brasília
const slot = (dia: string, inicio: string, fim: string) => ({
  inicio: `2030-03-${dia}T${inicio}:00-03:00`,
  fim: `2030-03-${dia}T${fim}:00-03:00`,
});

let profissionalId: string;
let tokenProfissional: string;
let url: string;

const abrir = (body: unknown, token = tokenProfissional) =>
  requisitar("POST", url, { token, body });

beforeEach(async () => {
  await resetDatabase();
  const profissional = await criarProfissional();
  profissionalId = profissional.id;
  tokenProfissional = await tokenDe({
    id: profissional.usuarioId,
    perfil: Perfil.MEDICO,
  });
  url = `/profissionais/${profissionalId}/horarios`;
});

describe("POST /profissionais/:id/horarios", () => {
  it("abre um horário disponível e audita", async () => {
    const res = await abrir(slot("10", "09:00", "09:30"));
    const { data } = await lerJson<{ data: Horario }>(res);

    expect(res.status).toBe(201);
    expect(data).toMatchObject({
      inicio: "2030-03-10T12:00:00.000Z",
      fim: "2030-03-10T12:30:00.000Z",
      status: "DISPONIVEL",
    });
    expect(
      await prisma.logAuditoria.count({ where: { acao: "HORARIO_ABERTO" } }),
    ).toBe(1);
  });

  it("responde 409 para horário sobreposto e aceita horário encostado", async () => {
    await abrir(slot("10", "09:00", "09:30"));

    const sobreposto = await abrir(slot("10", "09:15", "09:45"));
    const contido = await abrir(slot("10", "08:00", "10:00"));
    const encostado = await abrir(slot("10", "09:30", "10:00"));

    expect(sobreposto.status).toBe(409);
    expect(contido.status).toBe(409);
    expect(encostado.status).toBe(201);
  });

  it("não cria horários sobrepostos em requisições simultâneas", async () => {
    const respostas = await Promise.all([
      abrir(slot("10", "14:00", "15:00")),
      abrir(slot("10", "14:30", "15:30")),
    ]);

    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.horarioAgenda.count()).toBe(1);
  });

  it.each([
    ["fim antes do início", slot("10", "10:00", "09:00"), "fim"],
    [
      "duração acima de 12 horas",
      { inicio: "2030-03-10T08:00:00-03:00", fim: "2030-03-11T08:00:00-03:00" },
      "fim",
    ],
    [
      "horário no passado",
      { inicio: "2020-01-01T09:00:00-03:00", fim: "2020-01-01T09:30:00-03:00" },
      "inicio",
    ],
    [
      "data sem fuso",
      { inicio: "2030-03-10T09:00:00", fim: "2030-03-10T09:30:00" },
      "inicio",
    ],
  ])("responde 400 com %s", async (_, body, campo) => {
    const res = await abrir(body);
    const erro = await lerJson<ErrorResponse>(res);

    expect(res.status).toBe(400);
    expect(erro.error.details?.map((d) => d.field)).toContain(campo);
  });

  it("permite ao ADMIN abrir horário na agenda de qualquer profissional", async () => {
    const res = await abrir(
      slot("10", "09:00", "09:30"),
      await autenticar(Perfil.ADMIN),
    );

    expect(res.status).toBe(201);
  });

  it("responde 403 para outro profissional e para paciente", async () => {
    const outro = await criarProfissional();
    const tokenOutro = await tokenDe({
      id: outro.usuarioId,
      perfil: Perfil.MEDICO,
    });

    const deOutro = await abrir(slot("10", "09:00", "09:30"), tokenOutro);
    const dePaciente = await abrir(
      slot("10", "09:00", "09:30"),
      await autenticar(Perfil.PACIENTE),
    );

    expect(deOutro.status).toBe(403);
    expect(dePaciente.status).toBe(403);
  });

  it("responde 404 para profissional inexistente", async () => {
    const res = await requisitar(
      "POST",
      `/profissionais/${crypto.randomUUID()}/horarios`,
      {
        token: await autenticar(Perfil.ADMIN),
        body: slot("10", "09:00", "09:30"),
      },
    );

    expect(res.status).toBe(404);
  });
});

describe("PATCH /profissionais/:id/horarios/:horarioId", () => {
  const criarHorario = async () =>
    (
      await lerJson<{ data: Horario }>(
        await abrir(slot("10", "09:00", "09:30")),
      )
    ).data;

  it("bloqueia e libera o horário, auditando o novo status", async () => {
    const horario = await criarHorario();

    const bloqueado = await requisitar("PATCH", `${url}/${horario.id}`, {
      token: tokenProfissional,
      body: { status: "BLOQUEADO" },
    });
    const liberado = await requisitar("PATCH", `${url}/${horario.id}`, {
      token: tokenProfissional,
      body: { status: "DISPONIVEL" },
    });
    const log = await prisma.logAuditoria.findFirst({
      where: { acao: "HORARIO_ATUALIZADO" },
    });

    expect((await lerJson<{ data: Horario }>(bloqueado)).data.status).toBe(
      "BLOQUEADO",
    );
    expect((await lerJson<{ data: Horario }>(liberado)).data.status).toBe(
      "DISPONIVEL",
    );
    expect(log?.detalhes).toEqual({ status: "BLOQUEADO" });
  });

  it("responde 409 para horário reservado por consulta", async () => {
    const horario = await criarHorario();
    await prisma.horarioAgenda.update({
      where: { id: horario.id },
      data: { status: "RESERVADO" },
    });

    const res = await requisitar("PATCH", `${url}/${horario.id}`, {
      token: tokenProfissional,
      body: { status: "BLOQUEADO" },
    });

    expect(res.status).toBe(409);
  });

  it("não aceita RESERVADO como status manual", async () => {
    const horario = await criarHorario();

    const res = await requisitar("PATCH", `${url}/${horario.id}`, {
      token: tokenProfissional,
      body: { status: "RESERVADO" },
    });

    expect(res.status).toBe(400);
  });

  it("responde 404 para horário de outro profissional", async () => {
    const horario = await criarHorario();
    const outro = await criarProfissional();

    const res = await requisitar(
      "PATCH",
      `/profissionais/${outro.id}/horarios/${horario.id}`,
      { token: await autenticar(Perfil.ADMIN), body: { status: "BLOQUEADO" } },
    );

    expect(res.status).toBe(404);
  });
});

describe("GET /profissionais/:id/horarios", () => {
  it("lista o dia no horário de Brasília, em ordem, para qualquer usuário autenticado", async () => {
    await abrir(slot("10", "23:30", "23:59")); // 02:30 UTC do dia 11
    await abrir(slot("10", "08:00", "08:30"));
    await abrir(slot("11", "08:00", "08:30"));
    const paciente = await autenticar(Perfil.PACIENTE);

    const res = await requisitar("GET", `${url}?data=2030-03-10`, {
      token: paciente,
    });
    const { data } = await lerJson<{ data: Horario[] }>(res);

    expect(res.status).toBe(200);
    expect(data.map((h) => h.inicio)).toEqual([
      "2030-03-10T11:00:00.000Z",
      "2030-03-11T02:30:00.000Z",
    ]);
  });

  it("responde 400 sem a data e 404 para profissional inativo (exceto ADMIN)", async () => {
    const paciente = await autenticar(Perfil.PACIENTE);
    const profissional = await prisma.profissional.findUniqueOrThrow({
      where: { id: profissionalId },
    });
    await prisma.usuario.update({
      where: { id: profissional.usuarioId },
      data: { ativo: false },
    });

    const semData = await requisitar("GET", url, { token: paciente });
    const inativo = await requisitar("GET", `${url}?data=2030-03-10`, {
      token: paciente,
    });
    const admin = await requisitar("GET", `${url}?data=2030-03-10`, {
      token: await tokenDe(await criarUsuario({ perfil: Perfil.ADMIN })),
    });

    expect(semData.status).toBe(400);
    expect(inativo.status).toBe(404);
    expect(admin.status).toBe(200);
  });
});
