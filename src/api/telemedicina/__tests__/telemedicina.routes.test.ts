import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  Perfil,
  type ModalidadeConsulta,
} from "../../../../generated/prisma/client";
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
import type { ErrorResponse } from "../../../utils/response";
import {
  definirProvedorVideo,
  ProvedorVideoSimulado,
  type ProvedorVideo,
} from "../provedor-video";

type Teleconsulta = {
  id: string;
  urlSala: string;
  iniciadaEm: string | null;
  encerradaEm: string | null;
};
type Acesso = { urlSala: string; token: string; expiraEm: string };

const MINUTO = 60 * 1000;

// Provedor que registra as chamadas, para verificar a integração com o serviço externo
class ProvedorEspiao extends ProvedorVideoSimulado {
  readonly chamadas: { operacao: string; dados: unknown }[] = [];

  override async criarSala(...args: Parameters<ProvedorVideo["criarSala"]>) {
    this.chamadas.push({ operacao: "criarSala", dados: args[0] });
    return super.criarSala(...args);
  }

  override async gerarToken(...args: Parameters<ProvedorVideo["gerarToken"]>) {
    this.chamadas.push({ operacao: "gerarToken", dados: args[0] });
    return super.gerarToken(...args);
  }

  override async encerrarSala(salaId: string) {
    this.chamadas.push({ operacao: "encerrarSala", dados: salaId });
    return super.encerrarSala(salaId);
  }
}

let paciente: Awaited<ReturnType<typeof autenticarPaciente>>;
let medico: Awaited<ReturnType<typeof criarProfissional>>;
let tokenMedico: string;
let provedor: ProvedorEspiao;

// Teleconsulta de 30 minutos começando daqui a `minutos`
const teleconsultaEm = async (
  minutos: number,
  modalidade: ModalidadeConsulta = "TELEMEDICINA",
) =>
  criarConsulta({
    pacienteId: paciente.paciente.id,
    modalidade,
    horarioId: (
      await criarHorario({
        profissionalId: medico.id,
        inicio: new Date(Date.now() + minutos * MINUTO),
        fim: new Date(Date.now() + (minutos + 30) * MINUTO),
      })
    ).id,
  });

const url = (consultaId: string, acao = "") =>
  `/consultas/${consultaId}/teleconsulta${acao}`;
const criarSala = (consultaId: string, token = tokenMedico) =>
  requisitar("POST", url(consultaId), { token });
const entrar = (consultaId: string, token: string) =>
  requisitar("POST", url(consultaId, "/entrada"), { token });
const encerrar = (consultaId: string, token = tokenMedico) =>
  requisitar("POST", url(consultaId, "/encerramento"), { token });

beforeEach(async () => {
  await resetDatabase();
  provedor = new ProvedorEspiao();
  definirProvedorVideo(provedor);
  paciente = await autenticarPaciente();
  medico = await criarProfissional();
  tokenMedico = await tokenDoProfissional(medico);
});

afterEach(() => definirProvedorVideo(new ProvedorVideoSimulado()));

describe("POST /consultas/:id/teleconsulta", () => {
  it("cria a sala no provedor com o horário da consulta e audita", async () => {
    const consulta = await teleconsultaEm(60);

    const res = await criarSala(consulta.id);
    const { data } = await lerJson<{ data: Teleconsulta }>(res);

    expect(res.status).toBe(201);
    expect(data.urlSala).toStartWith("https://video.vidaplus.example/");
    expect(data).not.toHaveProperty("salaId");
    expect(provedor.chamadas).toEqual([
      {
        operacao: "criarSala",
        dados: expect.objectContaining({ consultaId: consulta.id }),
      },
    ]);
    expect(
      await prisma.logAuditoria.count({
        where: { acao: "TELECONSULTA_CRIADA" },
      }),
    ).toBe(1);
  });

  it("devolve a mesma sala em uma segunda chamada, sem chamar o provedor de novo", async () => {
    const consulta = await teleconsultaEm(60);
    const primeira = await lerJson<{ data: Teleconsulta }>(
      await criarSala(consulta.id),
    );

    const res = await criarSala(consulta.id);

    expect(res.status).toBe(200);
    expect((await lerJson<{ data: Teleconsulta }>(res)).data.id).toBe(
      primeira.data.id,
    );
    expect(provedor.chamadas).toHaveLength(1);
  });

  it("responde 502 e não grava nada quando o provedor está fora do ar", async () => {
    definirProvedorVideo(new ProvedorVideoSimulado({ falhar: true }));
    const consulta = await teleconsultaEm(60);

    const res = await criarSala(consulta.id);
    const body = await lerJson<ErrorResponse>(res);

    expect(res.status).toBe(502);
    expect(body.error.code).toBe("SERVICO_EXTERNO_INDISPONIVEL");
    expect(await prisma.teleconsulta.count()).toBe(0);
  });

  it("responde 409 para consulta presencial e 404 para outro profissional", async () => {
    const presencial = await teleconsultaEm(60, "PRESENCIAL");
    const teleconsulta = await teleconsultaEm(120);
    const outro = await tokenDoProfissional(await criarProfissional());

    expect((await criarSala(presencial.id)).status).toBe(409);
    expect((await criarSala(teleconsulta.id, outro)).status).toBe(404);
    expect((await criarSala(teleconsulta.id, paciente.token)).status).toBe(403);
  });
});

