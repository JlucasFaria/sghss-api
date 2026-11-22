import { beforeEach, describe, expect, it } from "bun:test";
import { app } from "../../../app";
import { TERMO_DE_USO } from "../../../config/termo-de-uso";
import { prisma } from "../../../db/client";
import { resetDatabase } from "../../../test/db";
import { gerarCpf } from "../../../test/factories";
import { decrypt, hashCpf } from "../../../utils/crypto";
import type { ErrorResponse } from "../../../utils/response";
import { loginRateLimit, registerRateLimit } from "../auth.routes";

type Data<T> = { data: T };
type Token = { token: string; tipo: string; expiraEm: number };
type Usuario = { id: string; email: string; perfil: string };

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Dados únicos por teste, para os cadastros não colidirem entre si
const novoPaciente = () => ({
  email: `paciente-${crypto.randomUUID().slice(0, 8)}@exemplo.com`,
  senha: "SenhaForte123",
  nome: "Ana Paula Ribeiro",
  cpf: gerarCpf(),
  dataNascimento: "1990-05-20",
  telefone: "(41) 98765-4321",
  aceiteTermo: true,
});

const login = (email: string, senha = "SenhaForte123") =>
  post("/auth/login", { email, senha });

// Os limites são compartilhados no processo e todos os testes saem do mesmo IP
beforeEach(async () => {
  registerRateLimit.reset();
  loginRateLimit.reset();
  await resetDatabase();
});

describe("POST /auth/register", () => {
  it("cadastra o paciente com perfil PACIENTE e e-mail normalizado", async () => {
    const dados = novoPaciente();

    const res = await post("/auth/register", {
      ...dados,
      email: `  ${dados.email.toUpperCase()} `,
    });
    const { data } = (await res.json()) as Data<Usuario>;

    expect(res.status).toBe(201);
    expect(data).toEqual({
      id: expect.any(String),
      email: dados.email,
      perfil: "PACIENTE",
    });
    expect(data).not.toHaveProperty("senhaHash");
  });

  it("grava CPF e telefone cifrados, com hash de busca do CPF", async () => {
    const dados = novoPaciente();
    await post("/auth/register", dados);

    const paciente = await prisma.paciente.findFirstOrThrow();

    expect(paciente.cpfCifrado).not.toContain(dados.cpf);
    expect(decrypt(paciente.cpfCifrado)).toBe(dados.cpf);
    expect(paciente.cpfHash).toBe(hashCpf(dados.cpf));
    expect(decrypt(paciente.telefoneCifrado!)).toBe("41987654321");
  });

  it("registra o consentimento LGPD e o log de auditoria do cadastro", async () => {
    await post("/auth/register", novoPaciente());

    const consentimento = await prisma.consentimentoLgpd.findFirstOrThrow();
    const log = await prisma.logAuditoria.findFirstOrThrow();

    expect(consentimento).toMatchObject({
      versaoTermo: TERMO_DE_USO.versao,
      finalidade: TERMO_DE_USO.finalidade,
      revogadoEm: null,
    });
    expect(log).toMatchObject({
      acao: "CADASTRO_PACIENTE",
      entidade: "paciente",
      detalhes: null,
    });
  });

  it("responde 409 para e-mail já cadastrado, mesmo com maiúsculas", async () => {
    const dados = novoPaciente();
    await post("/auth/register", dados);

    const res = await post("/auth/register", {
      ...novoPaciente(),
      email: dados.email.toUpperCase(),
    });

    expect(res.status).toBe(409);
  });

  it("responde 409 para CPF já cadastrado sem deixar registros parciais", async () => {
    const dados = novoPaciente();
    await post("/auth/register", dados);

    const res = await post("/auth/register", {
      ...novoPaciente(),
      cpf: dados.cpf,
    });

    expect(res.status).toBe(409);
    expect(await prisma.usuario.count()).toBe(1);
    expect(await prisma.logAuditoria.count()).toBe(1);
  });

  it.each([
    ["CPF inválido", { cpf: "123.456.789-00" }, "cpf"],
    ["script no nome", { nome: "<script>alert(1)</script>" }, "nome"],
    ["senha fraca", { senha: "12345678" }, "senha"],
    ["sem aceite do termo", { aceiteTermo: false }, "aceiteTermo"],
    [
      "nascimento no futuro",
      { dataNascimento: "2999-01-01" },
      "dataNascimento",
    ],
    ["e-mail inválido", { email: "ana@" }, "email"],
  ])("responde 400 com %s", async (_, campos, campo) => {
    const res = await post("/auth/register", { ...novoPaciente(), ...campos });
    const body = (await res.json()) as ErrorResponse;

    expect(res.status).toBe(400);
    expect(body.error.details?.map((d) => d.field)).toContain(campo);
    expect(await prisma.usuario.count()).toBe(0);
  });

  it("bloqueia com 429 depois de 10 cadastros do mesmo IP", async () => {
    for (let i = 0; i < 10; i++) await post("/auth/register", {});

    const res = await post("/auth/register", novoPaciente());

    expect(res.status).toBe(429);
    expect(await prisma.usuario.count()).toBe(0);
  });
});

describe("POST /auth/login", () => {
  it("emite token Bearer que dá acesso a GET /auth/me", async () => {
    const dados = novoPaciente();
    await post("/auth/register", dados);

    const res = await login(dados.email.toUpperCase());
    const { data } = (await res.json()) as Data<Token>;
    const me = await app.request("/auth/me", {
      headers: { Authorization: `Bearer ${data.token}` },
    });

    expect(res.status).toBe(200);
    expect(data.tipo).toBe("Bearer");
    expect(me.status).toBe(200);
    expect(((await me.json()) as Data<Usuario>).data.email).toBe(dados.email);
  });

  it("responde 401 com a mesma mensagem para senha errada e e-mail inexistente", async () => {
    const dados = novoPaciente();
    await post("/auth/register", dados);

    const senhaErrada = await login(dados.email, "SenhaErrada123");
    const inexistente = await login("ninguem@exemplo.com");

    expect(senhaErrada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(await senhaErrada.json()).toEqual(await inexistente.json());
  });

  it("responde 401 para usuário inativo com a senha correta", async () => {
    const dados = novoPaciente();
    await post("/auth/register", dados);
    await prisma.usuario.updateMany({ data: { ativo: false } });

    expect((await login(dados.email)).status).toBe(401);
  });

  it("audita sucesso e falha sem gravar o e-mail digitado", async () => {
    const dados = novoPaciente();
    await post("/auth/register", dados);
    await login(dados.email);
    await login("ninguem@exemplo.com");

    const logs = await prisma.logAuditoria.findMany({
      where: { acao: { in: ["LOGIN", "LOGIN_FALHA"] } },
      orderBy: { criadoEm: "asc" },
    });

    expect(logs.map((log) => log.acao)).toEqual(["LOGIN", "LOGIN_FALHA"]);
    expect(logs[1]?.usuarioId).toBeNull();
    expect(JSON.stringify(logs)).not.toContain("ninguem@exemplo.com");
  });

  it("bloqueia com 429 depois de 5 tentativas para o mesmo e-mail", async () => {
    const email = novoPaciente().email;
    for (let i = 0; i < 5; i++) await login(email, "SenhaErrada123");

    const res = await login(email);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("GET /auth/me", () => {
  it("responde 401 sem token", async () => {
    expect((await app.request("/auth/me")).status).toBe(401);
  });
});
