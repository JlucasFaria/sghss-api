// Utilitários de definição das rotas OpenAPI: roteador, conteúdo JSON, erros e parâmetros comuns
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { errorResponseSchema } from "./response";
import { mensagem } from "./validators";

// Falhas de validação seguem para o error handler global
export const createRouter = () =>
  new OpenAPIHono({
    defaultHook: (result) => {
      if (!result.success) throw result.error;
    },
  });

// Atalho para o bloco "content" de requisições e respostas JSON na definição das rotas
export const jsonContent = <T>(schema: T) => ({
  "application/json": { schema },
});

const errorDescriptions = {
  400: "Dados inválidos",
  401: "Token ausente, inválido ou expirado",
  403: "Perfil sem permissão para esta operação",
  404: "Recurso não encontrado",
  409: "Conflito com o estado atual do recurso",
  429: "Muitas requisições",
} as const;

type ErrorStatus = keyof typeof errorDescriptions;

type ErrorResponseConfig = {
  description: string;
  content: ReturnType<typeof jsonContent<typeof errorResponseSchema>>;
};

// Respostas de erro padronizadas para documentar as rotas sem repetição
export const errorResponses = <S extends ErrorStatus>(...statuses: S[]) => {
  const responses = {} as Record<S, ErrorResponseConfig>;
  for (const status of statuses) {
    responses[status] = {
      description: errorDescriptions[status],
      content: jsonContent(errorResponseSchema),
    };
  }
  return responses;
};

// Parâmetro de rota :id no formato UUID (ids inválidos viram 400, não 500)
export const idParamSchema = z.object({
  id: z.uuid(mensagem("Identificador inválido.")).openapi({
    param: { name: "id", in: "path" },
    example: "7f3c1a52-4b8e-4d1a-9c6f-0a1b2c3d4e01",
  }),
});
