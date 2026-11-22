// Receita digital (RF16): emitida pelo médico da consulta, com código de verificação
// aleatório entregue uma única vez; o banco guarda só o hash SHA-256 do código
import { Perfil, type Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { AppError, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { gerarCodigoVerificacao, hashSha256 } from "../../utils/crypto";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import {
  buscarConsulta,
  exigirConsultaIniciada,
  exigirLeituraClinica,
} from "../prontuario/prontuario.service";
import {
  VALIDADE_PADRAO_DIAS,
  type EmitirReceitaInput,
  type ReceitaResponse,
} from "./receitas.schema";

export const selecaoReceita = {
  id: true,
  consultaId: true,
  emitidaEm: true,
  validaAte: true,
  observacoes: true,
  itens: {
    select: {
      medicamento: true,
      dosagem: true,
      posologia: true,
      quantidade: true,
    },
  },
  consulta: {
    select: {
      paciente: { select: { id: true, nome: true } },
      horario: {
        select: {
          profissional: {
            select: { id: true, nome: true, conselho: true, registro: true },
          },
        },
      },
    },
  },
} satisfies Prisma.PrescricaoSelect;

export type ReceitaSelecionada = Prisma.PrescricaoGetPayload<{
  select: typeof selecaoReceita;
}>;

export const paraResposta = ({
  consulta,
  validaAte,
  ...receita
}: ReceitaSelecionada): ReceitaResponse => ({
  ...receita,
  validaAte: validaAte.toISOString().slice(0, 10),
  medico: consulta.horario.profissional,
  paciente: consulta.paciente,
});

// Leitura completa fora de transação (relações aninhadas: ver consultas.service)
async function buscarReceitaCompleta(id: string) {
  return paraResposta(
    await prisma.prescricao.findUniqueOrThrow({
      where: { id },
      select: selecaoReceita,
    }),
  );
}

const validadePadrao = () => {
  const data = new Date();
  data.setUTCDate(data.getUTCDate() + VALIDADE_PADRAO_DIAS);
  return data;
};

// Só o médico da consulta, em consulta já iniciada e não cancelada
export async function emitirReceita(
  consultaId: string,
  { itens, observacoes, validaAte }: EmitirReceitaInput,
  ator: Ator,
) {
  const codigoVerificacao = gerarCodigoVerificacao();

  const id = await prisma.$transaction(async (tx) => {
    const consulta = await buscarConsulta(consultaId, tx);
    if (consulta.horario.profissional.usuarioId !== ator.usuarioId) {
      throw notFound("Consulta não encontrada.");
    }
    exigirConsultaIniciada(consulta);

    const { id } = await tx.prescricao.create({
      data: {
        consultaId,
        codigoVerificacaoHash: hashSha256(codigoVerificacao),
        observacoes,
        validaAte: validaAte ?? validadePadrao(),
        itens: { create: itens },
      },
      select: { id: true },
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.RECEITA_EMITIDA,
        entidade: "prescricao",
        entidadeId: id,
      },
      tx,
    );

    return id;
  });

  return { ...(await buscarReceitaCompleta(id)), codigoVerificacao };
}

// Mesmas regras de leitura do prontuário: o paciente, o profissional da consulta
// ou um profissional da unidade (leitura de profissional é auditada)
export async function obterReceita(id: string, ator: Ator) {
  const receita = await prisma.prescricao.findUnique({
    where: { id },
    select: { consultaId: true },
  });
  if (!receita) throw notFound("Receita não encontrada.");

  // Sem acesso à consulta, a receita também "não existe" para o ator
  await exigirLeituraClinica(receita.consultaId, ator).catch(
    (erro: unknown) => {
      if (erro instanceof AppError && erro.status === 404) {
        throw notFound("Receita não encontrada.");
      }
      throw erro;
    },
  );

  if (ator.perfil !== Perfil.PACIENTE) {
    await registrarAuditoria({
      ...ator,
      acao: AcaoAuditoria.RECEITA_CONSULTADA,
      entidade: "prescricao",
      entidadeId: id,
    });
  }

  return buscarReceitaCompleta(id);
}
