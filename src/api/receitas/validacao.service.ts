// Validação pública da receita pela farmácia (RF17): sem login, pelo código de
// verificação. Cada tentativa vai para a trilha de auditoria, com o IP.
import { prisma } from "../../db/client";
import { notFound } from "../../utils/app-error";
import { hashSha256 } from "../../utils/crypto";
import { dataDeHoje } from "../../utils/datas";
import {
  AcaoAuditoria,
  registrarAuditoria,
} from "../auditoria/auditoria.service";
import type { ValidacaoReceita } from "./receitas.schema";
import { selecaoReceita } from "./receitas.service";

// "Ana Paula Ribeiro" → "Ana P. R.": basta para conferir com o papel
export const abreviarNome = (nome: string) => {
  const [primeiro = "", ...demais] = nome.trim().split(/\s+/);
  return [primeiro, ...demais.map((parte) => `${parte[0]}.`)].join(" ");
};

export async function validarReceita(
  codigo: string,
  ip: string,
): Promise<ValidacaoReceita> {
  const receita = await prisma.prescricao.findUnique({
    where: { codigoVerificacaoHash: hashSha256(codigo) },
    select: selecaoReceita,
  });

  await registrarAuditoria({
    acao: AcaoAuditoria.RECEITA_VALIDADA,
    entidade: "prescricao",
    entidadeId: receita?.id,
    ip,
    detalhes: { encontrada: receita !== null },
  });

  if (!receita) throw notFound("Receita não encontrada.");

  const { conselho, nome, registro } = receita.consulta.horario.profissional;
  const hoje = dataDeHoje();
  const validaAte = receita.validaAte.toISOString().slice(0, 10);

  return {
    situacao: validaAte >= hoje ? "VALIDA" : "EXPIRADA",
    emitidaEm: receita.emitidaEm,
    validaAte,
    itens: receita.itens,
    medico: { nome, conselho, registro },
    paciente: { nome: abreviarNome(receita.consulta.paciente.nome) },
  };
}
