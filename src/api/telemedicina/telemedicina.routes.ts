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
import {
  acessoTeleconsultaSchema,
  teleconsultaSchema,
} from "./telemedicina.schema";
import {
  criarSala,
  encerrarTeleconsulta,
  entrarNaTeleconsulta,
} from "./telemedicina.service";

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

const entrarRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/teleconsulta/entrada",
  summary: "Entra na teleconsulta e recebe o token temporário de acesso",
  description:
    "Só o paciente e o profissional da consulta, de 15 minutos antes do início até 30 minutos após o fim previsto. O token expira no fim dessa janela e não é armazenado.",
  middleware: [authenticate, requireRole(Perfil.PACIENTE, ...profissionais)],
  request: { params: idParamSchema },
  responses: {
    200: {
      description: "Acesso à sala",
      content: jsonContent(dataResponseSchema(acessoTeleconsultaSchema)),
    },
    ...errorResponses(400, 401, 403, 404, 409, 502),
  },
});

const encerrarRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/teleconsulta/encerramento",
  summary: "Encerra a teleconsulta e conclui a consulta",
  description:
    "Só o profissional da consulta, depois que alguém entrou na sala. A consulta passa a REALIZADA.",
  middleware: [authenticate, requireRole(...profissionais)],
  request: { params: idParamSchema },
  responses: {
    200: { ...teleconsultaResponse, description: "Teleconsulta encerrada" },
    ...errorResponses(400, 401, 403, 404, 409, 502),
  },
});

export const telemedicinaRoutes = createRouter()
  .openapi(criarSalaRoute, async (c) => {
    const { criada, teleconsulta } = await criarSala(
      c.req.valid("param").id,
      getAtor(c),
    );
    return c.json({ data: teleconsulta }, criada ? 201 : 200);
  })
  .openapi(entrarRoute, async (c) => {
    const acesso = await entrarNaTeleconsulta(
      c.req.valid("param").id,
      getAtor(c),
    );
    return c.json({ data: acesso }, 200);
  })
  .openapi(encerrarRoute, async (c) => {
    const teleconsulta = await encerrarTeleconsulta(
      c.req.valid("param").id,
      getAtor(c),
    );
    return c.json({ data: teleconsulta }, 200);
  });
