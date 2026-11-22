// Consentimento do paciente para o tratamento de dados (RF24). Finalidade e versão
// vêm sempre do termo vigente, nunca do cliente. A revogação preenche revogadoEm
// sem apagar o aceite, que continua servindo de prova.
import type { Prisma } from "../../../generated/prisma/client";
import { TERMO_DE_USO } from "../../config/termo-de-uso";
import { prisma } from "../../db/client";
import { conflict, notFound } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import { buscarIdDoPaciente } from "../pacientes/pacientes.service";

export const selecaoConsentimento = {
  id: true,
  finalidade: true,
  versaoTermo: true,
  concedidoEm: true,
  revogadoEm: true,
} satisfies Prisma.ConsentimentoLgpdSelect;

// Todos os aceites, inclusive os revogados, do mais recente para o mais antigo
export async function listarConsentimentos(usuarioId: string) {
  const pacienteId = await buscarIdDoPaciente(usuarioId);
  return prisma.consentimentoLgpd.findMany({
    where: { pacienteId },
    select: selecaoConsentimento,
    orderBy: { concedidoEm: "desc" },
  });
}

// Aceite do termo vigente: após revogar ou quando o termo muda de versão
export function registrarConsentimento(ator: Ator) {
  return prisma.$transaction(async (tx) => {
    const pacienteId = await buscarIdDoPaciente(ator.usuarioId, tx);

    const vigente = await tx.consentimentoLgpd.findFirst({
      where: {
        pacienteId,
        finalidade: TERMO_DE_USO.finalidade,
        versaoTermo: TERMO_DE_USO.versao,
        revogadoEm: null,
      },
      select: { id: true },
    });
    if (vigente) throw conflict("O termo vigente já foi aceito.");

    const consentimento = await tx.consentimentoLgpd.create({
      data: {
        pacienteId,
        finalidade: TERMO_DE_USO.finalidade,
        versaoTermo: TERMO_DE_USO.versao,
        ip: ator.ip,
      },
      select: selecaoConsentimento,
    });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.CONSENTIMENTO_REGISTRADO,
        entidade: "consentimento_lgpd",
        entidadeId: consentimento.id,
        detalhes: { versaoTermo: TERMO_DE_USO.versao },
      },
      tx,
    );

    return consentimento;
  });
}

// Revoga só se ainda estiver ativo, em uma única escrita: com duas requisições
// simultâneas, apenas uma revoga e é auditada. Consentimento de outro paciente
// responde 404, sem revelar que existe.
export function revogarConsentimento(id: string, ator: Ator) {
  return prisma.$transaction(async (tx) => {
    const pacienteId = await buscarIdDoPaciente(ator.usuarioId, tx);

    const { count } = await tx.consentimentoLgpd.updateMany({
      where: { id, pacienteId, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
    if (count === 0) {
      const existe = await tx.consentimentoLgpd.findFirst({
        where: { id, pacienteId },
        select: { id: true },
      });
      if (!existe) throw notFound("Consentimento não encontrado.");
      throw conflict("Este consentimento já foi revogado.");
    }

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.CONSENTIMENTO_REVOGADO,
        entidade: "consentimento_lgpd",
        entidadeId: id,
      },
      tx,
    );
  });
}
