// Regras de negócio da autenticação: autocadastro do paciente, login e usuário atual
import { Perfil } from "../../../generated/prisma/client";
import { env } from "../../config/env";
import { TERMO_DE_USO } from "../../config/termo-de-uso";
import { prisma } from "../../db/client";
import { notFound, unauthorized } from "../../utils/app-error";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import { encrypt, hashCpf } from "../../utils/crypto";
import { hashPassword, verifyPassword } from "../../utils/password";
import { signToken } from "../../utils/token";
import type { LoginInput, RegisterInput } from "./auth.schema";

const usuarioPublico = { id: true, email: true, perfil: true } as const;

// Cria usuário, paciente, consentimento e o log de auditoria na mesma transação.
// E-mail ou CPF repetidos violam a unicidade e viram 409 no error handler.
export async function registrarPaciente(input: RegisterInput, ip: string) {
  const senhaHash = await hashPassword(input.senha);

  return prisma.$transaction(async (tx) => {
    const { paciente, ...usuario } = await tx.usuario.create({
      data: {
        email: input.email,
        senhaHash,
        perfil: Perfil.PACIENTE,
        paciente: {
          create: {
            nome: input.nome,
            cpfCifrado: encrypt(input.cpf),
            cpfHash: hashCpf(input.cpf),
            dataNascimento: input.dataNascimento,
            telefoneCifrado: input.telefone ? encrypt(input.telefone) : null,
            consentimentos: {
              create: {
                finalidade: TERMO_DE_USO.finalidade,
                versaoTermo: TERMO_DE_USO.versao,
                ip,
              },
            },
          },
        },
      },
      select: { ...usuarioPublico, paciente: { select: { id: true } } },
    });

    await registrarAuditoria(
      {
        usuarioId: usuario.id,
        acao: AcaoAuditoria.CADASTRO_PACIENTE,
        entidade: "paciente",
        entidadeId: paciente?.id,
        ip,
      },
      tx,
    );

    return usuario;
  });
}

// Hash fictício comparado quando o e-mail não existe: o tempo de resposta fica
// igual ao de uma senha errada e não revela quais e-mails estão cadastrados.
const hashFicticio = hashPassword(crypto.randomUUID());

export async function login({ email, senha }: LoginInput, ip: string) {
  const usuario = await prisma.usuario.findUnique({ where: { email } });
  const senhaValida = await verifyPassword(
    senha,
    usuario?.senhaHash ?? (await hashFicticio),
  );

  // Conta inativa recebe a mesma resposta, sem confirmar que o e-mail existe.
  // A falha é auditada sem o e-mail digitado (dado pessoal), só com o id quando existe.
  if (!usuario || !senhaValida || !usuario.ativo) {
    await registrarAuditoria({
      usuarioId: usuario?.id,
      acao: AcaoAuditoria.LOGIN_FALHA,
      entidade: "usuario",
      entidadeId: usuario?.id,
      ip,
    });
    throw unauthorized("E-mail ou senha inválidos.");
  }

  await registrarAuditoria({
    usuarioId: usuario.id,
    acao: AcaoAuditoria.LOGIN,
    entidade: "usuario",
    entidadeId: usuario.id,
    ip,
  });

  return {
    token: await signToken({ sub: usuario.id, perfil: usuario.perfil }),
    tipo: "Bearer" as const,
    expiraEm: env.JWT_EXPIRES_IN,
  };
}

export async function buscarUsuarioAtual(id: string) {
  const usuario = await prisma.usuario.findUnique({
    where: { id },
    select: usuarioPublico,
  });
  if (!usuario) throw notFound("Usuário não encontrado.");
  return usuario;
}
