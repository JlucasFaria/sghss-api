// Validação e tipagem das variáveis de ambiente: a aplicação não sobe com configuração inválida
import { z } from "zod";
import "./zod";

// Chave binária informada em base64 e convertida para bytes já na validação
const base64Key = (bytes: number, name: string) =>
  z
    .base64(`${name} deve estar em base64`)
    .transform((value) => Buffer.from(value, "base64"))
    .refine(
      (key) => key.length === bytes,
      `${name} deve ter exatamente ${bytes} bytes`,
    );

// Valores públicos do .env.example (manter em sincronia com aquele arquivo)
const VALORES_DE_EXEMPLO = {
  JWT_SECRET: "troque_por_um_segredo_aleatorio_de_32_caracteres_ou_mais",
  ENCRYPTION_KEY: "Y2hhdmUtYWVzLWRlc2Vudm9sdmltZW50by0zMi1ieXQ=",
  CPF_HASH_KEY: "Y2hhdmUtaG1hYy1kZXNlbnZvbHZpbWVudG8tMzItYnk=",
} as const;

export const envSchema = z
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
    // Segredo HS256: ao menos 32 caracteres (256 bits) para resistir a força bruta
    JWT_SECRET: z
      .string()
      .min(32, "JWT_SECRET deve ter ao menos 32 caracteres"),
    // Validade do token em segundos (curta: não há refresh token)
    JWT_EXPIRES_IN: z.coerce.number().int().positive().default(3600),
    // Chave AES-256-GCM dos dados sensíveis em repouso: 32 bytes em base64
    ENCRYPTION_KEY: base64Key(32, "ENCRYPTION_KEY"),
    // Chave do HMAC usado na busca por CPF, separada da chave de cifra
    CPF_HASH_KEY: base64Key(32, "CPF_HASH_KEY"),
  })
  .refine(
    (data) => data.NODE_ENV !== "production" || !data.CORS_ORIGIN.includes("*"),
    {
      path: ["CORS_ORIGIN"],
      message: 'CORS_ORIGIN não pode ser "*" em produção',
    },
  )
  // Os valores do .env.example são públicos: aceitos só fora de produção
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== "production") return;

    const atuais: Record<keyof typeof VALORES_DE_EXEMPLO, string> = {
      JWT_SECRET: data.JWT_SECRET,
      ENCRYPTION_KEY: data.ENCRYPTION_KEY.toString("base64"),
      CPF_HASH_KEY: data.CPF_HASH_KEY.toString("base64"),
    };

    for (const [nome, exemplo] of Object.entries(VALORES_DE_EXEMPLO)) {
      if (atuais[nome as keyof typeof atuais] === exemplo) {
        ctx.addIssue({
          code: "custom",
          path: [nome],
          message: `${nome} não pode usar o valor de exemplo em produção`,
        });
      }
    }
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
