// Rotas dos direitos do titular (LGPD), sempre sobre o paciente autenticado
import { createRoute, z } from "@hono/zod-openapi";
import { Perfil } from "../../../generated/prisma/client";
import { authenticate, requireRole } from "../../middlewares/auth";
import { rateLimit } from "../../middlewares/rate-limit";
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
import {
  anonimizacaoSchema,
  consentimentoSchema,
  dadosDoTitularSchema,
} from "./lgpd.schema";
import { anonimizarMeusDados, exportarMeusDados } from "./titular.service";

const somentePaciente = [authenticate, requireRole(Perfil.PACIENTE)];
const base = {
  tags: ["LGPD"],
  security: [{ bearerAuth: [] }],
  middleware: somentePaciente,
};

// 5 tentativas a cada 15 minutos por usuário: com um token roubado, a confirmação
// por senha não pode virar um meio de descobrir a senha por tentativa
export const anonimizacaoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  key: (c) => c.get("usuario").id,
});

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
    "JSON com cadastro, consentimentos, histórico clínico, prontuário e notificações, enviado como arquivo para download. A exportação é auditada.",
  responses: {
    200: {
      description: "Dados do titular",
      content: jsonContent(dataResponseSchema(dadosDoTitularSchema)),
    },
    ...errorResponses(401, 403, 404),
  },
});

const anonimizarRoute = createRoute({
  ...base,
  method: "post",
  path: "/me/anonimizacao",
  summary: "Anonimiza os dados pessoais do paciente autenticado",
  middleware: [...somentePaciente, anonimizacaoRateLimit],
  description:
    "Ação irreversível, confirmada com a senha (até 5 tentativas a cada 15 minutos). Remove nome, CPF, telefone, e-mail e dia/mês de nascimento, revoga os consentimentos e encerra o acesso. Os registros clínicos de guarda obrigatória são preservados. Exige não ter consultas agendadas nem internação em andamento.",
  request: {
    body: { required: true, content: jsonContent(anonimizacaoSchema) },
  },
  responses: {
    204: { description: "Dados anonimizados e acesso encerrado" },
    ...errorResponses(400, 401, 403, 404, 409, 429),
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
  })
  .openapi(anonimizarRoute, async (c) => {
    await anonimizarMeusDados(c.req.valid("json"), getAtor(c));
    return c.body(null, 204);
  });
