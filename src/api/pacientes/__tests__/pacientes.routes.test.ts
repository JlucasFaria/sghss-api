import { beforeEach, describe, expect, it } from "bun:test";
import { Perfil } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import { criarPaciente, criarUsuario, gerarCpf } from "../../../test/factories";
import { autenticar, lerJson, requisitar, tokenDe } from "../../../test/http";
import { decrypt, hashCpf } from "../../../utils/crypto";
import type { PaginationMeta } from "../../../utils/pagination";
import type { ErrorResponse } from "../../../utils/response";
import { registerRateLimit } from "../../auth/auth.routes";

type Paciente = {
  id: string;
  nome: string;
  cpf: string;
  dataNascimento: string;
  telefone?: string | null;
  email: string;
  ativo: boolean;
};

let admin: string;

beforeEach(async () => {
  registerRateLimit.reset();
  await resetDatabase();
  admin = await autenticar(Perfil.ADMIN);
});

describe("casos de teste do material (CT)", () => {
  const cadastro = (campos: Record<string, unknown> = {}) => ({
    email: `ct-${crypto.randomUUID().slice(0, 8)}@exemplo.com`,
    senha: "SenhaForte123",
    nome: "Maria da Silva",
    cpf: "529.982.247-25",
    dataNascimento: "1988-07-14",
    aceiteTermo: true,
    ...campos,
  });

  it("CT01 cadastro válido: o paciente é criado e encontrado pelo CPF", async () => {
    const res = await requisitar("POST", "/auth/register", {
      body: cadastro(),
    });
    const busca = await requisitar("POST", "/pacientes/busca", {
      token: admin,
      body: { cpf: "52998224725" },
    });

    expect(res.status).toBe(201);
    expect(busca.status).toBe(200);
    expect((await lerJson<{ data: Paciente }>(busca)).data.nome).toBe(
      "Maria da Silva",
    );
  });

  it("CT02 CPF inválido: responde 400 com mensagem clara e não grava nada", async () => {
    const res = await requisitar("POST", "/auth/register", {
      body: cadastro({ cpf: "529.982.247-24" }),
    });
    const body = await lerJson<ErrorResponse>(res);

    expect(res.status).toBe(400);
    expect(body.error.details).toContainEqual({
      field: "cpf",
      message: "CPF inválido.",
    });
    expect(await prisma.paciente.count()).toBe(0);
  });

  it("CT03 script no nome: responde 400 e bloqueia XSS armazenado", async () => {
    const res = await requisitar("POST", "/auth/register", {
      body: cadastro({ nome: '<script>alert("xss")</script>' }),
    });
    const body = await lerJson<ErrorResponse>(res);

    expect(res.status).toBe(400);
    expect(body.error.details).toContainEqual({
      field: "nome",
      message: "Não é permitido HTML ou script neste campo.",
    });
    expect(await prisma.paciente.count()).toBe(0);
  });
});

