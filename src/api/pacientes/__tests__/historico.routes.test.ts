import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import {
  criarConsulta,
  criarExame,
  criarHorario,
  criarLeito,
  criarPaciente,
  criarProfissional,
  criarUsuario,
} from "../../../test/factories";
import { autenticar, lerJson, requisitar, tokenDe } from "../../../test/http";
import { encrypt } from "../../../utils/crypto";

type Historico = {
  paciente: { id: string; nome: string };
  consultas: { id: string; status: string; profissional: { id: string } }[];
  exames: { tipo: string; resultado: string | null }[];
  prescricoes: { validaAte: string; itens: { medicamento: string }[] }[];
  internacoes: { leito: { codigo: string } }[];
};

const tokenDoProfissional = (profissional: { usuarioId: string }) =>
  tokenDe({ id: profissional.usuarioId, perfil: Perfil.MEDICO });

let tokenPaciente: string;
let pacienteId: string;

beforeEach(async () => {
  await resetDatabase();
  const usuario = await criarUsuario();
  pacienteId = (await criarPaciente({ usuarioId: usuario.id })).id;
  tokenPaciente = await tokenDe(usuario);
});

describe("GET /pacientes/me/historico", () => {
  it("reúne consultas, exames, prescrições e internações do paciente", async () => {
    const consulta = await criarConsulta({ pacienteId, motivo: "Retorno" });
    await prisma.prescricao.create({
      data: {
        consultaId: consulta.id,
        codigoVerificacaoHash: "f".repeat(64),
        validaAte: new Date("2030-02-01"),
        itens: {
          create: [
            {
              medicamento: "Dipirona",
              dosagem: "500 mg",
              posologia: "8/8 h",
              quantidade: 10,
            },
          ],
        },
      },
    });
    await criarExame({
      pacienteId,
      status: "REALIZADO",
      resultadoCifrado: encrypt("Sem alterações"),
    });
    const leito = await criarLeito({ codigo: "UTI-01" });
    await prisma.internacao.create({
      data: { pacienteId, leitoId: leito.id, motivo: "Observação" },
    });

    const res = await requisitar("GET", "/pacientes/me/historico", {
      token: tokenPaciente,
    });
    const { data } = await lerJson<{ data: Historico }>(res);

    expect(res.status).toBe(200);
    expect(data.paciente.id).toBe(pacienteId);
    expect(data.consultas).toHaveLength(1);
    expect(data.exames[0]?.resultado).toBe("Sem alterações");
    expect(data.prescricoes[0]).toMatchObject({
      validaAte: "2030-02-01",
      itens: [{ medicamento: "Dipirona" }],
    });
    expect(data.internacoes[0]?.leito.codigo).toBe("UTI-01");
    expect(JSON.stringify(data)).not.toContain("f".repeat(64));
  });

  it("não inclui dados de outros pacientes", async () => {
    await criarConsulta();
    await criarExame();

    const res = await requisitar("GET", "/pacientes/me/historico", {
      token: tokenPaciente,
    });
    const { data } = await lerJson<{ data: Historico }>(res);

    expect(data.consultas).toHaveLength(0);
    expect(data.exames).toHaveLength(0);
  });

  it("ordena as consultas da mais recente para a mais antiga", async () => {
    const profissional = await criarProfissional();
    const antiga = await criarHorario({
      profissionalId: profissional.id,
      inicio: new Date("2030-01-01T12:00:00Z"),
      fim: new Date("2030-01-01T12:30:00Z"),
    });
    const recente = await criarHorario({
      profissionalId: profissional.id,
      inicio: new Date("2030-06-01T12:00:00Z"),
      fim: new Date("2030-06-01T12:30:00Z"),
    });
    const primeira = await criarConsulta({ pacienteId, horarioId: antiga.id });
    const segunda = await criarConsulta({ pacienteId, horarioId: recente.id });

    const res = await requisitar("GET", "/pacientes/me/historico", {
      token: tokenPaciente,
    });
    const { data } = await lerJson<{ data: Historico }>(res);

    expect(data.consultas.map((c) => c.id)).toEqual([segunda.id, primeira.id]);
  });
});

describe("GET /pacientes/:id/historico", () => {
  const consultar = (token: string, id = pacienteId) =>
    requisitar("GET", `/pacientes/${id}/historico`, { token });

  it.each(["AGENDADA", "REALIZADA"] as const)(
    "libera ao profissional com consulta %s e audita o acesso",
    async (status) => {
      const profissional = await criarProfissional();
      const horario = await criarHorario({ profissionalId: profissional.id });
      await criarConsulta({ pacienteId, horarioId: horario.id, status });

      const res = await consultar(await tokenDoProfissional(profissional));
      const log = await prisma.logAuditoria.findFirst({
        where: { acao: "HISTORICO_CONSULTADO" },
      });

      expect(res.status).toBe(200);
      expect(log).toMatchObject({
        usuarioId: profissional.usuarioId,
        entidadeId: pacienteId,
      });
    },
  );

  it("libera ao profissional responsável por um exame do paciente", async () => {
    const profissional = await criarProfissional();
    await criarExame({ pacienteId, responsavelId: profissional.id });

    const res = await consultar(await tokenDoProfissional(profissional));

    expect(res.status).toBe(200);
  });

  it("responde 403 ao profissional sem vínculo ou só com consulta cancelada", async () => {
    const semVinculo = await criarProfissional();
    const comCancelada = await criarProfissional();
    const horario = await criarHorario({ profissionalId: comCancelada.id });
    await criarConsulta({
      pacienteId,
      horarioId: horario.id,
      status: "CANCELADA",
    });

    const resSemVinculo = await consultar(
      await tokenDoProfissional(semVinculo),
    );
    const resCancelada = await consultar(
      await tokenDoProfissional(comCancelada),
    );

    expect(resSemVinculo.status).toBe(403);
    expect(resCancelada.status).toBe(403);
    expect(await prisma.logAuditoria.count()).toBe(0);
  });

  it.each([Perfil.ADMIN, Perfil.PACIENTE])(
    "responde 403 ao perfil %s",
    async (perfil) => {
      expect((await consultar(await autenticar(perfil))).status).toBe(403);
    },
  );

  it("responde 404 para paciente inexistente", async () => {
    const profissional = await criarProfissional();

    const res = await consultar(
      await tokenDoProfissional(profissional),
      crypto.randomUUID(),
    );

    expect(res.status).toBe(404);
  });
});
