// Rotas de unidades: leitura para usuários autenticados, escrita só para o ADMIN
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
  listarUnidadesQuerySchema,
  unidadeBodySchema,
  unidadeSchema,
  unidadeUpdateSchema,
} from "./unidades.schema";
import {
  atualizarUnidade,
  buscarUnidade,
  criarUnidade,
  inativarUnidade,
  listarUnidades,
} from "./unidades.service";

const base = { tags: ["Unidades"], security: [{ bearerAuth: [] }] };
const somenteAdmin = [authenticate, requireRole(Perfil.ADMIN)];
const unidadeResponse = {
  description: "Unidade",
  content: jsonContent(dataResponseSchema(unidadeSchema)),
};

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/",
  summary: "Lista as unidades (paginado)",
  description: "Unidades inativas só são listadas para o ADMIN.",
  middleware: [authenticate],
  request: { query: listarUnidadesQuerySchema },
  responses: {
    200: {
      description: "Página de unidades",
      content: jsonContent(paginatedResponseSchema(unidadeSchema)),
    },
    ...errorResponses(400, 401),
  },
});

const buscarRoute = createRoute({
  ...base,
  method: "get",
  path: "/{id}",
  summary: "Consulta uma unidade",
  middleware: [authenticate],
  request: { params: idParamSchema },
  responses: { 200: unidadeResponse, ...errorResponses(400, 401, 404) },
});

const criarRoute = createRoute({
  ...base,
  method: "post",
  path: "/",
  summary: "Cadastra uma unidade",
  middleware: somenteAdmin,
  request: {
    body: { required: true, content: jsonContent(unidadeBodySchema) },
  },
  responses: {
    201: { ...unidadeResponse, description: "Unidade cadastrada" },
    ...errorResponses(400, 401, 403),
  },
});

const atualizarRoute = createRoute({
  ...base,
  method: "put",
  path: "/{id}",
  summary: "Atualiza (ou reativa) uma unidade",
  middleware: somenteAdmin,
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(unidadeUpdateSchema) },
  },
  responses: {
    200: unidadeResponse,
    ...errorResponses(400, 401, 403, 404),
  },
});

const inativarRoute = createRoute({
  ...base,
  method: "delete",
  path: "/{id}",
  summary: "Inativa uma unidade",
  description: "Inativação lógica: os registros vinculados são preservados.",
  middleware: somenteAdmin,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Unidade inativada" },
    ...errorResponses(400, 401, 403, 404),
  },
});

export const unidadesRoutes = createRouter()
  .openapi(listarRoute, async (c) => {
    const incluirInativas = c.get("usuario").perfil === Perfil.ADMIN;
    const pagina = await listarUnidades(c.req.valid("query"), incluirInativas);
    return c.json(pagina, 200);
  })
  .openapi(buscarRoute, async (c) => {
    const unidade = await buscarUnidade(c.req.valid("param").id);
    return c.json({ data: unidade }, 200);
  })
  .openapi(criarRoute, async (c) => {
    const unidade = await criarUnidade(c.req.valid("json"), getAtor(c));
    return c.json({ data: unidade }, 201);
  })
  .openapi(atualizarRoute, async (c) => {
    const unidade = await atualizarUnidade(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: unidade }, 200);
  })
  .openapi(inativarRoute, async (c) => {
    await inativarUnidade(c.req.valid("param").id, getAtor(c));
    return c.body(null, 204);
  });
