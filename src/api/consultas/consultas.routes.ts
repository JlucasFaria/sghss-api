// Rotas de consultas: agendamento, cancelamento, reagendamento e listagem
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
  agendarConsultaSchema,
  cancelarConsultaSchema,
  consultaSchema,
  listarConsultasQuerySchema,
  reagendarConsultaSchema,
} from "./consultas.schema";
import {
  agendarConsulta,
  cancelarConsulta,
  listarConsultas,
  obterConsulta,
  reagendarConsulta,
} from "./consultas.service";

const base = { tags: ["Consultas"], security: [{ bearerAuth: [] }] };
const consultaResponse = {
  description: "Consulta",
  content: jsonContent(dataResponseSchema(consultaSchema)),
};

const agendarRoute = createRoute({
  ...base,
  method: "post",
  path: "/",
  summary: "Agenda uma consulta presencial ou teleconsulta",
  description:
    "O paciente escolhe um horário livre de um profissional ativo. O horário fica reservado e o paciente não pode ter outra consulta no mesmo período.",
  middleware: [authenticate, requireRole(Perfil.PACIENTE)],
  request: {
    body: { required: true, content: jsonContent(agendarConsultaSchema) },
  },
  responses: {
    201: { ...consultaResponse, description: "Consulta agendada" },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const cancelarRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/cancelamento",
  summary: "Cancela uma consulta agendada",
  description:
    "O paciente cancela com pelo menos 24 horas de antecedência; o profissional da consulta e o ADMIN, a qualquer momento. O horário volta para a agenda.",
  middleware: [authenticate],
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(cancelarConsultaSchema) },
  },
  responses: {
    200: { ...consultaResponse, description: "Consulta cancelada" },
    ...errorResponses(400, 401, 404, 409),
  },
});

const reagendarRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/reagendamento",
  summary: "Move a consulta para outro horário do mesmo profissional",
  description:
    "Mesmo prazo do cancelamento. O novo horário é reservado e o antigo volta para a agenda.",
  middleware: [authenticate],
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(reagendarConsultaSchema) },
  },
  responses: {
    200: { ...consultaResponse, description: "Consulta reagendada" },
    ...errorResponses(400, 401, 404, 409),
  },
});

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/",
  summary: "Lista consultas (paginado), com filtros de status e período",
  description:
    "O paciente vê as próprias consultas e o profissional as da sua agenda. O ADMIN vê todas, sem o motivo (texto clínico).",
  middleware: [authenticate],
  request: { query: listarConsultasQuerySchema },
  responses: {
    200: {
      description: "Página de consultas",
      content: jsonContent(paginatedResponseSchema(consultaSchema)),
    },
    ...errorResponses(400, 401),
  },
});

const obterRoute = createRoute({
  ...base,
  method: "get",
  path: "/{id}",
  summary: "Consulta os dados de uma consulta",
  description: "Só para o paciente, o profissional da consulta e o ADMIN.",
  middleware: [authenticate],
  request: { params: idParamSchema },
  responses: { 200: consultaResponse, ...errorResponses(400, 401, 404) },
});

export const consultasRoutes = createRouter()
  .openapi(listarRoute, async (c) => {
    const pagina = await listarConsultas(c.req.valid("query"), getAtor(c));
    return c.json(pagina, 200);
  })
  .openapi(obterRoute, async (c) => {
    const consulta = await obterConsulta(c.req.valid("param").id, getAtor(c));
    return c.json({ data: consulta }, 200);
  })
  .openapi(agendarRoute, async (c) => {
    const consulta = await agendarConsulta(c.req.valid("json"), getAtor(c));
    return c.json({ data: consulta }, 201);
  })
  .openapi(cancelarRoute, async (c) => {
    const consulta = await cancelarConsulta(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: consulta }, 200);
  })
  .openapi(reagendarRoute, async (c) => {
    const consulta = await reagendarConsulta(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: consulta }, 200);
  });
