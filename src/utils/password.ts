// Hash de senhas com argon2id (resistente a ataques com GPU), via API nativa do Bun
export const hashPassword = (password: string) =>
  Bun.password.hash(password, { algorithm: "argon2id" });

export const verifyPassword = (password: string, hash: string) =>
  Bun.password.verify(password, hash);
