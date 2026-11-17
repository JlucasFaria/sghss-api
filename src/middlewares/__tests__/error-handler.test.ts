import { describe, expect, it } from "bun:test";
import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { Prisma } from "../../../generated/prisma/client";
import { app } from "../../app";
import { conflict, notFound } from "../../utils/app-error";
import type { ErrorResponse } from "../../utils/response";
import { createRouter } from "../../utils/openapi";
import { errorHandler, notFoundHandler } from "../error-handler";

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("erro prisma", {
    code,
    clientVersion: "test",
  });

// A rota OpenAPI vem primeiro: .get() devolve o tipo Hono, que não tem .openapi()
const router = createRouter()
  .openapi(
    createRoute({
      method: "post",
      path: "/validacao",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ nome: z.string(), idade: z.number() }),
            },
          },
        },
      },
      responses: { 200: { description: "ok" } },
    }),
    (c) => c.json({ data: c.req.valid("json") }, 200),
  )
  .get("/app-error", () => {
    throw notFound("Paciente não encontrado.");
  })
  .get("/conflict", () => {
    throw conflict("CPF já cadastrado.");
  })
  .get("/http-exception", () => {
    throw new HTTPException(413);
  })
  .get("/prisma-unique", () => {
    throw prismaError("P2002");
  })
  .get("/prisma-not-found", () => {
    throw prismaError("P2025");
  })
  .get("/inesperado", () => {
    throw new Error("falha interna com detalhe sensível");
  });

router.onError(errorHandler);
router.notFound(notFoundHandler);

const request = async (path: string, init?: RequestInit) => {
  const res = await router.request(path, init);
  return { status: res.status, body: (await res.json()) as ErrorResponse };
};

describe("errorHandler", () => {
  it("converte AppError no envelope { error } com o status do erro", async () => {
    const { status, body } = await request("/app-error");

    expect(status).toBe(404);
    expect(body).toEqual({
      error: { code: "NAO_ENCONTRADO", message: "Paciente não encontrado." },
    });
  });

  it("responde 409 para conflito de negócio", async () => {
    const { status, body } = await request("/conflict");

    expect(status).toBe(409);
    expect(body.error.code).toBe("CONFLITO");
  });

  it("responde 400 com detalhes por campo quando o corpo é inválido", async () => {
    const { status, body } = await request("/validacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: 123 }),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDACAO");
    expect(body.error.details?.map((d) => d.field)).toEqual(["nome", "idade"]);
  });

  it("responde 400 em português quando o JSON está malformado", async () => {
    const { status, body } = await request("/validacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalido",
    });

    expect(status).toBe(400);
    expect(body.error).toEqual({
      code: "REQUISICAO_INVALIDA",
      message: "Requisição inválida.",
    });
  });

  it("traduz HTTPException do Hono para mensagem padrão", async () => {
    const { status, body } = await request("/http-exception");

    expect(status).toBe(413);
    expect(body.error.code).toBe("PAYLOAD_MUITO_GRANDE");
  });

  it("mapeia violação de unicidade do Prisma (P2002) para 409", async () => {
    const { status, body } = await request("/prisma-unique");

    expect(status).toBe(409);
    expect(body.error.code).toBe("CONFLITO");
  });

  it("mapeia registro inexistente do Prisma (P2025) para 404", async () => {
    const { status, body } = await request("/prisma-not-found");

    expect(status).toBe(404);
    expect(body.error.code).toBe("NAO_ENCONTRADO");
  });

  it("responde 500 genérico sem vazar a mensagem original", async () => {
    const { status, body } = await request("/inesperado");

    expect(status).toBe(500);
    expect(body.error.code).toBe("ERRO_INTERNO");
    expect(JSON.stringify(body)).not.toContain("sensível");
  });
});

describe("notFoundHandler", () => {
  it("responde 404 padronizado para rota inexistente na aplicação", async () => {
    const res = await app.request("/nao-existe");
    const body = (await res.json()) as ErrorResponse;

    expect(res.status).toBe(404);
    expect(body.error).toEqual({
      code: "ROTA_NAO_ENCONTRADA",
      message: "Rota não encontrada.",
    });
  });
});
