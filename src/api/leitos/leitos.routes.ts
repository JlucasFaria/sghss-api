// Rotas de leitos: gestão exclusiva do ADMIN (RF27)
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
  atualizarLeitoSchema,
  criarLeitoSchema,
  leitoSchema,
  listarLeitosQuerySchema,
} from "./leitos.schema";
import {
  atualizarLeito,
  criarLeito,
  excluirLeito,
  listarLeitos,
  obterLeito,
} from "./leitos.service";

const base = {
  tags: ["Leitos"],
  security: [{ bearerAuth: [] }],
  middleware: [authenticate, requireRole(Perfil.ADMIN)],
};
const leitoResponse = {
  description: "Leito",
  content: jsonContent(dataResponseSchema(leitoSchema)),
};

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/",
  summary: "Lista os leitos (paginado)",
  description: "Filtra por unidade, status e tipo.",
  request: { query: listarLeitosQuerySchema },
  responses: {
    200: {
      description: "Página de leitos",
      content: jsonContent(paginatedResponseSchema(leitoSchema)),
    },
    ...errorResponses(400, 401, 403),
  },
});

const obterRoute = createRoute({
  ...base,
  method: "get",
  path: "/{id}",
  summary: "Consulta um leito",
  request: { params: idParamSchema },
  responses: { 200: leitoResponse, ...errorResponses(400, 401, 403, 404) },
});

const criarRoute = createRoute({
  ...base,
  method: "post",
  path: "/",
  summary: "Cadastra um leito em uma unidade",
  description:
    "O leito começa LIVRE. O código é único na unidade (409 se repetido).",
  request: {
    body: { required: true, content: jsonContent(criarLeitoSchema) },
  },
  responses: {
    201: { ...leitoResponse, description: "Leito cadastrado" },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const atualizarRoute = createRoute({
  ...base,
  method: "put",
  path: "/{id}",
  summary: "Atualiza um leito ou o coloca em manutenção",
  description:
    "O status manual alterna entre LIVRE e MANUTENCAO; OCUPADO é definido pelas internações. Em leito ocupado, só os dados podem ser alterados; mudar o status responde 409.",
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(atualizarLeitoSchema) },
  },
  responses: {
    200: leitoResponse,
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const excluirRoute = createRoute({
  ...base,
  method: "delete",
  path: "/{id}",
  summary: "Exclui um leito sem histórico",
  description:
    "Só para leitos que nunca tiveram internação (cadastro errado). Com histórico, a resposta é 409 e o leito deve ir para MANUTENCAO.",
  request: { params: idParamSchema },
  responses: {
    204: { description: "Leito excluído" },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

export const leitosRoutes = createRouter()
  .openapi(listarRoute, async (c) => {
    const pagina = await listarLeitos(c.req.valid("query"));
    return c.json(pagina, 200);
  })
  .openapi(obterRoute, async (c) => {
    const leito = await obterLeito(c.req.valid("param").id);
    return c.json({ data: leito }, 200);
  })
  .openapi(criarRoute, async (c) => {
    const leito = await criarLeito(c.req.valid("json"), getAtor(c));
    return c.json({ data: leito }, 201);
  })
  .openapi(atualizarRoute, async (c) => {
    const leito = await atualizarLeito(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: leito }, 200);
  })
  .openapi(excluirRoute, async (c) => {
    await excluirLeito(c.req.valid("param").id, getAtor(c));
    return c.body(null, 204);
  });
