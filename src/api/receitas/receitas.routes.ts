// Rotas de receitas: emissão em /consultas/{id}/receitas, consulta em /receitas/{id}
// e validação pública pela farmácia em /receitas/validacao
import { createRoute } from "@hono/zod-openapi";
import { Perfil } from "../../../generated/prisma/client";
import { authenticate, requireRole } from "../../middlewares/auth";
import { rateLimit } from "../../middlewares/rate-limit";
import { getAtor } from "../../utils/ator";
import { getClientIp } from "../../utils/client-ip";
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
  validacaoReceitaSchema,
  validarReceitaSchema,
} from "./receitas.schema";
import { emitirReceita, obterReceita } from "./receitas.service";
import { validarReceita } from "./validacao.service";

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

// Rota pública: 30 validações a cada 15 minutos por IP, para impedir tentativas em massa
export const validacaoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  key: (c) => getClientIp(c),
});

const validarRoute = createRoute({
  method: "post",
  path: "/validacao",
  tags: ["Receitas"],
  summary: "Valida a autenticidade de uma receita (farmácia, sem login)",
  description:
    "O código vai no corpo, nunca na URL. A resposta traz só o necessário para a dispensação, com o nome do paciente abreviado.",
  middleware: [validacaoRateLimit],
  request: {
    body: { required: true, content: jsonContent(validarReceitaSchema) },
  },
  responses: {
    200: {
      description: "Receita encontrada (válida ou expirada)",
      content: jsonContent(dataResponseSchema(validacaoReceitaSchema)),
    },
    ...errorResponses(400, 404, 429),
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
export const receitasRoutes = createRouter()
  .openapi(validarRoute, async (c) => {
    const validacao = await validarReceita(
      c.req.valid("json").codigo,
      getClientIp(c),
    );
    return c.json({ data: validacao }, 200);
  })
  .openapi(obterRoute, async (c) => {
    const receita = await obterReceita(c.req.valid("param").id, getAtor(c));
    return c.json({ data: receita }, 200);
  });
