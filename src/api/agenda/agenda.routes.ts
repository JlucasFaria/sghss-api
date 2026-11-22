// Rotas da agenda do profissional, montadas em /profissionais/{id}/horarios
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
import {
  abrirHorarioSchema,
  agendaQuerySchema,
  atualizarHorarioSchema,
  horarioParamsSchema,
  horarioSchema,
} from "./agenda.schema";
import {
  abrirHorario,
  atualizarHorario,
  listarAgendaDoDia,
} from "./agenda.service";

const base = { tags: ["Agenda"], security: [{ bearerAuth: [] }] };
// O service confere se o profissional é o dono da agenda
const gestoresDaAgenda = [
  authenticate,
  requireRole(Perfil.ADMIN, Perfil.MEDICO, Perfil.ENFERMEIRO, Perfil.TECNICO),
];
const horarioResponse = {
  description: "Horário",
  content: jsonContent(dataResponseSchema(horarioSchema)),
};

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/{id}/horarios",
  summary: "Agenda do profissional em um dia",
  description:
    "Lista os horários do dia (horário de Brasília) com o status de cada um.",
  middleware: [authenticate],
  request: { params: idParamSchema, query: agendaQuerySchema },
  responses: {
    200: {
      description: "Horários do dia",
      content: jsonContent(dataResponseSchema(z.array(horarioSchema))),
    },
    ...errorResponses(400, 401, 404),
  },
});

const abrirRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/horarios",
  summary: "Abre um horário na agenda",
  description:
    "Somente o próprio profissional ou o ADMIN. O horário não pode se sobrepor a outro.",
  middleware: gestoresDaAgenda,
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(abrirHorarioSchema) },
  },
  responses: {
    201: { ...horarioResponse, description: "Horário aberto" },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const atualizarRoute = createRoute({
  ...base,
  method: "patch",
  path: "/{id}/horarios/{horarioId}",
  summary: "Bloqueia ou libera um horário",
  description: "Horários reservados para consulta não podem ser alterados.",
  middleware: gestoresDaAgenda,
  request: {
    params: horarioParamsSchema,
    body: { required: true, content: jsonContent(atualizarHorarioSchema) },
  },
  responses: {
    200: horarioResponse,
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

export const agendaRoutes = createRouter()
  .openapi(listarRoute, async (c) => {
    const horarios = await listarAgendaDoDia(
      c.req.valid("param").id,
      c.req.valid("query").data,
      getAtor(c),
    );
    return c.json({ data: horarios }, 200);
  })
  .openapi(abrirRoute, async (c) => {
    const horario = await abrirHorario(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: horario }, 201);
  })
  .openapi(atualizarRoute, async (c) => {
    const { id, horarioId } = c.req.valid("param");
    const horario = await atualizarHorario(
      id,
      horarioId,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: horario }, 200);
  });
