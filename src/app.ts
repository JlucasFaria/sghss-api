// Composição da aplicação: middlewares e rotas (sem subir servidor, para uso nos testes)
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { healthRoutes } from "./api/health/health.routes";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler";
import { requestLogger } from "./middlewares/request-logger";

export const app = new Hono();

app.use(requestId());
app.use(requestLogger);

app.route("/health", healthRoutes);

app.onError(errorHandler);
app.notFound(notFoundHandler);
