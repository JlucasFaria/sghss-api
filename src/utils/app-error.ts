// Erro de domínio da aplicação: carrega status HTTP, código estável e mensagem para o cliente
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorDetail } from "./response";

export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: ErrorDetail[]) =>
  new AppError(400, "REQUISICAO_INVALIDA", message, details);

export const unauthorized = (message = "Autenticação necessária.") =>
  new AppError(401, "NAO_AUTENTICADO", message);

export const forbidden = (
  message = "Você não tem permissão para acessar este recurso.",
) => new AppError(403, "ACESSO_NEGADO", message);

export const notFound = (message = "Recurso não encontrado.") =>
  new AppError(404, "NAO_ENCONTRADO", message);

export const conflict = (message: string) =>
  new AppError(409, "CONFLITO", message);
