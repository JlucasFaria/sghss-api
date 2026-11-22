// Seed com dados fictícios para desenvolvimento. Idempotente: pode ser executado várias vezes.
import {
  Conselho,
  Perfil,
  TipoLeito,
  TipoUnidade,
} from "../generated/prisma/client";
import { env } from "../src/config/env";
import { prisma } from "../src/db/client";
import { hashPassword } from "../src/utils/password";

// Senha comum a todos os usuários do seed (apenas desenvolvimento)
const SENHA_PADRAO = "Vidaplus@2026";

// IDs fixos tornam o seed idempotente, já que unidade não tem outro campo único
const unidades = [
  {
    id: "7f3c1a52-4b8e-4d1a-9c6f-0a1b2c3d4e01",
    nome: "Hospital VidaPlus Centro",
    tipo: TipoUnidade.HOSPITAL,
    endereco: "Av. Central, 1000",
    cidade: "Curitiba",
    uf: "PR",
  },
  {
    id: "7f3c1a52-4b8e-4d1a-9c6f-0a1b2c3d4e02",
    nome: "Clínica VidaPlus Norte",
    tipo: TipoUnidade.CLINICA,
    endereco: "Rua das Flores, 250",
    cidade: "Curitiba",
    uf: "PR",
  },
] as const;

const [hospital, clinica] = unidades;

const profissionais = [
  {
    email: "ana.souza@vidaplus.example",
    perfil: Perfil.MEDICO,
    nome: "Dra. Ana Souza",
    conselho: Conselho.CRM,
    registro: "123456-PR",
    especialidade: "Cardiologia",
    unidadeId: hospital.id,
  },
  {
    email: "carlos.lima@vidaplus.example",
    perfil: Perfil.MEDICO,
    nome: "Dr. Carlos Lima",
    conselho: Conselho.CRM,
    registro: "654321-PR",
    especialidade: "Clínica Médica",
    unidadeId: clinica.id,
  },
  {
    email: "beatriz.rocha@vidaplus.example",
    perfil: Perfil.ENFERMEIRO,
    nome: "Beatriz Rocha",
    conselho: Conselho.COREN,
    registro: "987654-PR",
    especialidade: null,
    unidadeId: hospital.id,
  },
];

const leitos = [
  { codigo: "ENF-101", ala: "Clínica Médica", tipo: TipoLeito.ENFERMARIA },
  { codigo: "ENF-102", ala: "Clínica Médica", tipo: TipoLeito.ENFERMARIA },
  { codigo: "APT-201", ala: "Cirúrgica", tipo: TipoLeito.APARTAMENTO },
  { codigo: "UTI-01", ala: "UTI Adulto", tipo: TipoLeito.UTI },
].map((leito) => ({ ...leito, unidadeId: hospital.id }));

async function main() {
  if (env.NODE_ENV === "production") {
    throw new Error("O seed não pode ser executado em produção.");
  }

  const senhaHash = await hashPassword(SENHA_PADRAO);

  for (const unidade of unidades) {
    await prisma.unidade.upsert({
      where: { id: unidade.id },
      update: {},
      create: unidade,
    });
  }

  await prisma.usuario.upsert({
    where: { email: "admin@vidaplus.example" },
    update: {},
    create: {
      email: "admin@vidaplus.example",
      senhaHash,
      perfil: Perfil.ADMIN,
    },
  });

  for (const { email, perfil, ...profissional } of profissionais) {
    const usuario = await prisma.usuario.upsert({
      where: { email },
      update: {},
      create: { email, senhaHash, perfil },
    });

    await prisma.profissional.upsert({
      where: { usuarioId: usuario.id },
      update: {},
      create: { ...profissional, usuarioId: usuario.id },
    });
  }

  for (const leito of leitos) {
    await prisma.leito.upsert({
      where: {
        unidadeId_codigo: { unidadeId: leito.unidadeId, codigo: leito.codigo },
      },
      update: {},
      create: leito,
    });
  }

  console.log(`Seed concluído. Senha de todos os usuários: ${SENHA_PADRAO}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
