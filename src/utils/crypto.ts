// Criptografia (RNF01): AES-256-GCM para dados em repouso, HMAC para busca por CPF
// e código de verificação de receitas com hash SHA-256
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} from "node:crypto";
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
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Valor cifrado em formato inválido.");
  }

  const [iv, authTag, ciphertext] = parts.map((part) =>
    Buffer.from(part, "base64"),
  ) as [Buffer, Buffer, Buffer];

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

// Código de verificação da receita: 256 bits de um gerador criptográfico, em
// base64url (43 caracteres, cabe em QR code). Não deriva de dados da receita.
export const gerarCodigoVerificacao = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

// SHA-256 em hex (64 caracteres). Sem sal: o código já é aleatório e longo demais
// para força bruta, e o hash determinístico permite localizar a receita.
export const hashSha256 = (valor: string): string =>
  createHash("sha256").update(valor).digest("hex");
