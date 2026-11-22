// Regras de negócio da autenticação: autocadastro do paciente e login
import { Perfil } from "../../../generated/prisma/client";
import { env } from "../../config/env";
import { TERMO_DE_USO } from "../../config/termo-de-uso";
import { prisma } from "../../db/client";
import { notFound, unauthorized } from "../../utils/app-error";
import { encrypt, hashCpf } from "../../utils/crypto";
import { hashPassword, verifyPassword } from "../../utils/password";
import { signToken } from "../../utils/token";
import type { LoginInput, RegisterInput } from "./auth.schema";

const usuarioPublico = { id: true, email: true, perfil: true } as const;

// Cria usuário, paciente e consentimento numa única operação (escrita aninhada é atômica).
// E-mail ou CPF repetidos violam a unicidade e viram 409 no error handler.
export async function registrarPaciente(input: RegisterInput, ip: string) {
  return prisma.usuario.create({
    data: {
      email: input.email,
      senhaHash: await hashPassword(input.senha),
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
    select: usuarioPublico,
  });
}

// Hash fictício comparado quando o e-mail não existe: o tempo de resposta fica
// igual ao de uma senha errada e não revela quais e-mails estão cadastrados.
const hashFicticio = hashPassword(crypto.randomUUID());

const credenciaisInvalidas = () => unauthorized("E-mail ou senha inválidos.");

export async function login({ email, senha }: LoginInput) {
  const usuario = await prisma.usuario.findUnique({ where: { email } });
  const senhaValida = await verifyPassword(
    senha,
    usuario?.senhaHash ?? (await hashFicticio),
  );

  // Conta inativa recebe a mesma resposta, sem confirmar que o e-mail existe
  if (!usuario || !senhaValida || !usuario.ativo) throw credenciaisInvalidas();

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
