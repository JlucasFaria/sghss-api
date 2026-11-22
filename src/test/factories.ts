// Factories simples: criam registros válidos com valores padrão sobrescrevíveis
import {
  Conselho,
  Perfil,
  TipoLeito,
  TipoUnidade,
  type Prisma,
} from "../../generated/prisma/client";
import { prisma } from "../db/client";

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
