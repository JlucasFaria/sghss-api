// Rotas de suprimentos e estoque: exclusivas do ADMIN (RF30)
import { createRoute } from "@hono/zod-openapi";
import { Perfil } from "../../../generated/prisma/client";
import { authenticate, requireRole } from "../../middlewares/auth";
import { getAtor } from "../../utils/ator";
import {
  createRouter,
  errorResponses,
  idParamSchema,
  jsonContent,
} from "../../utils/openapi";
import { paginatedResponseSchema } from "../../utils/pagination";
import { dataResponseSchema } from "../../utils/response";
import {
  criarSuprimentoSchema,
  listarSuprimentosQuerySchema,
  movimentacaoResponseSchema,
  movimentacaoSchema,
  suprimentoSchema,
} from "./suprimentos.schema";
import {
  criarSuprimento,
  listarSuprimentos,
  movimentarEstoque,
} from "./suprimentos.service";

const base = {
  tags: ["Suprimentos"],
  security: [{ bearerAuth: [] }],
  middleware: [authenticate, requireRole(Perfil.ADMIN)],
};

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/",
  summary: "Lista os suprimentos (paginado)",
  description:
    "Cada item traz `estoqueBaixo` (saldo igual ou abaixo do mínimo); `estoqueBaixo=true` lista só os itens em alerta.",
  request: { query: listarSuprimentosQuerySchema },
  responses: {
    200: {
      description: "Página de suprimentos",
      content: jsonContent(paginatedResponseSchema(suprimentoSchema)),
    },
    ...errorResponses(400, 401, 403),
  },
});

const criarRoute = createRoute({
  ...base,
  method: "post",
  path: "/",
  summary: "Cadastra um suprimento em uma unidade",
  description: "O saldo começa em zero e só muda por movimentações.",
  request: {
    body: { required: true, content: jsonContent(criarSuprimentoSchema) },
  },
  responses: {
    201: {
      description: "Suprimento cadastrado",
      content: jsonContent(dataResponseSchema(suprimentoSchema)),
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const movimentarRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/movimentacoes",
  summary: "Registra uma entrada ou saída de estoque",
  description:
    "Saída maior que o saldo é recusada (409). A resposta traz o saldo atualizado e o alerta de estoque baixo.",
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(movimentacaoSchema) },
  },
  responses: {
    201: {
      description: "Movimentação registrada",
      content: jsonContent(dataResponseSchema(movimentacaoResponseSchema)),
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

export const suprimentosRoutes = createRouter()
  .openapi(listarRoute, async (c) => {
    const pagina = await listarSuprimentos(c.req.valid("query"));
    return c.json(pagina, 200);
  })
  .openapi(criarRoute, async (c) => {
    const suprimento = await criarSuprimento(c.req.valid("json"), getAtor(c));
    return c.json({ data: suprimento }, 201);
  })
  .openapi(movimentarRoute, async (c) => {
    const resultado = await movimentarEstoque(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: resultado }, 201);
  });
