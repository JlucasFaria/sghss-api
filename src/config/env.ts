// Validação e tipagem das variáveis de ambiente: a aplicação não sobe com configuração inválida
import { z } from "zod";
import "./zod";

const envSchema = z.object({
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: "DATABASE_URL deve ser uma URL postgresql:// válida",
  }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Variáveis de ambiente inválidas:",
    z.flattenError(parsed.error).fieldErrors,
  );
  throw new Error("Variáveis de ambiente inválidas.");
}

export const env = parsed.data;
