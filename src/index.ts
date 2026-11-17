// Ponto de entrada: sobe o servidor HTTP com a aplicação
import { env } from "./config/env";
import { app } from "./app";

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

console.log(`SGHSS API rodando em ${server.url}`);
