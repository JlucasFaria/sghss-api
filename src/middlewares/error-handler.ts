// Tratamento global de erros: converte qualquer falha no envelope { error } com mensagem em português
import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { Prisma } from "../../generated/prisma/client";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import type { ErrorDetail } from "../utils/response";

// Mensagens padrão para exceções HTTP lançadas pelo próprio Hono (corpo inválido, payload grande etc.)
const httpDefaults: Record<number, { code: string; message: string }> = {
  400: { code: "REQUISICAO_INVALIDA", message: "Requisição inválida." },
  401: { code: "NAO_AUTENTICADO", message: "Autenticação necessária." },
  403: { code: "ACESSO_NEGADO", message: "Acesso negado." },
  404: { code: "NAO_ENCONTRADO", message: "Recurso não encontrado." },
  413: {
    code: "PAYLOAD_MUITO_GRANDE",
    message: "O corpo da requisição excede o tamanho permitido.",
  },
  415: {
    code: "TIPO_DE_CONTEUDO_INVALIDO",
    message: "O corpo deve ser enviado como application/json.",
  },
  429: {
    code: "MUITAS_REQUISICOES",
    message: "Muitas requisições. Tente novamente em instantes.",
  },
};

export const zodIssuesToDetails = (error: ZodError): ErrorDetail[] =>
  error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

const toAppError = (err: Error): AppError | undefined => {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError(
      400,
      "VALIDACAO",
      "Dados inválidos. Verifique os campos informados.",
      zodIssuesToDetails(err),
    );
  }

  if (err instanceof HTTPException) {
    const fallback = httpDefaults[err.status] ?? {
      code: "ERRO_HTTP",
      message: "Não foi possível processar a requisição.",
    };
    return new AppError(err.status, fallback.code, fallback.message);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return new AppError(
        409,
        "CONFLITO",
        "Já existe um registro com estes dados.",
      );
    }
    if (err.code === "P2025") {
      return new AppError(404, "NAO_ENCONTRADO", "Registro não encontrado.");
    }
  }

  return undefined;
};

export const errorHandler: ErrorHandler = (err, c) => {
  const appError = toAppError(err);

  if (!appError) {
    logger.error("erro_nao_tratado", {
      requestId: c.get("requestId"),
      error: err.message,
      stack: err.stack,
    });
    return c.json(
      {
        error: {
          code: "ERRO_INTERNO",
          message: "Erro interno do servidor. Tente novamente mais tarde.",
        },
      },
      500,
    );
  }

  const { status, code, message, details } = appError;
  return c.json({ error: { code, message, details } }, status);
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json(
    { error: { code: "ROTA_NAO_ENCONTRADA", message: "Rota não encontrada." } },
    404,
  );
