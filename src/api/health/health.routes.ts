// Health check de liveness: indica que a API está no ar
import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "../../utils/openapi";
import { dataResponseSchema } from "../../utils/response";

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

export const healthRoutes = createRouter().openapi(getHealthRoute, (c) =>
  c.json(
    { data: { status: "ok" as const, timestamp: new Date().toISOString() } },
    200,
  ),
);
