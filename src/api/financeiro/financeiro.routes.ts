// Rotas dos lançamentos financeiros: exclusivas do ADMIN (RF31)
import { createRoute } from "@hono/zod-openapi";
import { Perfil } from "../../../generated/prisma/client";
import { authenticate, requireRole } from "../../middlewares/auth";
import { getAtor } from "../../utils/ator";
import { createRouter, errorResponses, jsonContent } from "../../utils/openapi";
import { paginatedResponseSchema } from "../../utils/pagination";
import { dataResponseSchema } from "../../utils/response";
import {
  criarLancamentoSchema,
  lancamentoSchema,
  listarLancamentosQuerySchema,
} from "./financeiro.schema";
import { criarLancamento, listarLancamentos } from "./financeiro.service";

const base = {
  tags: ["Financeiro"],
  security: [{ bearerAuth: [] }],
  middleware: [authenticate, requireRole(Perfil.ADMIN)],
};

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/lancamentos",
  summary: "Lista os lançamentos financeiros (paginado)",
  description:
    "Filtra por unidade, tipo e período de competência (`ate` inclusivo). Valores em texto com 2 casas decimais.",
  request: { query: listarLancamentosQuerySchema },
  responses: {
    200: {
      description: "Página de lançamentos",
      content: jsonContent(paginatedResponseSchema(lancamentoSchema)),
    },
    ...errorResponses(400, 401, 403),
  },
});

const criarRoute = createRoute({
  ...base,
  method: "post",
  path: "/lancamentos",
  summary: "Registra uma receita ou despesa",
  description:
    "Lançamentos não são editados nem excluídos: uma correção é um novo lançamento de sentido contrário (estorno).",
  request: {
    body: { required: true, content: jsonContent(criarLancamentoSchema) },
  },
  responses: {
    201: {
      description: "Lançamento registrado",
      content: jsonContent(dataResponseSchema(lancamentoSchema)),
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

export const financeiroRoutes = createRouter()
  .openapi(listarRoute, async (c) => {
    const pagina = await listarLancamentos(c.req.valid("query"));
    return c.json(pagina, 200);
  })
  .openapi(criarRoute, async (c) => {
    const lancamento = await criarLancamento(c.req.valid("json"), getAtor(c));
    return c.json({ data: lancamento }, 201);
  });
