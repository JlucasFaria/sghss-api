// Rotas de exames: agendamento pelo paciente e resultado pelo profissional da unidade
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
  agendarExameSchema,
  exameSchema,
  listarExamesQuerySchema,
  resultadoExameSchema,
} from "./exames.schema";
import {
  agendarExame,
  listarExames,
  obterExame,
  registrarResultado,
} from "./exames.service";

const base = { tags: ["Exames"], security: [{ bearerAuth: [] }] };
const profissionais = [Perfil.MEDICO, Perfil.ENFERMEIRO, Perfil.TECNICO];
// ADMIN não acessa exames: o resultado é dado clínico (minimização, LGPD)
const pacienteOuProfissional = [
  authenticate,
  requireRole(Perfil.PACIENTE, ...profissionais),
];
const exameResponse = {
  description: "Exame",
  content: jsonContent(dataResponseSchema(exameSchema)),
};

const agendarRoute = createRoute({
  ...base,
  method: "post",
  path: "/",
  summary: "Agenda um exame em uma unidade",
  middleware: [authenticate, requireRole(Perfil.PACIENTE)],
  request: {
    body: { required: true, content: jsonContent(agendarExameSchema) },
  },
  responses: {
    201: { ...exameResponse, description: "Exame agendado" },
    ...errorResponses(400, 401, 403),
  },
});

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/",
  summary: "Lista exames (paginado)",
  description:
    "O paciente vê os próprios exames; o profissional, os da unidade em que atua.",
  middleware: pacienteOuProfissional,
  request: { query: listarExamesQuerySchema },
  responses: {
    200: {
      description: "Página de exames",
      content: jsonContent(paginatedResponseSchema(exameSchema)),
    },
    ...errorResponses(400, 401, 403),
  },
});

const obterRoute = createRoute({
  ...base,
  method: "get",
  path: "/{id}",
  summary: "Consulta um exame",
  middleware: pacienteOuProfissional,
  request: { params: idParamSchema },
  responses: { 200: exameResponse, ...errorResponses(400, 401, 403, 404) },
});

const resultadoRoute = createRoute({
  ...base,
  method: "patch",
  path: "/{id}/resultado",
  summary: "Registra o resultado e conclui o exame",
  description:
    "Só um profissional lotado na unidade do exame, depois da data marcada. O resultado é gravado cifrado.",
  middleware: [authenticate, requireRole(...profissionais)],
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(resultadoExameSchema) },
  },
  responses: {
    200: { ...exameResponse, description: "Resultado registrado" },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

export const examesRoutes = createRouter()
  .openapi(agendarRoute, async (c) => {
    const exame = await agendarExame(c.req.valid("json"), getAtor(c));
    return c.json({ data: exame }, 201);
  })
  .openapi(listarRoute, async (c) => {
    const pagina = await listarExames(c.req.valid("query"), getAtor(c));
    return c.json(pagina, 200);
  })
  .openapi(obterRoute, async (c) => {
    const exame = await obterExame(c.req.valid("param").id, getAtor(c));
    return c.json({ data: exame }, 200);
  })
  .openapi(resultadoRoute, async (c) => {
    const exame = await registrarResultado(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: exame }, 200);
  });
