// Rotas de pacientes: gestão do cadastro pelo ADMIN
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
import {
  paginatedResponseSchema,
  paginationQuerySchema,
} from "../../utils/pagination";
import { dataResponseSchema } from "../../utils/response";
import {
  atualizarPacienteSchema,
  buscaCpfSchema,
  pacienteResumoSchema,
  pacienteSchema,
} from "./pacientes.schema";
import {
  atualizarPaciente,
  buscarPorCpf,
  inativarPaciente,
  listarPacientes,
  obterPaciente,
} from "./pacientes.service";

const base = { tags: ["Pacientes"], security: [{ bearerAuth: [] }] };
const somenteAdmin = [authenticate, requireRole(Perfil.ADMIN)];
const pacienteResponse = {
  description: "Paciente com dados completos",
  content: jsonContent(dataResponseSchema(pacienteSchema)),
};

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/",
  summary: "Lista os pacientes (paginado)",
  description: "Mostra dados mínimos, com o CPF mascarado.",
  middleware: somenteAdmin,
  request: { query: paginationQuerySchema },
  responses: {
    200: {
      description: "Página de pacientes",
      content: jsonContent(paginatedResponseSchema(pacienteResumoSchema)),
    },
    ...errorResponses(400, 401, 403),
  },
});

const buscarCpfRoute = createRoute({
  ...base,
  method: "post",
  path: "/busca",
  summary: "Busca um paciente pelo CPF",
  description:
    "O CPF vai no corpo, nunca na URL (que fica em logs e históricos), e é comparado pelo hash.",
  middleware: somenteAdmin,
  request: { body: { required: true, content: jsonContent(buscaCpfSchema) } },
  responses: { 200: pacienteResponse, ...errorResponses(400, 401, 403, 404) },
});

const obterRoute = createRoute({
  ...base,
  method: "get",
  path: "/{id}",
  summary: "Consulta os dados completos de um paciente",
  middleware: somenteAdmin,
  request: { params: idParamSchema },
  responses: { 200: pacienteResponse, ...errorResponses(400, 401, 403, 404) },
});

const atualizarRoute = createRoute({
  ...base,
  method: "put",
  path: "/{id}",
  summary: "Atualiza (ou reativa) o cadastro de um paciente",
  middleware: somenteAdmin,
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(atualizarPacienteSchema) },
  },
  responses: {
    200: pacienteResponse,
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const inativarRoute = createRoute({
  ...base,
  method: "delete",
  path: "/{id}",
  summary: "Inativa um paciente",
  description:
    "Bloqueia o acesso; o prontuário tem guarda obrigatória e é preservado.",
  middleware: somenteAdmin,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Paciente inativado" },
    ...errorResponses(400, 401, 403, 404),
  },
});

export const pacientesRoutes = createRouter()
  .openapi(listarRoute, async (c) => {
    const pagina = await listarPacientes(c.req.valid("query"));
    return c.json(pagina, 200);
  })
  .openapi(buscarCpfRoute, async (c) => {
    const paciente = await buscarPorCpf(c.req.valid("json").cpf, getAtor(c));
    return c.json({ data: paciente }, 200);
  })
  .openapi(obterRoute, async (c) => {
    const paciente = await obterPaciente(c.req.valid("param").id, getAtor(c));
    return c.json({ data: paciente }, 200);
  })
  .openapi(atualizarRoute, async (c) => {
    const paciente = await atualizarPaciente(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: paciente }, 200);
  })
  .openapi(inativarRoute, async (c) => {
    await inativarPaciente(c.req.valid("param").id, getAtor(c));
    return c.body(null, 204);
  });