describe("POST /consultas/:id/teleconsulta/entrada", () => {
  it("entrega URL e token temporário ao paciente e marca o início da sala", async () => {
    const consulta = await teleconsultaEm(5);
    await criarSala(consulta.id);

    const res = await entrar(consulta.id, paciente.token);
    const { data } = await lerJson<{ data: Acesso }>(res);
    const sala = await prisma.teleconsulta.findUniqueOrThrow({
      where: { consultaId: consulta.id },
    });
    const pedidoToken = provedor.chamadas.find(
      (c) => c.operacao === "gerarToken",
    );

    expect(res.status).toBe(200);
    expect(data.token).toBeTruthy();
    expect(sala.iniciadaEm).not.toBeNull();
    // O token vale até 30 minutos depois do fim previsto (5 + 30 + 30 minutos)
    const validadeMinutos =
      (new Date(data.expiraEm).getTime() - Date.now()) / MINUTO;
    expect(validadeMinutos).toBeGreaterThan(64);
    expect(validadeMinutos).toBeLessThanOrEqual(65);
    expect(pedidoToken?.dados).toMatchObject({
      salaId: sala.salaId,
      participanteId: expect.any(String),
    });
    // O token não é gravado em lugar nenhum
    expect(JSON.stringify(sala)).not.toContain(data.token);
  });

  it("libera o profissional e bloqueia quem não participa da consulta", async () => {
    const consulta = await teleconsultaEm(5);
    await criarSala(consulta.id);

    expect((await entrar(consulta.id, tokenMedico)).status).toBe(200);
    expect(
      (await entrar(consulta.id, (await autenticarPaciente()).token)).status,
    ).toBe(404);
    expect(
      (await entrar(consulta.id, await autenticar(Perfil.ADMIN))).status,
    ).toBe(403);
  });

  it("respeita a janela: abre 15 minutos antes e fecha 30 minutos após o fim", async () => {
    const cedo = await teleconsultaEm(20);
    const dentroDaTolerancia = await teleconsultaEm(-50);
    const encerradaHaTempo = await teleconsultaEm(-70);
    for (const consulta of [cedo, dentroDaTolerancia, encerradaHaTempo]) {
      await prisma.teleconsulta.create({
        data: {
          consultaId: consulta.id,
          provedor: "simulado",
          salaId: crypto.randomUUID(),
          urlSala: "https://video.vidaplus.example/sala",
        },
      });
    }

    expect((await entrar(cedo.id, paciente.token)).status).toBe(409);
    expect((await entrar(dentroDaTolerancia.id, paciente.token)).status).toBe(
      200,
    );
    expect((await entrar(encerradaHaTempo.id, paciente.token)).status).toBe(
      409,
    );
  });

  it("responde 409 se a sala ainda não foi criada", async () => {
    const consulta = await teleconsultaEm(5);

    const res = await entrar(consulta.id, paciente.token);

    expect(res.status).toBe(409);
  });

  it("responde 502 quando o provedor não emite o token", async () => {
    const consulta = await teleconsultaEm(5);
    await criarSala(consulta.id);
    definirProvedorVideo(new ProvedorVideoSimulado({ falhar: true }));

    const res = await entrar(consulta.id, paciente.token);
    const sala = await prisma.teleconsulta.findUniqueOrThrow({
      where: { consultaId: consulta.id },
    });

    expect(res.status).toBe(502);
    expect(sala.iniciadaEm).toBeNull();
  });
});

describe("POST /consultas/:id/teleconsulta/encerramento", () => {
  const consultaIniciada = async () => {
    const consulta = await teleconsultaEm(5);
    await criarSala(consulta.id);
    await entrar(consulta.id, paciente.token);
    return consulta;
  };

  it("encerra a sala no provedor e conclui a consulta", async () => {
    const consulta = await consultaIniciada();

    const res = await encerrar(consulta.id);
    const { data } = await lerJson<{ data: Teleconsulta }>(res);
    const salva = await prisma.consulta.findUniqueOrThrow({
      where: { id: consulta.id },
    });

    expect(res.status).toBe(200);
    expect(data.encerradaEm).not.toBeNull();
    expect(salva.status).toBe("REALIZADA");
    expect(provedor.chamadas.at(-1)?.operacao).toBe("encerrarSala");
  });

  it("depois de encerrada, não aceita nova entrada nem novo encerramento", async () => {
    const consulta = await consultaIniciada();
    await encerrar(consulta.id);

    expect((await entrar(consulta.id, paciente.token)).status).toBe(409);
    expect((await encerrar(consulta.id)).status).toBe(409);
  });

  it("exige que alguém tenha entrado e só o profissional da consulta encerra", async () => {
    const naoIniciada = await teleconsultaEm(5);
    await criarSala(naoIniciada.id);
    const iniciada = await consultaIniciada();

    expect((await encerrar(naoIniciada.id)).status).toBe(409);
    expect((await encerrar(iniciada.id, paciente.token)).status).toBe(403);
  });

  it("mantém a consulta agendada se o provedor falhar ao encerrar", async () => {
    const consulta = await consultaIniciada();
    definirProvedorVideo(new ProvedorVideoSimulado({ falhar: true }));

    const res = await encerrar(consulta.id);
    const salva = await prisma.consulta.findUniqueOrThrow({
      where: { id: consulta.id },
    });

    expect(res.status).toBe(502);
    expect(salva.status).toBe("AGENDADA");
  });
});
