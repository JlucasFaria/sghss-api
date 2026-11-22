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
  HORARIO_ABERTO: "HORARIO_ABERTO",
  HORARIO_ATUALIZADO: "HORARIO_ATUALIZADO",
  PACIENTE_CONSULTADO: "PACIENTE_CONSULTADO",
  PACIENTE_ATUALIZADO: "PACIENTE_ATUALIZADO",
  PACIENTE_INATIVADO: "PACIENTE_INATIVADO",
  HISTORICO_CONSULTADO: "HISTORICO_CONSULTADO",
  CONSULTA_AGENDADA: "CONSULTA_AGENDADA",
  CONSULTA_CANCELADA: "CONSULTA_CANCELADA",
  CONSULTA_REAGENDADA: "CONSULTA_REAGENDADA",
  EXAME_AGENDADO: "EXAME_AGENDADO",
  EXAME_RESULTADO_REGISTRADO: "EXAME_RESULTADO_REGISTRADO",
  PRONTUARIO_REGISTRADO: "PRONTUARIO_REGISTRADO",
  PRONTUARIO_CONSULTADO: "PRONTUARIO_CONSULTADO",
  CONSULTA_REALIZADA: "CONSULTA_REALIZADA",
  RECEITA_EMITIDA: "RECEITA_EMITIDA",
  RECEITA_CONSULTADA: "RECEITA_CONSULTADA",
  RECEITA_VALIDADA: "RECEITA_VALIDADA",
  TELECONSULTA_CRIADA: "TELECONSULTA_CRIADA",
  TELECONSULTA_ENTRADA: "TELECONSULTA_ENTRADA",
  TELECONSULTA_ENCERRADA: "TELECONSULTA_ENCERRADA",
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

// Aceita o cliente de uma transação para gravar o log junto com a ação auditada.
// Os campos são copiados um a um: dados extras de quem chama (ex.: o perfil do Ator)
// nunca chegam à tabela.
export const registrarAuditoria = (
  { usuarioId, acao, entidade, entidadeId, ip, detalhes }: RegistroAuditoria,
  db: Prisma.TransactionClient = prisma,
) =>
  db.logAuditoria.create({
    data: { usuarioId, acao, entidade, entidadeId, ip, detalhes },
  });
