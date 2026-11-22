import { beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../../db/client";
import { resetDatabase } from "../db";
import { criarLeito, criarProfissional, criarUsuario } from "../factories";

describe("banco de testes", () => {
  beforeEach(resetDatabase);

  it("cria um profissional com usuário e unidade vinculados", async () => {
    const profissional = await criarProfissional();

    const salvo = await prisma.profissional.findUniqueOrThrow({
      where: { id: profissional.id },
      include: { usuario: true, unidade: true },
    });

    expect(salvo.usuario.perfil).toBe("MEDICO");
    expect(salvo.unidade.ativo).toBe(true);
  });

  it("aplica os valores padrão do schema", async () => {
    const leito = await criarLeito();

    expect(leito.status).toBe("LIVRE");
  });

  it("esvazia as tabelas a cada reset", async () => {
    await criarProfissional();

    await resetDatabase();

    expect(await prisma.usuario.count()).toBe(0);
    expect(await prisma.profissional.count()).toBe(0);
    expect(await prisma.unidade.count()).toBe(0);
  });

  // O erro é capturado com .catch: `expect(...).rejects` trava com erros do Prisma no Bun
  it("rejeita e-mail de usuário duplicado", async () => {
    await criarUsuario({ email: "repetido@teste.example" });

    const erro = await criarUsuario({ email: "repetido@teste.example" }).catch(
      (error: unknown) => error,
    );

    expect(erro).toMatchObject({ code: "P2002" });
  });

  it("rejeita registro de conselho duplicado", async () => {
    await criarProfissional({ registro: "111111-PR" });

    const erro = await criarProfissional({ registro: "111111-PR" }).catch(
      (error: unknown) => error,
    );

    expect(erro).toMatchObject({ code: "P2002" });
  });

  it("impede excluir usuário com registros de auditoria", async () => {
    const usuario = await criarUsuario();
    await prisma.logAuditoria.create({
      data: {
        usuarioId: usuario.id,
        acao: "LOGIN",
        entidade: "usuario",
        ip: "127.0.0.1",
      },
    });

    const erro = await prisma.usuario
      .delete({ where: { id: usuario.id } })
      .catch((error: unknown) => error);

    expect(erro).toMatchObject({ code: "P2003" });
  });
});
