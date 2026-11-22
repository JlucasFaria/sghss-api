// Rotas dos direitos do titular (LGPD), sempre sobre o paciente autenticado
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
  listarConsentimentos,
  registrarConsentimento,
  revogarConsentimento,
} from "./consentimentos.service";
import { consentimentoSchema, dadosDoTitularSchema } from "./lgpd.schema";
import { exportarMeusDados } from "./titular.service";

const base = {
  tags: ["LGPD"],
  security: [{ bearerAuth: [] }],
  middleware: [authenticate, requireRole(Perfil.PACIENTE)],
};

const listarConsentimentosRoute = createRoute({
  ...base,
  method: "get",
  path: "/me/consentimentos",
  summary: "Lista os consentimentos do paciente autenticado",
  description: "Inclui os revogados, do mais recente para o mais antigo.",
  responses: {
    200: {
      description: "Consentimentos",
      content: jsonContent(dataResponseSchema(z.array(consentimentoSchema))),
    },
    ...errorResponses(401, 403, 404),
  },
});

const registrarConsentimentoRoute = createRoute({
  ...base,
  method: "post",
  path: "/me/consentimentos",
  summary: "Aceita o termo de uso de dados vigente",
  description:
    "Finalidade e versão vêm do termo vigente, não do cliente. Usado após uma revogação ou quando o termo muda de versão.",
  responses: {
    201: {
      description: "Consentimento registrado",
      content: jsonContent(dataResponseSchema(consentimentoSchema)),
    },
    ...errorResponses(401, 403, 404, 409),
  },
});

const revogarConsentimentoRoute = createRoute({
  ...base,
  method: "delete",
  path: "/me/consentimentos/{id}",
  summary: "Revoga um consentimento",
  description:
    "Registra a data da revogação e mantém o aceite original como prova. O atendimento continua amparado pela tutela da saúde (LGPD, art. 11, II, f).",
  request: { params: idParamSchema },
  responses: {
    204: { description: "Consentimento revogado" },
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const exportarDadosRoute = createRoute({
  ...base,
  method: "get",
  path: "/me/dados",
  summary: "Exporta todos os dados do paciente autenticado (portabilidade)",
  description:
    "JSON com conta, cadastro, consentimentos, histórico clínico, prontuário e notificações, enviado como arquivo para download. A exportação é auditada.",
  responses: {
    200: {
      description: "Dados do titular",
      content: jsonContent(dataResponseSchema(dadosDoTitularSchema)),
    },
    ...errorResponses(401, 403, 404),
  },
});

export const lgpdRoutes = createRouter()
  .openapi(listarConsentimentosRoute, async (c) => {
    const consentimentos = await listarConsentimentos(c.get("usuario").id);
    return c.json({ data: consentimentos }, 200);
  })
  .openapi(registrarConsentimentoRoute, async (c) => {
    const consentimento = await registrarConsentimento(getAtor(c));
    return c.json({ data: consentimento }, 201);
  })
  .openapi(revogarConsentimentoRoute, async (c) => {
    await revogarConsentimento(c.req.valid("param").id, getAtor(c));
    return c.body(null, 204);
  })
  .openapi(exportarDadosRoute, async (c) => {
    const dados = await exportarMeusDados(getAtor(c));
    c.header("Content-Disposition", 'attachment; filename="meus-dados.json"');
    c.header("Cache-Control", "no-store");
    return c.json({ data: dados }, 200);
  });
