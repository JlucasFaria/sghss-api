import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import { criarUnidade } from "../../../test/factories";
import { autenticar, lerJson, requisitar, tokenDe } from "../../../test/http";
import type { PaginationMeta } from "../../../utils/pagination";
import type { ErrorResponse } from "../../../utils/response";

type Profissional = {
  id: string;
  nome: string;
  perfil: string;
  registro: string;
  especialidade: string | null;
  ativo: boolean;
  unidade: { id: string; nome: string };
  email?: string;
};

let admin: string;
let paciente: string;
let unidadeId: string;

const novoProfissional = () => ({
  email: `prof-${crypto.randomUUID().slice(0, 8)}@vidaplus.example`,
  senha: "SenhaInicial123",
  perfil: "MEDICO",
  nome: "Dra. Ana Souza",
  conselho: "CRM",
  registro: `${Math.floor(Math.random() * 1e6)}-pr`,
  especialidade: "Cardiologia",
  unidadeId,
});

const cadastrar = async (dados = novoProfissional()) => {
  const res = await requisitar("POST", "/profissionais", {
    token: admin,
    body: dados,
  });
  return {
    res,
    dados,
    profissional: (await lerJson<{ data: Profissional }>(res)).data,
  };
};

const login = (email: string, senha = "SenhaInicial123") =>
  requisitar("POST", "/auth/login", { body: { email, senha } });

beforeEach(async () => {
  await resetDatabase();
  admin = await autenticar(Perfil.ADMIN);
  paciente = await autenticar(Perfil.PACIENTE);
  unidadeId = (await criarUnidade()).id;
});

describe("POST /profissionais", () => {
  it("cria o profissional com usuário de acesso que consegue fazer login", async () => {
    const { res, dados, profissional } = await cadastrar();

    expect(res.status).toBe(201);
    expect(profissional).toMatchObject({
      perfil: "MEDICO",
      registro: dados.registro.toUpperCase(),
      ativo: true,
      unidade: { id: unidadeId },
      email: dados.email,
    });
    expect((await login(dados.email)).status).toBe(200);
    expect(
      await prisma.logAuditoria.count({
        where: { acao: "PROFISSIONAL_CRIADO" },
      }),
    ).toBe(1);
  });

  it.each([
    ["MEDICO com COREN", { perfil: "MEDICO", conselho: "COREN" }],
    ["ENFERMEIRO com CRM", { perfil: "ENFERMEIRO", conselho: "CRM" }],
    ["TECNICO com CRM", { perfil: "TECNICO", conselho: "CRM" }],
  ])("responde 400 para conselho incompatível: %s", async (_, campos) => {
    const res = await requisitar("POST", "/profissionais", {
      token: admin,
      body: { ...novoProfissional(), ...campos },
    });
    const body = await lerJson<ErrorResponse>(res);

    expect(res.status).toBe(400);
    expect(body.error.details?.[0]?.field).toBe("conselho");
  });

  it("não permite criar usuário ADMIN por esta rota", async () => {
    const res = await requisitar("POST", "/profissionais", {
      token: admin,
      body: { ...novoProfissional(), perfil: "ADMIN" },
    });

    expect(res.status).toBe(400);
  });

  it("responde 400 para unidade inativa", async () => {
    const inativa = await criarUnidade({ ativo: false });

    const res = await requisitar("POST", "/profissionais", {
      token: admin,
      body: { ...novoProfissional(), unidadeId: inativa.id },
    });

    expect(res.status).toBe(400);
    expect(await prisma.usuario.count({ where: { perfil: "MEDICO" } })).toBe(0);
  });

  it("responde 409 para e-mail ou registro já cadastrados", async () => {
    const { dados } = await cadastrar();

    const emailRepetido = await requisitar("POST", "/profissionais", {
      token: admin,
      body: { ...novoProfissional(), email: dados.email },
    });
    const registroRepetido = await requisitar("POST", "/profissionais", {
      token: admin,
      body: { ...novoProfissional(), registro: dados.registro },
    });

    expect(emailRepetido.status).toBe(409);
    expect(registroRepetido.status).toBe(409);
  });

  it("responde 403 para quem não é ADMIN", async () => {
    const res = await requisitar("POST", "/profissionais", {
      token: paciente,
      body: novoProfissional(),
    });

    expect(res.status).toBe(403);
  });
});

