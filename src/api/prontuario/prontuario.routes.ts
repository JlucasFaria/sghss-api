// Rotas do prontuário, montadas em /consultas/{id}
import { createRoute, z } from "@hono/zod-openapi";
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
import { evolucaoSchema, registrarEvolucaoSchema } from "./prontuario.schema";
import {
  concluirConsulta,
  listarEvolucoes,
  registrarEvolucao,
} from "./prontuario.service";

const base = { tags: ["Prontuário"], security: [{ bearerAuth: [] }] };
const profissionais = [Perfil.MEDICO, Perfil.ENFERMEIRO, Perfil.TECNICO];

const registrarRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/prontuario",
  summary: "Registra uma evolução no prontuário da consulta",
  description:
    "O profissional da consulta e os lotados na unidade dela, a partir do início do atendimento. O conteúdo é gravado cifrado; correções viram um novo registro.",
  middleware: [authenticate, requireRole(...profissionais)],
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(registrarEvolucaoSchema) },
  },
  responses: {
    201: {
      description: "Evolução registrada",
      content: jsonContent(dataResponseSchema(evolucaoSchema)),
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/{id}/prontuario",
  summary: "Lista as evoluções do prontuário da consulta",
  description:
    "O paciente lê o próprio prontuário; o profissional da consulta e os da unidade também (acesso auditado). O ADMIN não acessa dados clínicos.",
  middleware: [authenticate, requireRole(Perfil.PACIENTE, ...profissionais)],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: "Evoluções em ordem cronológica",
      content: jsonContent(dataResponseSchema(z.array(evolucaoSchema))),
    },
    ...errorResponses(400, 401, 403, 404),
  },
});

const concluirRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/conclusao",
  summary: "Conclui o atendimento (consulta REALIZADA)",
  description:
    "Só o profissional da consulta, depois do início e com ao menos uma evolução registrada.",
  middleware: [authenticate, requireRole(...profissionais)],
  request: { params: idParamSchema },
  responses: {
    204: { description: "Atendimento concluído" },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

export const prontuarioRoutes = createRouter()
  .openapi(registrarRoute, async (c) => {
    const evolucao = await registrarEvolucao(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: evolucao }, 201);
  })
  .openapi(listarRoute, async (c) => {
    const evolucoes = await listarEvolucoes(
      c.req.valid("param").id,
      getAtor(c),
    );
    return c.json({ data: evolucoes }, 200);
  })
  .openapi(concluirRoute, async (c) => {
    await concluirConsulta(c.req.valid("param").id, getAtor(c));
    return c.body(null, 204);
  });
