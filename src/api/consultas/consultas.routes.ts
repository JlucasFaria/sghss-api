// Rotas de consultas: agendamento pelo paciente
import { createRoute } from "@hono/zod-openapi";
import { Perfil } from "../../../generated/prisma/client";
import { authenticate, requireRole } from "../../middlewares/auth";
import { getAtor } from "../../utils/ator";
import { createRouter, errorResponses, jsonContent } from "../../utils/openapi";
import { dataResponseSchema } from "../../utils/response";
import { agendarConsultaSchema, consultaSchema } from "./consultas.schema";
import { agendarConsulta } from "./consultas.service";

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

export const consultasRoutes = createRouter().openapi(
  agendarRoute,
  async (c) => {
    const consulta = await agendarConsulta(c.req.valid("json"), getAtor(c));
    return c.json({ data: consulta }, 201);
  },
);
