// Helpers de banco para os testes de integração
import { env } from "../config/env";
import { prisma } from "../db/client";

// Trava de segurança: o reset só roda em bancos cujo nome termina em "_test"
function assertTestDatabase() {
  const database = new URL(env.DATABASE_URL).pathname.slice(1);

  if (!database.endsWith("_test")) {
    throw new Error(
      `resetDatabase recusado: "${database}" não é um banco de testes (*_test).`,
    );
  }
}

// Esvazia todas as tabelas do domínio, preservando o histórico de migrations
export async function resetDatabase() {
  assertTestDatabase();

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables.map(({ tablename }) => `"${tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}
