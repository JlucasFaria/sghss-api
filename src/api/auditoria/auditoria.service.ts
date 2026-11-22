// Trilha de auditoria (RF22, RNF05): quem fez o quê, quando e de qual IP. Somente inclusão.
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";

export const AcaoAuditoria = {
  CADASTRO_PACIENTE: "CADASTRO_PACIENTE",
  LOGIN: "LOGIN",
  LOGIN_FALHA: "LOGIN_FALHA",
  UNIDADE_CRIADA: "UNIDADE_CRIADA",
  UNIDADE_ATUALIZADA: "UNIDADE_ATUALIZADA",
  UNIDADE_INATIVADA: "UNIDADE_INATIVADA",
  PROFISSIONAL_CRIADO: "PROFISSIONAL_CRIADO",
  PROFISSIONAL_ATUALIZADO: "PROFISSIONAL_ATUALIZADO",
  PROFISSIONAL_INATIVADO: "PROFISSIONAL_INATIVADO",
} as const;

export type RegistroAuditoria = {
  usuarioId?: string | null;
  acao: (typeof AcaoAuditoria)[keyof typeof AcaoAuditoria];
  entidade: string;
  entidadeId?: string | null;
  ip: string;
  // Apenas identificadores e tipo de alteração: nunca dados pessoais ou clínicos
  detalhes?: Prisma.InputJsonObject;
};

// Aceita o cliente de uma transação para gravar o log junto com a ação auditada
export const registrarAuditoria = (
  registro: RegistroAuditoria,
  db: Prisma.TransactionClient = prisma,
) => db.logAuditoria.create({ data: registro });