describe("gestão pelo ADMIN", () => {
  it("lista paginado com CPF mascarado e sem telefone", async () => {
    await criarPaciente({ nome: "Bruno", cpf: "52998224725" });
    await criarPaciente({ nome: "Ana" });

    const res = await requisitar("GET", "/pacientes?limit=1", { token: admin });
    const body = await lerJson<{ data: Paciente[]; meta: PaginationMeta }>(res);

    expect(res.status).toBe(200);
    expect(body.meta).toMatchObject({ total: 2, totalPages: 2 });
    expect(body.data[0]?.nome).toBe("Ana");

    const segunda = await requisitar("GET", "/pacientes?page=2&limit=1", {
      token: admin,
    });
    const bruno = (await lerJson<{ data: Paciente[] }>(segunda)).data[0];
    expect(bruno?.cpf).toBe("***.982.247-**");
    expect(bruno).not.toHaveProperty("telefone");
  });

  it("busca pelo CPF no corpo, com ou sem máscara, e audita a leitura", async () => {
    const paciente = await criarPaciente({ cpf: "52998224725" });

    const res = await requisitar("POST", "/pacientes/busca", {
      token: admin,
      body: { cpf: "529.982.247-25" },
    });
    const log = await prisma.logAuditoria.findFirst({
      where: { acao: "PACIENTE_CONSULTADO" },
    });

    expect(res.status).toBe(200);
    expect((await lerJson<{ data: Paciente }>(res)).data.id).toBe(paciente.id);
    expect(log).toMatchObject({
      entidadeId: paciente.id,
      detalhes: { via: "cpf" },
    });
  });

  it("responde 404 para CPF válido não cadastrado e 400 para CPF inválido", async () => {
    const naoCadastrado = await requisitar("POST", "/pacientes/busca", {
      token: admin,
      body: { cpf: gerarCpf() },
    });
    const invalido = await requisitar("POST", "/pacientes/busca", {
      token: admin,
      body: { cpf: "123" },
    });

    expect(naoCadastrado.status).toBe(404);
    expect(invalido.status).toBe(400);
  });

  it("consulta os dados completos e decifrados", async () => {
    const paciente = await criarPaciente({ cpf: "52998224725" });

    const res = await requisitar("GET", `/pacientes/${paciente.id}`, {
      token: admin,
    });

    expect((await lerJson<{ data: Paciente }>(res)).data).toMatchObject({
      cpf: "52998224725",
      dataNascimento: "1990-01-01",
      telefone: null,
    });
  });

  it("corrige o CPF regravando cifra e hash", async () => {
    const paciente = await criarPaciente();
    const novoCpf = gerarCpf();

    const res = await requisitar("PUT", `/pacientes/${paciente.id}`, {
      token: admin,
      body: {
        nome: "Nome Corrigido",
        cpf: novoCpf,
        dataNascimento: "1991-02-03",
        telefone: "(41) 98765-4321",
      },
    });
    const salvo = await prisma.paciente.findUniqueOrThrow({
      where: { id: paciente.id },
    });

    expect(res.status).toBe(200);
    expect(decrypt(salvo.cpfCifrado)).toBe(novoCpf);
    expect(salvo.cpfHash).toBe(hashCpf(novoCpf));
    expect(decrypt(salvo.telefoneCifrado!)).toBe("41987654321");
  });

  it("responde 409 ao usar o CPF de outro paciente", async () => {
    const paciente = await criarPaciente();
    const cpfDoOutro = gerarCpf();
    await criarPaciente({ cpf: cpfDoOutro });

    const res = await requisitar("PUT", `/pacientes/${paciente.id}`, {
      token: admin,
      body: { nome: "X", cpf: cpfDoOutro, dataNascimento: "1990-01-01" },
    });

    expect(res.status).toBe(409);
  });

  it("inativa o paciente e bloqueia o acesso dele", async () => {
    const usuario = await criarUsuario();
    const paciente = await criarPaciente({ usuarioId: usuario.id });
    const token = await tokenDe(usuario);

    const res = await requisitar("DELETE", `/pacientes/${paciente.id}`, {
      token: admin,
    });

    expect(res.status).toBe(204);
    expect((await requisitar("GET", "/pacientes/me", { token })).status).toBe(
      401,
    );
    expect(await prisma.paciente.count()).toBe(1);
  });

  it.each([Perfil.PACIENTE, Perfil.MEDICO])(
    "responde 403 para o perfil %s",
    async (perfil) => {
      const res = await requisitar("GET", "/pacientes", {
        token: await autenticar(perfil),
      });

      expect(res.status).toBe(403);
    },
  );
});

describe("perfil do próprio paciente", () => {
  let token: string;
  let pacienteId: string;

  beforeEach(async () => {
    const usuario = await criarUsuario();
    pacienteId = (
      await criarPaciente({ usuarioId: usuario.id, cpf: "52998224725" })
    ).id;
    token = await tokenDe(usuario);
  });

  it("devolve os próprios dados completos", async () => {
    const res = await requisitar("GET", "/pacientes/me", { token });

    expect((await lerJson<{ data: Paciente }>(res)).data).toMatchObject({
      id: pacienteId,
      cpf: "52998224725",
    });
  });

  it("atualiza nome, nascimento e telefone, mas ignora o CPF", async () => {
    const res = await requisitar("PUT", "/pacientes/me", {
      token,
      body: {
        nome: "Nome Novo",
        dataNascimento: "1985-02-03",
        telefone: "(41) 98888-7777",
        cpf: gerarCpf(),
      },
    });
    const { data } = await lerJson<{ data: Paciente }>(res);

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      nome: "Nome Novo",
      dataNascimento: "1985-02-03",
      telefone: "41988887777",
      cpf: "52998224725",
    });
  });

  it("rejeita script no nome ao atualizar o perfil", async () => {
    const res = await requisitar("PUT", "/pacientes/me", {
      token,
      body: {
        nome: "<img src=x onerror=alert(1)>",
        dataNascimento: "1985-02-03",
      },
    });

    expect(res.status).toBe(400);
  });

  it("responde 403 para quem não é paciente", async () => {
    const res = await requisitar("GET", "/pacientes/me", {
      token: await autenticar(Perfil.MEDICO),
    });

    expect(res.status).toBe(403);
  });
});
