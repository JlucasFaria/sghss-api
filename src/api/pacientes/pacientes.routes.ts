// Rotas de pacientes: perfil do próprio paciente e gestão do cadastro pelo ADMIN
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
import { historicoSchema } from "./historico.schema";
import { historicoDoPaciente, meuHistorico } from "./historico.service";
import {
  atualizarPacienteSchema,
  atualizarPerfilSchema,
  buscaCpfSchema,
  pacienteResumoSchema,
  pacienteSchema,
} from "./pacientes.schema";
import {
  atualizarMeuPerfil,
  atualizarPaciente,
  buscarPorCpf,
  inativarPaciente,
  listarPacientes,
  obterMeuPerfil,
  obterPaciente,
} from "./pacientes.service";

const base = { tags: ["Pacientes"], security: [{ bearerAuth: [] }] };
const somenteAdmin = [authenticate, requireRole(Perfil.ADMIN)];
const somentePaciente = [authenticate, requireRole(Perfil.PACIENTE)];
// ADMIN gere cadastros e não acessa dados clínicos (minimização, LGPD)
const profissionaisDeSaude = [
  authenticate,
  requireRole(Perfil.MEDICO, Perfil.ENFERMEIRO, Perfil.TECNICO),
];
const historicoResponse = {
  description: "Histórico clínico",
  content: jsonContent(dataResponseSchema(historicoSchema)),
};
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

const meuPerfilRoute = createRoute({
  ...base,
  method: "get",
  path: "/me",
  summary: "Dados cadastrais do paciente autenticado",
  middleware: somentePaciente,
  responses: { 200: pacienteResponse, ...errorResponses(401, 403, 404) },
});

const atualizarMeuPerfilRoute = createRoute({
  ...base,
  method: "put",
  path: "/me",
  summary: "Atualiza os dados cadastrais do paciente autenticado",
  description:
    "Altera nome, data de nascimento e telefone. O CPF só pode ser corrigido pelo ADMIN.",
  middleware: somentePaciente,
  request: {
    body: { required: true, content: jsonContent(atualizarPerfilSchema) },
  },
  responses: { 200: pacienteResponse, ...errorResponses(400, 401, 403, 404) },
});

const meuHistoricoRoute = createRoute({
  ...base,
  method: "get",
  path: "/me/historico",
  summary: "Histórico clínico do paciente autenticado",
  description: "Consultas, exames, prescrições e internações.",
  middleware: somentePaciente,
  responses: { 200: historicoResponse, ...errorResponses(401, 403, 404) },
});

const historicoRoute = createRoute({
  ...base,
  method: "get",
  path: "/{id}/historico",
  summary: "Histórico clínico de um paciente atendido pelo profissional",
  description:
    "Só para o profissional com consulta agendada ou realizada com o paciente, ou responsável por um exame dele. O acesso é auditado.",
  middleware: profissionaisDeSaude,
  request: { params: idParamSchema },
  responses: { 200: historicoResponse, ...errorResponses(400, 401, 403, 404) },
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
  // /me antes de /{id}: senão "me" seria tratado como um id
  .openapi(meuPerfilRoute, async (c) => {
    const paciente = await obterMeuPerfil(c.get("usuario").id);
    return c.json({ data: paciente }, 200);
  })
  .openapi(atualizarMeuPerfilRoute, async (c) => {
    const paciente = await atualizarMeuPerfil(c.req.valid("json"), getAtor(c));
    return c.json({ data: paciente }, 200);
  })
  .openapi(meuHistoricoRoute, async (c) => {
    const historico = await meuHistorico(c.get("usuario").id);
    return c.json({ data: historico }, 200);
  })
  .openapi(historicoRoute, async (c) => {
    const historico = await historicoDoPaciente(
      c.req.valid("param").id,
      getAtor(c),
    );
    return c.json({ data: historico }, 200);
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
