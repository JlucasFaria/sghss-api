// Fábrica de roteadores OpenAPI: falhas de validação seguem para o error handler global
import { OpenAPIHono } from "@hono/zod-openapi";

export const createRouter = () =>
  new OpenAPIHono({
    defaultHook: (result) => {
      if (!result.success) throw result.error;
    },
  });
