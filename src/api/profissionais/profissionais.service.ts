// Regras de negócio dos profissionais de saúde (RF06)
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { badRequest, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { buildPaginationMeta, toSkipTake } from "../../utils/pagination";
import { hashPassword } from "../../utils/password";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import { exigirSemConsultasFuturas } from "../consultas/consultas.service";
import type {
  AtualizarProfissionalInput,
  CriarProfissionalInput,
  ListarProfissionaisQuery,
  ProfissionalResponse,
} from "./profissionais.schema";

// O e-mail de acesso só é carregado para o ADMIN
const selecionar = (admin: boolean) =>
  ({
    id: true,
    nome: true,
    conselho: true,
    registro: true,
    especialidade: true,
    unidade: { select: { id: true, nome: true } },
    usuario: { select: { perfil: true, ativo: true, email: admin } },
  }) satisfies Prisma.ProfissionalSelect;

type ProfissionalSelecionado = Prisma.ProfissionalGetPayload<{
  select: ReturnType<typeof selecionar>;
}>;

// Achata o usuário vinculado na resposta (perfil, ativo e e-mail)
const paraResposta = ({
  usuario,
  ...profissional
}: ProfissionalSelecionado): ProfissionalResponse => ({
  ...profissional,
  perfil: usuario.perfil as ProfissionalResponse["perfil"],
  ativo: usuario.ativo,
  email: usuario.email ?? undefined,
});

// Novos vínculos só podem apontar para unidades ativas
async function exigirUnidadeAtiva(id: string, db: Prisma.TransactionClient) {
  const unidade = await db.unidade.findUnique({ where: { id } });
  if (!unidade?.ativo) throw badRequest("Unidade inexistente ou inativa.");
}

// Profissionais inativos só aparecem para o ADMIN
export async function listarProfissionais(
  { unidadeId, especialidade, ...paginacao }: ListarProfissionaisQuery,
  admin: boolean,
) {
  const where: Prisma.ProfissionalWhereInput = {
    unidadeId,
    especialidade: especialidade
      ? { contains: especialidade, mode: "insensitive" }
      : undefined,
    usuario: admin ? undefined : { ativo: true },
  };

  const [profissionais, total] = await prisma.$transaction([
    prisma.profissional.findMany({
      where,
      select: selecionar(admin),
      orderBy: { nome: "asc" },
      ...toSkipTake(paginacao),
    }),
    prisma.profissional.count({ where }),
  ]);

  return {
    data: profissionais.map(paraResposta),
    meta: buildPaginationMeta(paginacao, total),
  };
}

export async function buscarProfissional(
  id: string,
  admin: boolean,
  db: Prisma.TransactionClient = prisma,
) {
  const profissional = await db.profissional.findUnique({
    where: { id },
    select: selecionar(admin),
  });
  if (!profissional || (!admin && !profissional.usuario.ativo)) {
    throw notFound("Profissional não encontrado.");
  }
  return paraResposta(profissional);
}

// Cria o usuário de acesso e o profissional juntos. E-mail ou registro no
// conselho repetidos violam a unicidade e viram 409 no error handler.
export async function criarProfissional(
  { email, senha, perfil, unidadeId, ...dados }: CriarProfissionalInput,
  ator: Ator,
) {
  const senhaHash = await hashPassword(senha);

  return prisma.$transaction(async (tx) => {
    await exigirUnidadeAtiva(unidadeId, tx);

    const profissional = await tx.profissional.create({
      data: {
        ...dados,
        unidade: { connect: { id: unidadeId } },
        usuario: { create: { email, senhaHash, perfil } },
      },
      select: selecionar(true),
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.PROFISSIONAL_CRIADO,
        entidade: "profissional",
        entidadeId: profissional.id,
      },
      tx,
    );

    return paraResposta(profissional);
  });
}

export function atualizarProfissional(
  id: string,
  { perfil, ativo, unidadeId, ...dados }: AtualizarProfissionalInput,
  ator: Ator,
) {
  return prisma.$transaction(async (tx) => {
    const atual = await buscarProfissional(id, true, tx);
    if (ativo === false) {
      await exigirSemConsultasFuturas({ profissionalId: id }, tx);
    }
    if (unidadeId !== atual.unidade.id) {
      await exigirUnidadeAtiva(unidadeId, tx);
    }

    const profissional = await tx.profissional.update({
      where: { id },
      data: {
        ...dados,
        // PUT substitui os dados: especialidade omitida é removida
        especialidade: dados.especialidade ?? null,
        unidade: { connect: { id: unidadeId } },
        usuario: { update: { perfil, ativo } },
      },
      select: selecionar(true),
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.PROFISSIONAL_ATUALIZADO,
        entidade: "profissional",
        entidadeId: id,
      },
      tx,
    );

    return paraResposta(profissional);
  });
}

// Inativa o usuário: o login e os tokens já emitidos deixam de valer na hora,
// e o histórico clínico do profissional é preservado
export function inativarProfissional(id: string, ator: Ator) {
  return prisma.$transaction(async (tx) => {
    await buscarProfissional(id, true, tx);
    await exigirSemConsultasFuturas({ profissionalId: id }, tx);

    await tx.profissional.update({
      where: { id },
      data: { usuario: { update: { ativo: false } } },
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.PROFISSIONAL_INATIVADO,
        entidade: "profissional",
        entidadeId: id,
      },
      tx,
    );
  });
}
