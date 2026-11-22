// Rotas de internações: gestão exclusiva do ADMIN (RF28)
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
  internacaoSchema,
  internarSchema,
  listarInternacoesQuerySchema,
  transferenciaSchema,
} from "./internacoes.schema";
import {
  darAlta,
  internar,
  listarInternacoes,
  transferir,
} from "./internacoes.service";

const base = {
  tags: ["Internações"],
  security: [{ bearerAuth: [] }],
  middleware: [authenticate, requireRole(Perfil.ADMIN)],
};
const internacaoResponse = (description: string) => ({
  description,
  content: jsonContent(dataResponseSchema(internacaoSchema)),
});

const listarRoute = createRoute({
  ...base,
  method: "get",
  path: "/",
  summary: "Lista as internações (paginado)",
  description:
    "Filtra por situação (ATIVA ou ENCERRADA), unidade e paciente. Não inclui o motivo, que é dado clínico.",
  request: { query: listarInternacoesQuerySchema },
  responses: {
    200: {
      description: "Página de internações",
      content: jsonContent(paginatedResponseSchema(internacaoSchema)),
    },
    ...errorResponses(400, 401, 403),
  },
});

const internarRoute = createRoute({
  ...base,
  method: "post",
  path: "/",
  summary: "Interna um paciente, ocupando um leito livre",
  description:
    "Recusada (409) se o leito não estiver livre, a unidade estiver inativa ou o paciente já estiver internado.",
  request: {
    body: { required: true, content: jsonContent(internarSchema) },
  },
  responses: {
    201: internacaoResponse("Internação registrada"),
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const transferirRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/transferencia",
  summary: "Transfere o paciente para outro leito",
  description:
    "Ocupa o leito de destino e libera o de origem na mesma transação. O destino pode ser de outra unidade.",
  request: {
    params: idParamSchema,
    body: { required: true, content: jsonContent(transferenciaSchema) },
  },
  responses: {
    200: internacaoResponse("Internação transferida"),
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

const altaRoute = createRoute({
  ...base,
  method: "post",
  path: "/{id}/alta",
  summary: "Dá alta ao paciente, liberando o leito",
  request: { params: idParamSchema },
  responses: {
    200: internacaoResponse("Internação encerrada"),
    ...errorResponses(400, 401, 403, 404, 409),
  },
});

export const internacoesRoutes = createRouter()
  .openapi(listarRoute, async (c) => {
    const pagina = await listarInternacoes(c.req.valid("query"));
    return c.json(pagina, 200);
  })
  .openapi(internarRoute, async (c) => {
    const internacao = await internar(c.req.valid("json"), getAtor(c));
    return c.json({ data: internacao }, 201);
  })
  .openapi(transferirRoute, async (c) => {
    const internacao = await transferir(
      c.req.valid("param").id,
      c.req.valid("json"),
      getAtor(c),
    );
    return c.json({ data: internacao }, 200);
  })
  .openapi(altaRoute, async (c) => {
    const internacao = await darAlta(c.req.valid("param").id, getAtor(c));
    return c.json({ data: internacao }, 200);
  });
