import { describe, expect, it } from "bun:test";
import { app } from "../app";

describe("aplicação", () => {
  it("publica a especificação OpenAPI em /openapi.json", async () => {
    const res = await app.request("/openapi.json");
    const spec = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };

    expect(res.status).toBe(200);
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.paths).toHaveProperty("/health");
  });

  it("serve o Swagger UI em /docs", async () => {
    const res = await app.request("/docs");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("devolve X-Request-Id e reaproveita o id enviado pelo cliente", async () => {
    const generated = await app.request("/health");
    const forwarded = await app.request("/health", {
      headers: { "X-Request-Id": "req-123" },
    });

    expect(generated.headers.get("x-request-id")).toBeTruthy();
    expect(forwarded.headers.get("x-request-id")).toBe("req-123");
  });

  it("aplica headers de segurança nas respostas", async () => {
    const res = await app.request("/health");

    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("strict-transport-security")).toContain("max-age");
  });
});
