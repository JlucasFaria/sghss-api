// Rotas de autenticação: autocadastro do paciente e login
import { createRoute } from "@hono/zod-openapi";
import { authenticate } from "../../middlewares/auth";
import { rateLimit } from "../../middlewares/rate-limit";
import { getClientIp } from "../../utils/client-ip";
import { createRouter, jsonContent } from "../../utils/openapi";
import { dataResponseSchema, errorResponseSchema } from "../../utils/response";
import {
  loginBodySchema,
  registerBodySchema,
  tokenSchema,
  usuarioSchema,
} from "./auth.schema";
import { buscarUsuarioAtual, login, registrarPaciente } from "./auth.service";

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

// 5 tentativas a cada 15 minutos por IP + e-mail: freia força bruta contra uma conta
// sem bloquear outros usuários atrás do mesmo IP (ex.: rede de um hospital)
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  key: async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email : "";
    return `${getClientIp(c)}:${email.trim().toLowerCase()}`;
  },
});

const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Autenticação"],
  summary: "Autentica o usuário e emite o token de acesso",
  middleware: [loginRateLimit] as const,
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
    429: {
      description: "Muitas tentativas de login",
      content: jsonContent(errorResponseSchema),
    },
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Autenticação"],
  summary: "Dados de acesso do usuário autenticado",
  security: [{ bearerAuth: [] }],
  middleware: [authenticate] as const,
  responses: {
    200: {
      description: "Usuário autenticado",
      content: jsonContent(dataResponseSchema(usuarioSchema)),
    },
    401: {
      description: "Token ausente, inválido ou expirado",
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
  })
  .openapi(meRoute, async (c) => {
    const usuario = await buscarUsuarioAtual(c.get("usuario").id);
    return c.json({ data: usuario }, 200);
  });
