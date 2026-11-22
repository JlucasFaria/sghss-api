// Rotas de notificações do usuário autenticado
import { createRoute } from "@hono/zod-openapi";
import { authenticate } from "../../middlewares/auth";
import {
  createRouter,
  errorResponses,
  idParamSchema,
  jsonContent,
} from "../../utils/openapi";
import { paginatedResponseSchema } from "../../utils/pagination";
import { dataResponseSchema } from "../../utils/response";
import {
  listarNotificacoesQuerySchema,
  notificacaoSchema,
} from "./notificacoes.schema";
import { listarNotificacoes, marcarComoLida } from "./notificacoes.service";

const base = {
  tags: ["Notificações"],
  security: [{ bearerAuth: [] }],
  middleware: [authenticate],
};

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/",
  summary: "Lista as notificações do usuário (paginado)",
  description:
    "Das mais recentes para as mais antigas; `naoLidas=true` filtra as ainda não lidas.",
  request: { query: listarNotificacoesQuerySchema },
  responses: {
    200: {
      description: "Página de notificações",
      content: jsonContent(paginatedResponseSchema(notificacaoSchema)),
    },
    ...errorResponses(400, 401),
  },
});

const marcarLidaRoute = createRoute({
  ...base,
  method: "patch",
  path: "/{id}/leitura",
  summary: "Marca uma notificação como lida",
  description: "Repetir a chamada mantém a data da primeira leitura.",
  request: { params: idParamSchema },
  responses: {
    200: {
      description: "Notificação lida",
      content: jsonContent(dataResponseSchema(notificacaoSchema)),
    },
    ...errorResponses(400, 401, 404),
  },
});

export const notificacoesRoutes = createRouter()
  .openapi(listarRoute, async (c) => {
    const pagina = await listarNotificacoes(
      c.get("usuario").id,
      c.req.valid("query"),
    );
    return c.json(pagina, 200);
  })
  .openapi(marcarLidaRoute, async (c) => {
    const notificacao = await marcarComoLida(
      c.req.valid("param").id,
      c.get("usuario").id,
    );
    return c.json({ data: notificacao }, 200);
  });
