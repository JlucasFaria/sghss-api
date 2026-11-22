// Rotas de autenticação: autocadastro do paciente e login
import { createRoute } from "@hono/zod-openapi";
import { getClientIp } from "../../utils/client-ip";
import { createRouter, jsonContent } from "../../utils/openapi";
import { dataResponseSchema, errorResponseSchema } from "../../utils/response";
import {
  loginBodySchema,
  registerBodySchema,
  tokenSchema,
  usuarioSchema,
} from "./auth.schema";
import { login, registrarPaciente } from "./auth.service";

const registerRoute = createRoute({
  method: "post",
  path: "/register",
  tags: ["Autenticação"],
  summary: "Autocadastro de paciente",
  description:
    "Cria a conta do paciente e registra o aceite do termo de uso (consentimento LGPD).",
  request: {
    body: { required: true, content: jsonContent(registerBodySchema) },
  },
  responses: {
    201: {
      description: "Paciente cadastrado",
      content: jsonContent(dataResponseSchema(usuarioSchema)),
    },
    400: {
      description: "Dados inválidos",
      content: jsonContent(errorResponseSchema),
    },
    409: {
      description: "E-mail ou CPF já cadastrado",
      content: jsonContent(errorResponseSchema),
    },
  },
});

const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Autenticação"],
  summary: "Autentica o usuário e emite o token de acesso",
  request: { body: { required: true, content: jsonContent(loginBodySchema) } },
  responses: {
    200: {
      description: "Autenticado",
      content: jsonContent(dataResponseSchema(tokenSchema)),
    },
    400: {
      description: "Dados inválidos",
      content: jsonContent(errorResponseSchema),
    },
    401: {
      description: "E-mail ou senha inválidos",
      content: jsonContent(errorResponseSchema),
    },
  },
});

export const authRoutes = createRouter()
  .openapi(registerRoute, async (c) => {
    const usuario = await registrarPaciente(
      c.req.valid("json"),
      getClientIp(c),
    );
    return c.json({ data: usuario }, 201);
  })
  .openapi(loginRoute, async (c) => {
    const token = await login(c.req.valid("json"));
    return c.json({ data: token }, 200);
  });
