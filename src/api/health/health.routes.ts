// Health check de liveness: indica que a API está no ar
import { Hono } from "hono";

export const healthRoutes = new Hono().get("/", (c) =>
  c.json({ data: { status: "ok", timestamp: new Date().toISOString() } }),
);
