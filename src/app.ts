// Composição da aplicação: middlewares, rotas e documentação (sem subir servidor, para uso nos testes)
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { healthRoutes } from "./api/health/health.routes";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler";
import { requestLogger } from "./middlewares/request-logger";
import { createRouter } from "./utils/openapi";

export const app = createRouter();

app.use(requestId());
app.use(requestLogger);
app.use(secureHeaders());
app.use(
  cors({
    origin: env.CORS_ORIGIN.includes("*") ? "*" : env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-Request-Id"],
    maxAge: 600,
  }),
);

app.route("/health", healthRoutes);

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "SGHSS VidaPlus API",
    version: "0.1.0",
    description:
      "API REST do Sistema de Gestão Hospitalar e de Serviços de Saúde da VidaPlus.",
  },
});
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

app.onError(errorHandler);
app.notFound(notFoundHandler);
