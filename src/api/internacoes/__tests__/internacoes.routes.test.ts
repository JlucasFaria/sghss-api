import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import {
  criarLeito,
  criarPaciente,
  criarUnidade,
} from "../../../test/factories";
import { autenticar, lerJson, requisitar } from "../../../test/http";
import { AcaoAuditoria } from "../../auditoria/auditoria.service";

type Internacao = {
  id: string;
  paciente: { id: string };
  leito: { id: string };
  altaEm: string | null;
};

let token: string;
let paciente: Awaited<ReturnType<typeof criarPaciente>>;
let leito: Awaited<ReturnType<typeof criarLeito>>;

const internarEm = (leitoId: string, pacienteId = paciente.id) =>
  requisitar("POST", "/internacoes", {
    token,
    body: { pacienteId, leitoId, motivo: "Pneumonia" },
  });

async function internacaoAtiva() {
  const res = await internarEm(leito.id);
  return (await lerJson<{ data: Internacao }>(res)).data;
}

const statusDo = async (leitoId: string) =>
  (await prisma.leito.findUniqueOrThrow({ where: { id: leitoId } })).status;

beforeEach(async () => {
  await resetDatabase();
  token = await autenticar(Perfil.ADMIN);
  paciente = await criarPaciente();
  leito = await criarLeito();
});

it("é exclusivo do ADMIN", async () => {
  expect((await requisitar("GET", "/internacoes")).status).toBe(401);
  for (const perfil of [Perfil.MEDICO, Perfil.ENFERMEIRO, Perfil.PACIENTE]) {
    const res = await requisitar("GET", "/internacoes", {
      token: await autenticar(perfil),
    });
    expect(res.status).toBe(403);
  }
});

describe("internar", () => {
  it("ocupa o leito, audita e não expõe o motivo", async () => {
    const res = await internarEm(leito.id);

    expect(res.status).toBe(201);
    const { data } = await lerJson<{ data: Internacao }>(res);
    expect(data).toMatchObject({
      paciente: { id: paciente.id },
      leito: { id: leito.id },
      altaEm: null,
    });
    expect(data).not.toHaveProperty("motivo");
    expect(await statusDo(leito.id)).toBe("OCUPADO");
    expect(
      await prisma.logAuditoria.count({
        where: { acao: AcaoAuditoria.INTERNACAO_REGISTRADA },
      }),
    ).toBe(1);
  });

  it("recusa leito que não está livre", async () => {
    const manutencao = await criarLeito({ status: "MANUTENCAO" });

    expect((await internarEm(manutencao.id)).status).toBe(409);
    expect(await prisma.internacao.count()).toBe(0);
  });

  it("recusa leito de unidade inativa", async () => {
    const unidade = await criarUnidade({ ativo: false });
    const inativo = await criarLeito({ unidadeId: unidade.id });

    expect((await internarEm(inativo.id)).status).toBe(409);
  });

  it("recusa paciente já internado", async () => {
    await internarEm(leito.id);
    const outro = await criarLeito();

    expect((await internarEm(outro.id)).status).toBe(409);
    expect(await statusDo(outro.id)).toBe("LIVRE");
  });

  it("recusa paciente anonimizado", async () => {
    const anonimizado = await criarPaciente({ anonimizadoEm: new Date() });

    expect((await internarEm(leito.id, anonimizado.id)).status).toBe(409);
  });

  it("responde 404 para paciente ou leito inexistente", async () => {
    expect((await internarEm(leito.id, crypto.randomUUID())).status).toBe(404);
    expect((await internarEm(crypto.randomUUID())).status).toBe(404);
  });

  it("com duas internações simultâneas no mesmo leito, só uma ocupa", async () => {
    const outro = await criarPaciente();

    const respostas = await Promise.all([
      internarEm(leito.id),
      internarEm(leito.id, outro.id),
    ]);

    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.internacao.count()).toBe(1);
  });

  it("com duas internações simultâneas do mesmo paciente, só uma é registrada", async () => {
    const outro = await criarLeito();

    const respostas = await Promise.all([
      internarEm(leito.id),
      internarEm(outro.id),
    ]);

    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.leito.count({ where: { status: "OCUPADO" } })).toBe(1);
  });
});

