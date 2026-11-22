// Factories simples: criam registros válidos com valores padrão sobrescrevíveis
import {
  Conselho,
  Perfil,
  TipoLeito,
  TipoUnidade,
  type Prisma,
} from "../../generated/prisma/client";
import { prisma } from "../db/client";
import { encrypt, hashCpf } from "../utils/crypto";
import { isValidCpf } from "../utils/validators";

// Sufixo único para campos com restrição de unicidade
const unique = () => crypto.randomUUID().slice(0, 8);

export async function criarUnidade(
  data: Partial<Prisma.UnidadeUncheckedCreateInput> = {},
) {
  return prisma.unidade.create({
    data: {
      nome: "Unidade de Teste",
      tipo: TipoUnidade.HOSPITAL,
      endereco: "Rua de Teste, 100",
      cidade: "Curitiba",
      uf: "PR",
      ...data,
    },
  });
}

// Perfil padrão é o de menor privilégio, para que testes de RBAC não passem por engano
export async function criarUsuario(
  data: Partial<Prisma.UsuarioUncheckedCreateInput> = {},
) {
  return prisma.usuario.create({
    data: {
      email: `usuario-${unique()}@teste.example`,
      senhaHash: "hash-de-teste",
      perfil: Perfil.PACIENTE,
      ...data,
    },
  });
}

// Cria o usuário (perfil MEDICO) e a unidade quando não informados
export async function criarProfissional(
  data: Partial<Prisma.ProfissionalUncheckedCreateInput> = {},
) {
  const usuarioId =
    data.usuarioId ?? (await criarUsuario({ perfil: Perfil.MEDICO })).id;
  const unidadeId = data.unidadeId ?? (await criarUnidade()).id;

  return prisma.profissional.create({
    data: {
      nome: "Profissional de Teste",
      conselho: Conselho.CRM,
      registro: `${unique()}-PR`,
      especialidade: "Clínica Médica",
      ...data,
      usuarioId,
      unidadeId,
    },
  });
}

// CPF aleatório válido: sorteia 9 dígitos e procura os 2 verificadores
export function gerarCpf(): string {
  const base = String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
  for (let dv = 0; dv < 100; dv++) {
    const cpf = base + String(dv).padStart(2, "0");
    if (isValidCpf(cpf)) return cpf;
  }
  return gerarCpf(); // base inválida (ex.: dígitos repetidos)
}

// Recebe o CPF em claro e grava cifrado + hash, como o serviço fará
export async function criarPaciente({
  cpf = gerarCpf(),
  ...data
}: Partial<Prisma.PacienteUncheckedCreateInput> & { cpf?: string } = {}) {
  const usuarioId = data.usuarioId ?? (await criarUsuario()).id;

  return prisma.paciente.create({
    data: {
      nome: "Paciente de Teste",
      cpfCifrado: encrypt(cpf),
      cpfHash: hashCpf(cpf),
      dataNascimento: new Date("1990-01-01"),
      ...data,
      usuarioId,
    },
  });
}

export async function criarLeito(
  data: Partial<Prisma.LeitoUncheckedCreateInput> = {},
) {
  const unidadeId = data.unidadeId ?? (await criarUnidade()).id;

  return prisma.leito.create({
    data: {
      codigo: `L-${unique()}`,
      ala: "Clínica Médica",
      tipo: TipoLeito.ENFERMARIA,
      ...data,
      unidadeId,
    },
  });
}

// Horário futuro de 30 minutos; cria o profissional quando não informado
export async function criarHorario(
  data: Partial<Prisma.HorarioAgendaUncheckedCreateInput> = {},
) {
  const profissionalId = data.profissionalId ?? (await criarProfissional()).id;
  const inicio = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return prisma.horarioAgenda.create({
    data: {
      inicio,
      fim: new Date(inicio.getTime() + 30 * 60 * 1000),
      ...data,
      profissionalId,
    },
  });
}

// Consulta presencial agendada; usa a unidade do profissional do horário.
// Como no sistema real, o horário fica RESERVADO (ou DISPONIVEL se cancelada).
export async function criarConsulta(
  data: Partial<Prisma.ConsultaUncheckedCreateInput> = {},
) {
  const pacienteId = data.pacienteId ?? (await criarPaciente()).id;
  const statusHorario =
    data.status === "CANCELADA" ? "DISPONIVEL" : "RESERVADO";
  const horario = data.horarioId
    ? await prisma.horarioAgenda.update({
        where: { id: data.horarioId },
        data: { status: statusHorario },
      })
    : await criarHorario({ status: statusHorario });
  const { unidadeId } = await prisma.profissional.findUniqueOrThrow({
    where: { id: horario.profissionalId },
  });

  return prisma.consulta.create({
    data: {
      modalidade: "PRESENCIAL",
      unidadeId,
      ...data,
      pacienteId,
      horarioId: horario.id,
    },
  });
}

export async function criarExame(
  data: Partial<Prisma.ExameUncheckedCreateInput> = {},
) {
  const pacienteId = data.pacienteId ?? (await criarPaciente()).id;
  const unidadeId = data.unidadeId ?? (await criarUnidade()).id;

  return prisma.exame.create({
    data: {
      tipo: "Hemograma",
      dataHora: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...data,
      pacienteId,
      unidadeId,
    },
  });
}
