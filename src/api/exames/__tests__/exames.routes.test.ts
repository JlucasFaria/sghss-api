import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import {
  criarExame,
  criarProfissional,
  criarUnidade,
} from "../../../test/factories";
import {
  autenticar,
  autenticarPaciente,
  lerJson,
  requisitar,
  tokenDoProfissional,
} from "../../../test/http";
import { decrypt } from "../../../utils/crypto";
import type { PaginationMeta } from "../../../utils/pagination";

type Exame = {
  id: string;
  status: string;
  resultado: string | null;
  responsavel: { id: string } | null;
};

let paciente: Awaited<ReturnType<typeof autenticarPaciente>>;
let laboratorioId: string;

const umaHoraAtras = () => new Date(Date.now() - 60 * 60 * 1000);

beforeEach(async () => {
  await resetDatabase();
  paciente = await autenticarPaciente();
  laboratorioId = (await criarUnidade({ tipo: "LABORATORIO" })).id;
});

describe("POST /exames", () => {
  const agendar = (body: Record<string, unknown>, token = paciente.token) =>
    requisitar("POST", "/exames", {
      token,
      body: {
        unidadeId: laboratorioId,
        tipo: "Hemograma",
        dataHora: "2030-01-10T08:00:00-03:00",
        ...body,
      },
    });

  it("agenda o exame do paciente e audita", async () => {
    const res = await agendar({});
    const { data } = await lerJson<{ data: Exame }>(res);

    expect(res.status).toBe(201);
    expect(data).toMatchObject({ status: "AGENDADO", resultado: null });
    expect(
      await prisma.logAuditoria.count({ where: { acao: "EXAME_AGENDADO" } }),
    ).toBe(1);
  });

  it("responde 400 para data no passado e unidade inativa", async () => {
    const inativa = await criarUnidade({ ativo: false });

    expect(
      (await agendar({ dataHora: "2020-01-10T08:00:00-03:00" })).status,
    ).toBe(400);
    expect((await agendar({ unidadeId: inativa.id })).status).toBe(400);
  });

  it("responde 403 para quem não é paciente", async () => {
    expect((await agendar({}, await autenticar(Perfil.MEDICO))).status).toBe(
      403,
    );
  });
});

describe("PATCH /exames/:id/resultado", () => {
  const registrar = (id: string, token: string, resultado = "Sem alterações") =>
    requisitar("PATCH", `/exames/${id}/resultado`, {
      token,
      body: { resultado },
    });

  it("registra o resultado cifrado e define o profissional responsável", async () => {
    const profissional = await criarProfissional({ unidadeId: laboratorioId });
    const exame = await criarExame({
      pacienteId: paciente.paciente.id,
      unidadeId: laboratorioId,
      dataHora: umaHoraAtras(),
    });

    const res = await registrar(
      exame.id,
      await tokenDoProfissional(profissional),
    );
    const { data } = await lerJson<{ data: Exame }>(res);
    const salvo = await prisma.exame.findUniqueOrThrow({
      where: { id: exame.id },
    });

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      status: "REALIZADO",
      resultado: "Sem alterações",
      responsavel: { id: profissional.id },
    });
    expect(salvo.resultadoCifrado).not.toContain("Sem alterações");
    expect(decrypt(salvo.resultadoCifrado!)).toBe("Sem alterações");
  });

  it("responde 409 antes da data do exame e para exame já realizado", async () => {
    const profissional = await criarProfissional({ unidadeId: laboratorioId });
    const token = await tokenDoProfissional(profissional);
    const futuro = await criarExame({ unidadeId: laboratorioId });
    const realizado = await criarExame({
      unidadeId: laboratorioId,
      dataHora: umaHoraAtras(),
    });
    await registrar(realizado.id, token);

    expect((await registrar(futuro.id, token)).status).toBe(409);
    expect(
      (await registrar(realizado.id, token, "Outro resultado")).status,
    ).toBe(409);
  });

  it("responde 404 para profissional de outra unidade", async () => {
    const deFora = await criarProfissional();
    const exame = await criarExame({
      unidadeId: laboratorioId,
      dataHora: umaHoraAtras(),
    });

    const res = await registrar(exame.id, await tokenDoProfissional(deFora));

    expect(res.status).toBe(404);
  });

  it("rejeita HTML no resultado", async () => {
    const profissional = await criarProfissional({ unidadeId: laboratorioId });
    const exame = await criarExame({
      unidadeId: laboratorioId,
      dataHora: umaHoraAtras(),
    });

    const res = await registrar(
      exame.id,
      await tokenDoProfissional(profissional),
      "<script>alert(1)</script>",
    );

    expect(res.status).toBe(400);
  });
});

describe("GET /exames", () => {
  type Pagina = { data: Exame[]; meta: PaginationMeta };

  it("mostra ao paciente os seus e ao profissional os da sua unidade", async () => {
    await criarExame({
      pacienteId: paciente.paciente.id,
      unidadeId: laboratorioId,
    });
    await criarExame({ unidadeId: laboratorioId });
    await criarExame();
    const doLaboratorio = await criarProfissional({ unidadeId: laboratorioId });

    const doPaciente = await lerJson<Pagina>(
      await requisitar("GET", "/exames", { token: paciente.token }),
    );
    const daUnidade = await lerJson<Pagina>(
      await requisitar("GET", "/exames", {
        token: await tokenDoProfissional(doLaboratorio),
      }),
    );

    expect(doPaciente.meta.total).toBe(1);
    expect(daUnidade.meta.total).toBe(2);
  });

  it("responde 403 ao ADMIN (resultado é dado clínico)", async () => {
    const res = await requisitar("GET", "/exames", {
      token: await autenticar(Perfil.ADMIN),
    });

    expect(res.status).toBe(403);
  });

  it("responde 404 ao consultar exame de outro paciente", async () => {
    const exame = await criarExame();

    const res = await requisitar("GET", `/exames/${exame.id}`, {
      token: paciente.token,
    });

    expect(res.status).toBe(404);
  });
});