describe("transferir", () => {
  const transferir = (id: string, leitoId: string) =>
    requisitar("POST", `/internacoes/${id}/transferencia`, {
      token,
      body: { leitoId },
    });

  it("ocupa o destino, libera a origem e audita os dois leitos", async () => {
    const internacao = await internacaoAtiva();
    const destino = await criarLeito();

    const res = await transferir(internacao.id, destino.id);

    expect(res.status).toBe(200);
    expect((await lerJson<{ data: Internacao }>(res)).data.leito.id).toBe(
      destino.id,
    );
    expect(await statusDo(destino.id)).toBe("OCUPADO");
    expect(await statusDo(leito.id)).toBe("LIVRE");

    const [log] = await prisma.logAuditoria.findMany({
      where: { acao: AcaoAuditoria.INTERNACAO_TRANSFERIDA },
    });
    expect(log?.detalhes).toEqual({
      leitoOrigemId: leito.id,
      leitoDestinoId: destino.id,
    });
  });

  it("recusa destino ocupado e mantém tudo como estava", async () => {
    const internacao = await internacaoAtiva();
    const ocupado = await criarLeito({ status: "OCUPADO" });

    expect((await transferir(internacao.id, ocupado.id)).status).toBe(409);
    expect(await statusDo(leito.id)).toBe("OCUPADO");
    const atual = await prisma.internacao.findUniqueOrThrow({
      where: { id: internacao.id },
    });
    expect(atual.leitoId).toBe(leito.id);
  });

  it("recusa transferir para o mesmo leito ou internação encerrada", async () => {
    const internacao = await internacaoAtiva();
    expect((await transferir(internacao.id, leito.id)).status).toBe(409);

    await requisitar("POST", `/internacoes/${internacao.id}/alta`, { token });
    const destino = await criarLeito();
    expect((await transferir(internacao.id, destino.id)).status).toBe(409);
    expect(await statusDo(destino.id)).toBe("LIVRE");
  });

  it("responde 404 para internação inexistente", async () => {
    const destino = await criarLeito();
    const res = await transferir(crypto.randomUUID(), destino.id);
    expect(res.status).toBe(404);
  });
});

describe("alta", () => {
  const alta = (id: string) =>
    requisitar("POST", `/internacoes/${id}/alta`, { token });

  it("encerra a internação, libera o leito e audita", async () => {
    const internacao = await internacaoAtiva();

    const res = await alta(internacao.id);

    expect(res.status).toBe(200);
    expect(
      (await lerJson<{ data: Internacao }>(res)).data.altaEm,
    ).not.toBeNull();
    expect(await statusDo(leito.id)).toBe("LIVRE");
    expect(
      await prisma.logAuditoria.count({
        where: { acao: AcaoAuditoria.INTERNACAO_ALTA },
      }),
    ).toBe(1);
  });

  it("recusa alta repetida e permite nova internação depois", async () => {
    const internacao = await internacaoAtiva();
    await alta(internacao.id);

    expect((await alta(internacao.id)).status).toBe(409);
    expect((await internarEm(leito.id)).status).toBe(201);
  });

  it("alta e transferência simultâneas não deixam leito preso", async () => {
    const internacao = await internacaoAtiva();
    const destino = await criarLeito();

    await Promise.all([
      alta(internacao.id),
      requisitar("POST", `/internacoes/${internacao.id}/transferencia`, {
        token,
        body: { leitoId: destino.id },
      }),
    ]);

    // Encerrada a internação, nenhum dos dois leitos pode ficar ocupado
    expect(await statusDo(leito.id)).toBe("LIVRE");
    expect(await statusDo(destino.id)).toBe("LIVRE");
  });
});

describe("listagem", () => {
  it("filtra por situação, unidade e paciente", async () => {
    const ativa = await internacaoAtiva();
    const outroPaciente = await criarPaciente();
    const unidade = await criarUnidade();
    const outroLeito = await criarLeito({ unidadeId: unidade.id });
    const res = await internarEm(outroLeito.id, outroPaciente.id);
    const encerrada = (await lerJson<{ data: Internacao }>(res)).data;
    await requisitar("POST", `/internacoes/${encerrada.id}/alta`, { token });

    const listar = async (query: string) => {
      const r = await requisitar("GET", `/internacoes${query}`, { token });
      const { data } = await lerJson<{ data: Internacao[] }>(r);
      return data.map((i) => i.id);
    };

    expect(await listar("?situacao=ATIVA")).toEqual([ativa.id]);
    expect(await listar("?situacao=ENCERRADA")).toEqual([encerrada.id]);
    expect(await listar(`?unidadeId=${unidade.id}`)).toEqual([encerrada.id]);
    expect(await listar(`?pacienteId=${paciente.id}`)).toEqual([ativa.id]);
    expect(
      (await requisitar("GET", "/internacoes?situacao=X", { token })).status,
    ).toBe(400);
  });
});
