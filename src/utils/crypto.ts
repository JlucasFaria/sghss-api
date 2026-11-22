// Criptografia dos dados sensíveis em repouso (RNF01): AES-256-GCM e HMAC-SHA-256
import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

// Formato gravado: iv.authTag.ciphertext (base64). O IV aleatório faz o mesmo
// texto gerar cifras diferentes; a tag do GCM detecta qualquer adulteração.
export const encrypt = (plaintext: string): string => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = createCipheriv(ALGORITHM, env.ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => Buffer.from(part).toString("base64"))
    .join(".");
};

export const decrypt = (payload: string): string => {
  const [iv, authTag, ciphertext] = payload
    .split(".")
    .map((part) => Buffer.from(part, "base64"));

  if (!iv || !authTag || !ciphertext) {
    throw new Error("Valor cifrado em formato inválido.");
  }

  const decipher = createDecipheriv(ALGORITHM, env.ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
};

// Hash determinístico (HMAC hex, 64 caracteres) para buscar e garantir unicidade
// do CPF sem decifrar a tabela; sem a chave, não é possível testar CPFs por força bruta.
// Recebe o CPF já normalizado (só dígitos), como sai do cpfSchema.
export const hashCpf = (cpf: string): string =>
  createHmac("sha256", env.CPF_HASH_KEY).update(cpf).digest("hex");
