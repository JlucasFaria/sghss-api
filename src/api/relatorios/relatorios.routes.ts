// Rotas dos relatórios gerenciais: exclusivas do ADMIN (RF29)
import { createRoute } from "@hono/zod-openapi";
import { Perfil } from "../../../generated/prisma/client";
import { authenticate, requireRole } from "../../middlewares/auth";
import { createRouter, errorResponses, jsonContent } from "../../utils/openapi";
import { dataResponseSchema } from "../../utils/response";
import {
  consultasQuerySchema,
  ocupacaoQuerySchema,
  relatorioConsultasSchema,
  relatorioOcupacaoSchema,
} from "./relatorios.schema";
import { relatorioConsultas, relatorioOcupacao } from "./relatorios.service";

const base = {
  tags: ["Relatórios"],
  security: [{ bearerAuth: [] }],
  middleware: [authenticate, requireRole(Perfil.ADMIN)],
};

const ocupacaoRoute = createRoute({
  ...base,
  method: "get",
  path: "/ocupacao-leitos",
  summary: "Ocupação atual dos leitos por unidade",
  description:
    "Leitos livres, ocupados e em manutenção das unidades ativas. A taxa de ocupação considera só os leitos em operação (fora de manutenção).",
  request: { query: ocupacaoQuerySchema },
  responses: {
    200: {
      description: "Relatório de ocupação",
      content: jsonContent(dataResponseSchema(relatorioOcupacaoSchema)),
    },
    ...errorResponses(400, 401, 403),
  },
});

const consultasRoute = createRoute({
  ...base,
  method: "get",
  path: "/consultas",
  summary: "Consultas por período e unidade",
  description:
    "Totais por status e modalidade, pela data da consulta no horário de Brasília (`ate` inclusivo). O período é obrigatório.",
  request: { query: consultasQuerySchema },
  responses: {
    200: {
      description: "Relatório de consultas",
      content: jsonContent(dataResponseSchema(relatorioConsultasSchema)),
    },
    ...errorResponses(400, 401, 403),
  },
});

export const relatoriosRoutes = createRouter()
  .openapi(ocupacaoRoute, async (c) => {
    const relatorio = await relatorioOcupacao(c.req.valid("query"));
    return c.json({ data: relatorio }, 200);
  })
  .openapi(consultasRoute, async (c) => {
    const relatorio = await relatorioConsultas(c.req.valid("query"));
    return c.json({ data: relatorio }, 200);
  });
