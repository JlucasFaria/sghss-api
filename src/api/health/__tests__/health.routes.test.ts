import { describe, expect, it } from "bun:test";
import { app } from "../../../app";
import { errorHandler } from "../../../middlewares/error-handler";
import { AppError } from "../../../utils/app-error";
import { createRouter } from "../../../utils/openapi";
import { verificarBanco } from "../health.service";

describe("GET /health", () => {
  it("responde 200 com status ok e timestamp ISO no envelope data", async () => {
    const res = await app.request("/health");
    const { data } = (await res.json()) as {
      data: { status: string; timestamp: string };
    };

    expect(res.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
  });

  it("responde 404 com erro padronizado para rota inexistente", async () => {
    const res = await app.request("/rota-inexistente");
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("ROTA_NAO_ENCONTRADA");
  });
});

describe("GET /health/ready", () => {
  it("responde 200 quando o banco responde", async () => {
    const res = await app.request("/health/ready");
    const { data } = (await res.json()) as {
      data: { status: string; banco: string };
    };

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ status: "ok", banco: "ok" });
  });
});

describe("verificarBanco", () => {
  // Banco fora do ar ou travado, simulados sem derrubar o banco de testes
  const foraDoAr = () =>
    Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
  const travado = () => new Promise(() => {});

  it("responde 503 sem expor o motivo quando o banco falha", async () => {
    const router = createRouter().get("/", async (c) => {
      await verificarBanco({ consultar: foraDoAr });
      return c.body(null, 204);
    });
    router.onError(errorHandler);

    const res = await router.request("/");
    const texto = await res.text();

    expect(res.status).toBe(503);
    expect(JSON.parse(texto).error.code).toBe("SERVICO_INDISPONIVEL");
    expect(texto).not.toContain("10.0.0.5");
  });

  it("desiste quando o banco não responde dentro do tempo limite", async () => {
    const inicio = Date.now();
    const erro = await verificarBanco({
      consultar: travado,
      tempoLimiteMs: 50,
    }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(AppError);
    expect((erro as AppError).status).toBe(503);
    expect(Date.now() - inicio).toBeLessThan(1000);
  });
});
