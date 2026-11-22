// Regras de negócio de pacientes: gestão pelo ADMIN (RF08) e perfil do titular (RF09)
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { decrypt, encrypt, hashCpf } from "../../utils/crypto";
import {
  buildPaginationMeta,
  toSkipTake,
  type PaginationQuery,
} from "../../utils/pagination";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import type {
  AtualizarPacienteInput,
  AtualizarPerfilInput,
  PacienteResponse,
  PacienteResumo,
} from "./pacientes.schema";

const selecao = {
  id: true,
  nome: true,
  cpfCifrado: true,
  dataNascimento: true,
  telefoneCifrado: true,
  criadoEm: true,
  usuario: { select: { email: true, ativo: true } },
} satisfies Prisma.PacienteSelect;

type PacienteSelecionado = Prisma.PacienteGetPayload<{
  select: typeof selecao;
}>;

const paraData = (date: Date) => date.toISOString().slice(0, 10);

// Mostra só os 6 dígitos do meio, ex.: ***.982.247-**
const mascararCpf = (cpf: string) =>
  `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;

// Decifra CPF e telefone para a resposta completa
const paraResposta = (p: PacienteSelecionado): PacienteResponse => ({
  id: p.id,
  nome: p.nome,
  cpf: decrypt(p.cpfCifrado),
  dataNascimento: paraData(p.dataNascimento),
  telefone: p.telefoneCifrado ? decrypt(p.telefoneCifrado) : null,
  email: p.usuario.email,
  ativo: p.usuario.ativo,
  criadoEm: p.criadoEm,
});

const paraResumo = (p: PacienteSelecionado): PacienteResumo => ({
  id: p.id,
  nome: p.nome,
  cpf: mascararCpf(decrypt(p.cpfCifrado)),
  dataNascimento: paraData(p.dataNascimento),
  email: p.usuario.email,
  ativo: p.usuario.ativo,
});

async function buscarPacienteOuFalhar(
  where: Prisma.PacienteWhereUniqueInput,
  db: Prisma.TransactionClient = prisma,
) {
  const paciente = await db.paciente.findUnique({ where, select: selecao });
  if (!paciente) throw notFound("Paciente não encontrado.");
  return paciente;
}

// Leitura de dados pessoais completos também entra na trilha de auditoria (RF22)
const auditarConsulta = (id: string, ator: Ator, via: "id" | "cpf") =>
  registrarAuditoria({
    ...ator,
    acao: AcaoAuditoria.PACIENTE_CONSULTADO,
    entidade: "paciente",
    entidadeId: id,
    detalhes: { via },
  });

export async function listarPacientes(paginacao: PaginationQuery) {
  const [pacientes, total] = await prisma.$transaction([
    prisma.paciente.findMany({
      select: selecao,
      orderBy: { nome: "asc" },
      ...toSkipTake(paginacao),
    }),
    prisma.paciente.count(),
  ]);

  return {
    data: pacientes.map(paraResumo),
    meta: buildPaginationMeta(paginacao, total),
  };
}

export async function obterPaciente(id: string, ator: Ator) {
  const paciente = await buscarPacienteOuFalhar({ id });
  await auditarConsulta(id, ator, "id");
  return paraResposta(paciente);
}

// O CPF chega no corpo (nunca na URL) e é comparado pelo hash, sem decifrar a tabela
export async function buscarPorCpf(cpf: string, ator: Ator) {
  const paciente = await buscarPacienteOuFalhar({ cpfHash: hashCpf(cpf) });
  await auditarConsulta(paciente.id, ator, "cpf");
  return paraResposta(paciente);
}

// CPF corrigido recebe nova cifra e novo hash; CPF de outro paciente vira 409
export function atualizarPaciente(
  id: string,
  { cpf, telefone, ativo, ...dados }: AtualizarPacienteInput,
  ator: Ator,
) {
  return prisma.$transaction(async (tx) => {
    await buscarPacienteOuFalhar({ id }, tx);

    const paciente = await tx.paciente.update({
      where: { id },
      data: {
        ...dados,
        cpfCifrado: encrypt(cpf),
        cpfHash: hashCpf(cpf),
        // PUT substitui os dados: telefone omitido é removido
        telefoneCifrado: telefone ? encrypt(telefone) : null,
        usuario: { update: { ativo } },
      },
      select: selecao,
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.PACIENTE_ATUALIZADO,
        entidade: "paciente",
        entidadeId: id,
      },
      tx,
    );

    return paraResposta(paciente);
  });
}

// Inativa o acesso; o prontuário tem guarda obrigatória e é preservado
export function inativarPaciente(id: string, ator: Ator) {
  return prisma.$transaction(async (tx) => {
    await buscarPacienteOuFalhar({ id }, tx);

    await tx.paciente.update({
      where: { id },
      data: { usuario: { update: { ativo: false } } },
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.PACIENTE_INATIVADO,
        entidade: "paciente",
        entidadeId: id,
      },
      tx,
    );
  });
}

// ---------- Perfil do próprio paciente (RF09) ----------

export async function obterMeuPerfil(usuarioId: string) {
  return paraResposta(await buscarPacienteOuFalhar({ usuarioId }));
}

export function atualizarMeuPerfil(
  { telefone, ...dados }: AtualizarPerfilInput,
  ator: Ator,
) {
  return prisma.$transaction(async (tx) => {
    const { id } = await buscarPacienteOuFalhar(
      { usuarioId: ator.usuarioId },
      tx,
    );

    const paciente = await tx.paciente.update({
      where: { id },
      data: { ...dados, telefoneCifrado: telefone ? encrypt(telefone) : null },
      select: selecao,
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.PACIENTE_ATUALIZADO,
        entidade: "paciente",
        entidadeId: id,
        detalhes: { origem: "titular" },
      },
      tx,
    );

    return paraResposta(paciente);
  });
}
