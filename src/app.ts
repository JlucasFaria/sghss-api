// Composição da aplicação: middlewares, rotas e documentação (sem subir servidor, para uso nos testes)
import { swaggerUI } from "@hono/swagger-ui";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { agendaRoutes } from "./api/agenda/agenda.routes";
import { auditoriaRoutes } from "./api/auditoria/auditoria.routes";
import { authRoutes } from "./api/auth/auth.routes";
import { consultasRoutes } from "./api/consultas/consultas.routes";
import { examesRoutes } from "./api/exames/exames.routes";
import { notificacoesRoutes } from "./api/notificacoes/notificacoes.routes";
import { healthRoutes } from "./api/health/health.routes";
import { lgpdRoutes } from "./api/lgpd/lgpd.routes";
import { pacientesRoutes } from "./api/pacientes/pacientes.routes";
import { prontuarioRoutes } from "./api/prontuario/prontuario.routes";
import {
  emissaoReceitaRoutes,
  receitasRoutes,
} from "./api/receitas/receitas.routes";
import { telemedicinaRoutes } from "./api/telemedicina/telemedicina.routes";
import { profissionaisRoutes } from "./api/profissionais/profissionais.routes";
import { unidadesRoutes } from "./api/unidades/unidades.routes";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler";
import { requestLogger } from "./middlewares/request-logger";
import { createRouter } from "./utils/openapi";

// Limite do corpo das requisições: suficiente para os payloads JSON da API
export const BODY_LIMIT_BYTES = 1024 * 1024;

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
// Sem onError próprio o bodyLimit lança HTTPException 413, tratada no error handler
app.use(bodyLimit({ maxSize: BODY_LIMIT_BYTES }));

app.route("/health", healthRoutes);
app.route("/auth", authRoutes);
app.route("/unidades", unidadesRoutes);
app.route("/profissionais", profissionaisRoutes);
app.route("/profissionais", agendaRoutes);
app.route("/pacientes", pacientesRoutes);
app.route("/pacientes", lgpdRoutes);
app.route("/consultas", consultasRoutes);
app.route("/consultas", prontuarioRoutes);
app.route("/consultas", emissaoReceitaRoutes);
app.route("/consultas", telemedicinaRoutes);
app.route("/receitas", receitasRoutes);
app.route("/exames", examesRoutes);
app.route("/notificacoes", notificacoesRoutes);
app.route("/auditoria", auditoriaRoutes);

// Esquema de segurança referenciado pelas rotas protegidas (botão "Authorize" do Swagger)
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});
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
