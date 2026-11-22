// Rotas de profissionais: leitura para usuários autenticados, gestão só para o ADMIN
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
  atualizarProfissionalSchema,
  criarProfissionalSchema,
  listarProfissionaisQuerySchema,
  profissionalSchema,
} from "./profissionais.schema";
import {
  atualizarProfissional,
  buscarProfissional,
  criarProfissional,
  inativarProfissional,
  listarProfissionais,
} from "./profissionais.service";

const base = { tags: ["Profissionais"], security: [{ bearerAuth: [] }] };
const somenteAdmin = [authenticate, requireRole(Perfil.ADMIN)];
const profissionalResponse = {
  description: "Profissional",
  content: jsonContent(dataResponseSchema(profissionalSchema)),
};

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/",
  summary: "Lista os profissionais (paginado)",
  description:
    "Filtra por unidade e especialidade. Inativos e e-mail só aparecem para o ADMIN.",
  middleware: [authenticate],
  request: { query: listarProfissionaisQuerySchema },
  responses: {
    200: {
      description: "Página de profissionais",
      content: jsonContent(paginatedResponseSchema(profissionalSchema)),
    },
    ...errorResponses(400, 401),
  },
});

const buscarRoute = createRoute({
  ...base,
  method: "get",
  path: "/{id}",
  summary: "Consulta um profissional",
  middleware: [authenticate],
  request: { params: idParamSchema },
  responses: { 200: profissionalResponse, ...errorResponses(400, 401, 404) },
});

const criarRoute = createRoute({
  ...base,
  method: "post",
  path: "/",
  summary: "Cadastra um profissional com seu usuário de acesso",
  description:
    "O perfil define o conselho exigido: MEDICO usa CRM; ENFERMEIRO e TECNICO usam COREN.",
  middleware: somenteAdmin,
  request: {
    body: { required: true, content: jsonContent(criarProfissionalSchema) },
  },
  responses: {
    201: { ...profissionalResponse, description: "Profissional cadastrado" },
    ...errorResponses(400, 401, 403, 409),
  },
});

const atualizarRoute = createRoute({
  ...base,
  method: "put",
  path: "/{id}",
  summary: "Atualiza (ou reativa) um profissional",
  middleware: somenteAdmin,
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(atualizarProfissionalSchema) },
  },
  responses: {
    200: profissionalResponse,
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const inativarRoute = createRoute({
  ...base,
  method: "delete",
  path: "/{id}",
  summary: "Inativa um profissional",
  description:
    "Bloqueia o acesso do profissional na hora; o histórico clínico é preservado.",
  middleware: somenteAdmin,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Profissional inativado" },
    ...errorResponses(400, 401, 403, 404),
  },
});

export const profissionaisRoutes = createRouter()
  .openapi(listarRoute, async (c) => {
    const admin = c.get("usuario").perfil === Perfil.ADMIN;
    const pagina = await listarProfissionais(c.req.valid("query"), admin);
    return c.json(pagina, 200);
  })
  .openapi(buscarRoute, async (c) => {
    const admin = c.get("usuario").perfil === Perfil.ADMIN;
    const profissional = await buscarProfissional(
      c.req.valid("param").id,
      admin,
    );
    return c.json({ data: profissional }, 200);
  })
  .openapi(criarRoute, async (c) => {
    const profissional = await criarProfissional(
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: profissional }, 201);
  })
  .openapi(atualizarRoute, async (c) => {
    const profissional = await atualizarProfissional(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: profissional }, 200);
  })
  .openapi(inativarRoute, async (c) => {
    await inativarProfissional(c.req.valid("param").id, getAtor(c));
    return c.body(null, 204);
  });
