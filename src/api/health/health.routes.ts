// Health checks (RNF08): liveness (/health, o processo responde) e readiness
// (/health/ready, a API alcança o banco), usados por monitores e orquestradores
import { createRoute, z } from "@hono/zod-openapi";
import { createRouter, errorResponses } from "../../utils/openapi";
import { dataResponseSchema } from "../../utils/response";
import { verificarBanco } from "./health.service";

const healthSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.iso.datetime().openapi({ example: "2026-01-01T12:00:00.000Z" }),
});

const getHealthRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Health"],
  summary: "Verifica se a API está no ar",
  responses: {
    200: {
      description: "API disponível",
      content: {
        "application/json": { schema: dataResponseSchema(healthSchema) },
      },
    },
  },
});

const readinessSchema = healthSchema.extend({ banco: z.literal("ok") });

const getReadyRoute = createRoute({
  method: "get",
  path: "/ready",
  tags: ["Health"],
  summary: "Verifica se a API está pronta para atender (banco acessível)",
  description:
    "Executa uma consulta mínima no banco, com tempo limite de 2 s. Responde 503 se o banco estiver fora do ar. Indicado para monitoramento de disponibilidade.",
  responses: {
    200: {
      description: "API pronta",
      content: {
        "application/json": { schema: dataResponseSchema(readinessSchema) },
      },
    },
    ...errorResponses(503),
  },
});

const agora = () => new Date().toISOString();

export const healthRoutes = createRouter()
  .openapi(getHealthRoute, (c) =>
    c.json({ data: { status: "ok" as const, timestamp: agora() } }, 200),
  )
  .openapi(getReadyRoute, async (c) => {
    await verificarBanco();
    return c.json(
      {
        data: {
          status: "ok" as const,
          banco: "ok" as const,
          timestamp: agora(),
        },
      },
      200,
    );
  });
