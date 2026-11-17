// Log de acesso: registra cada requisição com requestId, método, rota, status e duração
import { createMiddleware } from "hono/factory";
import { logger } from "../utils/logger";

export const requestLogger = createMiddleware(async (c, next) => {
  const start = performance.now();
  await next();

  logger.info("requisicao", {
    requestId: c.get("requestId"),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Math.round(performance.now() - start),
  });
});
