// Direitos do titular sobre os próprios dados (LGPD, art. 18): portabilidade (RF25)
// e anonimização (RF26)
import { StatusConsulta, type Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { conflict, notFound, unauthorized } from "../../utils/app-error";
import type { Ator } from "../../utils/ator";
import { decrypt, encrypt, hashCpf } from "../../utils/crypto";
import { hashPassword, verifyPassword } from "../../utils/password";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import { selecaoNotificacao } from "../notificacoes/notificacoes.service";
import { meuHistorico } from "../pacientes/historico.service";
import { obterMeuPerfil } from "../pacientes/pacientes.service";
import { selecaoConsentimento } from "./consentimentos.service";
import type { AnonimizacaoInput, DadosDoTitular } from "./lgpd.schema";

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

// ---------- Anonimização (RF26) ----------

const NOME_ANONIMIZADO = "Paciente anonimizado";
// Marcador de CPF inexistente (dígitos repetidos não formam CPF válido)
const CPF_ANONIMIZADO = "00000000000";

// Remove a identificação pessoal a pedido do titular. Consultas, exames, prontuário,
// prescrições e internações têm guarda obrigatória e são preservados, mas deixam de
// apontar para alguém identificável. Consentimentos ficam como prova (revogados) e a
// auditoria mantém o id do usuário, por obrigação legal. Notificações são apagadas.
export async function anonimizarMeusDados(
  { senha }: AnonimizacaoInput,
  ator: Ator,
) {
  const usuario = await prisma.usuario.findUniqueOrThrow({
    where: { id: ator.usuarioId },
    select: { senhaHash: true },
  });
  if (!(await verifyPassword(senha, usuario.senhaHash))) {
    throw unauthorized("Senha incorreta.");
  }
  // Senha aleatória descartada: a conta não pode mais ser acessada
  const senhaHash = await hashPassword(crypto.randomUUID());

  await prisma.$transaction(async (tx) => {
    const paciente = await tx.paciente.findUnique({
      where: { usuarioId: ator.usuarioId },
      select: { id: true, dataNascimento: true },
    });
    if (!paciente) throw notFound("Paciente não encontrado.");
    await exigirSemAtendimentoEmAndamento(paciente.id, tx);

    const agora = new Date();
    await tx.paciente.update({
      where: { id: paciente.id },
      data: {
        nome: NOME_ANONIMIZADO,
        cpfCifrado: encrypt(CPF_ANONIMIZADO),
        // Valor único e sem relação com o CPF, para manter a restrição de unicidade
        cpfHash: hashCpf(crypto.randomUUID()),
        // Só o ano é mantido: a faixa etária ainda serve aos registros clínicos
        dataNascimento: new Date(
          Date.UTC(paciente.dataNascimento.getUTCFullYear(), 0, 1),
        ),
        telefoneCifrado: null,
        anonimizadoEm: agora,
        usuario: {
          update: {
            email: `anonimizado-${paciente.id}@vidaplus.invalid`,
            senhaHash,
            ativo: false,
          },
        },
      },
    });
    await tx.consentimentoLgpd.updateMany({
      where: { pacienteId: paciente.id, revogadoEm: null },
      data: { revogadoEm: agora },
    });
    await tx.notificacao.deleteMany({ where: { usuarioId: ator.usuarioId } });

    await registrarAuditoria(
      {
        ...ator,
        acao: AcaoAuditoria.PACIENTE_ANONIMIZADO,
        entidade: "paciente",
        entidadeId: paciente.id,
      },
      tx,
    );
  });
}

// Consulta agendada ou internação em curso ainda precisam identificar o paciente:
// ele cancela as consultas (ou aguarda a alta) antes de pedir a anonimização
async function exigirSemAtendimentoEmAndamento(
  pacienteId: string,
  db: Prisma.TransactionClient,
) {
  // Sequenciais: queries paralelas na mesma transação não são suportadas pelo pg
  const consultas = await db.consulta.count({
    where: { pacienteId, status: StatusConsulta.AGENDADA },
  });
  const internacoes = await db.internacao.count({
    where: { pacienteId, altaEm: null },
  });
  if (consultas > 0 || internacoes > 0) {
    throw conflict(
      "Há consultas agendadas ou internação em andamento. Cancele as consultas ou aguarde a alta antes de anonimizar.",
    );
  }
}