describe("GET /profissionais", () => {
  it("filtra por especialidade sem diferenciar maiúsculas e oculta o e-mail do paciente", async () => {
    await cadastrar();
    await cadastrar({ ...novoProfissional(), especialidade: "Pediatria" });

    const res = await requisitar("GET", "/profissionais?especialidade=CARDIO", {
      token: paciente,
    });
    const body = await lerJson<{ data: Profissional[]; meta: PaginationMeta }>(
      res,
    );

    expect(res.status).toBe(200);
    expect(body.meta.total).toBe(1);
    expect(body.data[0]?.especialidade).toBe("Cardiologia");
    expect(body.data[0]).not.toHaveProperty("email");
  });

  it("filtra por unidade", async () => {
    await cadastrar();
    const outra = await criarUnidade();
    await cadastrar({ ...novoProfissional(), unidadeId: outra.id });

    const res = await requisitar(
      "GET",
      `/profissionais?unidadeId=${outra.id}`,
      {
        token: paciente,
      },
    );

    expect((await lerJson<{ meta: PaginationMeta }>(res)).meta.total).toBe(1);
  });
});

describe("PUT /profissionais/:id", () => {
  it("substitui os dados, troca a unidade e remove a especialidade omitida", async () => {
    const { profissional, dados } = await cadastrar();
    const outra = await criarUnidade({ nome: "Outra Unidade" });

    const res = await requisitar("PUT", `/profissionais/${profissional.id}`, {
      token: admin,
      body: {
        nome: "Dra. Ana Lima",
        perfil: "MEDICO",
        conselho: "CRM",
        registro: dados.registro,
        unidadeId: outra.id,
      },
    });
    const { data } = await lerJson<{ data: Profissional }>(res);

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      nome: "Dra. Ana Lima",
      especialidade: null,
      unidade: { nome: "Outra Unidade" },
    });
  });
});

describe("DELETE /profissionais/:id", () => {
  it("inativa: bloqueia login e tokens já emitidos e oculta o profissional do paciente", async () => {
    const { profissional, dados } = await cadastrar();
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email: dados.email },
    });
    const tokenAntigo = await tokenDe(usuario);

    const res = await requisitar(
      "DELETE",
      `/profissionais/${profissional.id}`,
      {
        token: admin,
      },
    );

    expect(res.status).toBe(204);
    expect((await login(dados.email)).status).toBe(401);
    expect(
      (await requisitar("GET", "/auth/me", { token: tokenAntigo })).status,
    ).toBe(401);
    expect(
      (
        await requisitar("GET", `/profissionais/${profissional.id}`, {
          token: paciente,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await requisitar("GET", `/profissionais/${profissional.id}`, {
          token: admin,
        })
      ).status,
    ).toBe(200);
  });

  it("responde 404 para profissional inexistente", async () => {
    const res = await requisitar(
      "DELETE",
      `/profissionais/${crypto.randomUUID()}`,
      {
        token: admin,
      },
    );

    expect(res.status).toBe(404);
  });
});

describe("validação do cadastro", () => {
  const detalhes = async (body: unknown) => {
    const res = await requisitar("POST", "/profissionais", {
      token: admin,
      body,
    });
    return {
      status: res.status,
      details: (await lerJson<ErrorResponse>(res)).error.details,
    };
  };

  it("exige a UF no registro do conselho", async () => {
    const { status, details } = await detalhes({
      ...novoProfissional(),
      registro: "123456",
    });

    expect(status).toBe(400);
    expect(details?.[0]?.field).toBe("registro");
  });

  it("diferencia campo ausente de identificador inválido", async () => {
    const { unidadeId: _, ...semUnidade } = novoProfissional();

    const ausente = await detalhes(semUnidade);
    const invalido = await detalhes({
      ...novoProfissional(),
      unidadeId: "abc",
    });

    expect(ausente.details).toEqual([
      { field: "unidadeId", message: "Campo obrigatório." },
    ]);
    expect(invalido.details).toEqual([
      { field: "unidadeId", message: "Identificador inválido." },
    ]);
  });

  it("informa campo obrigatório também para enums ausentes", async () => {
    const { perfil: _, ...semPerfil } = novoProfissional();

    const { details } = await detalhes(semPerfil);

    expect(details).toContainEqual({
      field: "perfil",
      message: "Campo obrigatório.",
    });
  });
});
