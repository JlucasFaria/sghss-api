// Validação e tipagem das variáveis de ambiente: a aplicação não sobe com configuração inválida
import { z } from "zod";
import "./zod";

const envSchema = z
  .object({
    DATABASE_URL: z.url({
      protocol: /^postgres(ql)?$/,
      error: "DATABASE_URL deve ser uma URL postgresql:// válida",
    }),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Origens permitidas no CORS, separadas por vírgula ("*" libera qualquer origem)
    CORS_ORIGIN: z
      .string()
      .default("*")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
  })
  .refine(
    (data) => data.NODE_ENV !== "production" || !data.CORS_ORIGIN.includes("*"),
    {
      path: ["CORS_ORIGIN"],
      message: 'CORS_ORIGIN não pode ser "*" em produção',
    },
  );

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Variáveis de ambiente inválidas:",
    z.flattenError(parsed.error).fieldErrors,
  );
  throw new Error("Variáveis de ambiente inválidas.");
}

export const env = parsed.data;
