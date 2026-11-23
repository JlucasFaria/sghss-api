// Backup do banco (RNF08): pg_dump dentro do container do PostgreSQL, gravado em
// backups/ no formato custom (compactado, restaurável com pg_restore), e remoção dos
// backups mais antigos que a retenção. Guarde as cópias fora do servidor e longe das
// chaves de criptografia (veja o README).
// Execução: bun run db:backup. Agende uma execução diária (cron ou Agendador de Tarefas).
import { chmod, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const PASTA = process.env.BACKUP_DIR ?? "backups";
const RETENCAO_DIAS = Number(process.env.BACKUP_RETENCAO_DIAS ?? 7);
const USUARIO = process.env.POSTGRES_USER;
const BANCO = process.env.POSTGRES_DB;

if (!USUARIO || !BANCO) {
  console.error("Defina POSTGRES_USER e POSTGRES_DB (veja o .env.example).");
  process.exit(1);
}
if (!Number.isInteger(RETENCAO_DIAS) || RETENCAO_DIAS < 1) {
  console.error(
    "BACKUP_RETENCAO_DIAS deve ser um número inteiro de dias (>= 1).",
  );
  process.exit(1);
}

await mkdir(PASTA, { recursive: true });

// Ex.: sghss-2026-11-22T23-59-00.dump (sem ":" para valer também no Windows)
const carimbo = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
const arquivo = join(PASTA, `${BANCO}-${carimbo}.dump`);

const dump = Bun.spawn(
  [
    "docker",
    "compose",
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "--format=custom",
    "--username",
    USUARIO,
    BANCO,
  ],
  { stdout: Bun.file(arquivo), stderr: "inherit" },
);

if ((await dump.exited) !== 0) {
  // Não deixa um arquivo parcial passar por backup válido
  await unlink(arquivo).catch(() => {});
  console.error("Falha no pg_dump: o backup não foi gravado.");
  process.exit(1);
}

// O dump tem dados pessoais (nome, e-mail, consultas, auditoria): só o dono do
// arquivo lê. Os campos sensíveis já estão cifrados no banco. Sem efeito no Windows.
await chmod(arquivo, 0o600);

const { size } = await stat(arquivo);
console.log(`Backup gravado: ${arquivo} (${(size / 1024).toFixed(1)} KB)`);

// Retenção: apaga os backups deste banco mais antigos que o limite
const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
for (const nome of await readdir(PASTA)) {
  if (!nome.startsWith(`${BANCO}-`) || !nome.endsWith(".dump")) continue;
  const caminho = join(PASTA, nome);
  if ((await stat(caminho)).mtimeMs < limite) {
    await unlink(caminho);
    console.log(`Removido pela retenção de ${RETENCAO_DIAS} dias: ${caminho}`);
  }
}
