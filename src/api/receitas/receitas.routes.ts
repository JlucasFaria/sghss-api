// Rotas de receitas: emissão em /consultas/{id}/receitas e consulta em /receitas/{id}
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
import { dataResponseSchema } from "../../utils/response";
import {
  emitirReceitaSchema,
  receitaEmitidaSchema,
  receitaSchema,
} from "./receitas.schema";
import { emitirReceita, obterReceita } from "./receitas.service";

const base = { tags: ["Receitas"], security: [{ bearerAuth: [] }] };

const emitirRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/receitas",
  summary: "Emite a receita digital da consulta",
  description:
    "Só o médico da consulta, depois do início do atendimento. A resposta traz o código de verificação, exibido uma única vez.",
  middleware: [authenticate, requireRole(Perfil.MEDICO)],
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(emitirReceitaSchema) },
  },
  responses: {
    201: {
      description: "Receita emitida",
      content: jsonContent(dataResponseSchema(receitaEmitidaSchema)),
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const obterRoute = createRoute({
  ...base,
  method: "get",
  path: "/{id}",
  summary: "Consulta uma receita",
  description:
    "Para o paciente, o profissional da consulta e os da unidade. O código de verificação não é exibido.",
  middleware: [
    authenticate,
    requireRole(
      Perfil.PACIENTE,
      Perfil.MEDICO,
      Perfil.ENFERMEIRO,
      Perfil.TECNICO,
    ),
  ],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: "Receita",
      content: jsonContent(dataResponseSchema(receitaSchema)),
    },
    ...errorResponses(400, 401, 403, 404),
  },
});

// Montado em /consultas
export const emissaoReceitaRoutes = createRouter().openapi(
  emitirRoute,
  async (c) => {
    const receita = await emitirReceita(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: receita }, 201);
  },
);

// Montado em /receitas
export const receitasRoutes = createRouter().openapi(obterRoute, async (c) => {
  const receita = await obterReceita(c.req.valid("param").id, getAtor(c));
  return c.json({ data: receita }, 200);
});
