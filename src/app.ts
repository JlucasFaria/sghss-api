// Composição da aplicação: middlewares e rotas (sem subir servidor, para uso nos testes)
import { Hono } from "hono";
import { healthRoutes } from "./api/health/health.routes";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler";

export const app = new Hono();

app.route("/health", healthRoutes);

app.onError(errorHandler);
app.notFound(notFoundHandler);
