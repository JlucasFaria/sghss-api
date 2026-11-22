// Direitos do titular sobre os próprios dados (LGPD, art. 18): portabilidade (RF25)
import { prisma } from "../../db/client";
import type { Ator } from "../../utils/ator";
import { decrypt } from "../../utils/crypto";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import { selecaoNotificacao } from "../notificacoes/notificacoes.service";
import { meuHistorico } from "../pacientes/historico.service";
import { obterMeuPerfil } from "../pacientes/pacientes.service";
import { selecaoConsentimento } from "./consentimentos.service";
import type { DadosDoTitular } from "./lgpd.schema";

// Reúne cadastro, consentimentos, histórico clínico, prontuário e notificações.
// O histórico é reaproveitado da rota do paciente para não divergir dela.
export async function exportarMeusDados(ator: Ator): Promise<DadosDoTitular> {
  const cadastro = await obterMeuPerfil(ator.usuarioId);
  const pacienteId = cadastro.id;

  const [conta, consentimentos, historico, evolucoes, notificacoes] =
    await Promise.all([
      prisma.usuario.findUniqueOrThrow({
        where: { id: ator.usuarioId },
        select: { email: true, perfil: true, criadoEm: true },
      }),
      prisma.consentimentoLgpd.findMany({
        where: { pacienteId },
        select: { ...selecaoConsentimento, ip: true },
        orderBy: { concedidoEm: "desc" },
      }),
      meuHistorico(ator.usuarioId),
      prisma.registroProntuario.findMany({
        where: { consulta: { pacienteId } },
        select: {
          id: true,
          consultaId: true,
          conteudoCifrado: true,
          criadoEm: true,
          autor: { select: { id: true, nome: true } },
        },
        orderBy: { criadoEm: "asc" },
      }),
      prisma.notificacao.findMany({
        where: { usuarioId: ator.usuarioId },
        select: selecaoNotificacao,
        orderBy: { criadoEm: "desc" },
      }),
    ]);

  await registrarAuditoria({
    ...ator,
    acao: AcaoAuditoria.DADOS_EXPORTADOS,
    entidade: "paciente",
    entidadeId: pacienteId,
  });

  const { paciente: _, ...clinico } = historico;
  return {
    geradoEm: new Date(),
    conta,
    cadastro,
    consentimentos,
    ...clinico,
    prontuario: evolucoes.map(({ conteudoCifrado, ...evolucao }) => ({
      ...evolucao,
      conteudo: decrypt(conteudoCifrado),
    })),
    notificacoes,
  };
}
