// Rotas da teleconsulta, montadas em /consultas/{id}/teleconsulta
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
import { teleconsultaSchema } from "./telemedicina.schema";
import { criarSala } from "./telemedicina.service";

const base = { tags: ["Telemedicina"], security: [{ bearerAuth: [] }] };
const profissionais = [Perfil.MEDICO, Perfil.ENFERMEIRO, Perfil.TECNICO];
const teleconsultaResponse = {
  description: "Sala da teleconsulta",
  content: jsonContent(dataResponseSchema(teleconsultaSchema)),
};
const criarSalaRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/teleconsulta",
  summary: "Cria a sala de vídeo da teleconsulta no provedor",
  description:
    "Só o profissional da consulta, em teleconsulta agendada cujo horário não terminou. Se a sala já existe, devolve a mesma (200).",
  middleware: [authenticate, requireRole(...profissionais)],
  request: { params: idParamSchema },
  responses: {
    200: { ...teleconsultaResponse, description: "Sala já existente" },
    201: { ...teleconsultaResponse, description: "Sala criada" },
    ...errorResponses(400, 401, 403, 404, 409, 502),
  },
});

export const telemedicinaRoutes = createRouter().openapi(
  criarSalaRoute,
  async (c) => {
    const { criada, teleconsulta } = await criarSala(
      c.req.valid("param").id,
      getAtor(c),
    );
    return c.json({ data: teleconsulta }, criada ? 201 : 200);
  },
);
