// Ponto de entrada: sobe o servidor HTTP com a aplicação
import { app } from "./app";

const server = Bun.serve({
  port: Number(process.env["PORT"] ?? 3000),
  fetch: app.fetch,
});

console.log(`SGHSS API rodando em ${server.url}`);
