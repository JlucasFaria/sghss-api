// Ponto de entrada: sobe o servidor HTTP com a aplicação
import { env } from "./config/env";
import { app } from "./app";
import { iniciarRotinaDeLembretes } from "./api/notificacoes/lembretes.job";

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

console.log(`SGHSS API rodando em ${server.url}`);

// Lembretes das consultas das próximas 24 horas (RF20)
iniciarRotinaDeLembretes();
