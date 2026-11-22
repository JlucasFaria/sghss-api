// Rotas da trilha de auditoria: somente leitura, exclusiva do ADMIN (RF23, RNF05)
import { createRoute } from "@hono/zod-openapi";
import { Perfil } from "../../../generated/prisma/client";
import { authenticate, requireRole } from "../../middlewares/auth";
import { getAtor } from "../../utils/ator";
import { createRouter, errorResponses, jsonContent } from "../../utils/openapi";
import { paginatedResponseSchema } from "../../utils/pagination";
import {
  listarAuditoriaQuerySchema,
  logAuditoriaSchema,
} from "./auditoria.schema";
import { listarLogs } from "./auditoria.service";

const listarRoute = createRoute({
  tags: ["Auditoria"],
  security: [{ bearerAuth: [] }],
  method: "get",
  path: "/",
  summary: "Consulta a trilha de auditoria (paginado)",
  description:
    "Filtra por usuário, ação e período (datas no horário de Brasília, `ate` inclusivo). Os registros mais recentes vêm primeiro.",
  middleware: [authenticate, requireRole(Perfil.ADMIN)],
  request: { query: listarAuditoriaQuerySchema },
  responses: {
    200: {
      description: "Página de registros de auditoria",
      content: jsonContent(paginatedResponseSchema(logAuditoriaSchema)),
    },
    ...errorResponses(400, 401, 403),
  },
});

export const auditoriaRoutes = createRouter().openapi(
  listarRoute,
  async (c) => {
    const pagina = await listarLogs(c.req.valid("query"), getAtor(c));
    return c.json(pagina, 200);
  },
);
