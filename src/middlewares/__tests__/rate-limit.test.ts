import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { ErrorResponse } from "../../utils/response";
import { errorHandler } from "../error-handler";
import { rateLimit } from "../rate-limit";

const criarApp = (windowMs = 60_000) =>
  new Hono()
    .get(
      "/",
      rateLimit({ windowMs, max: 2, key: (c) => c.req.query("k") ?? "" }),
      (c) => c.text("ok"),
    )
    .onError(errorHandler);

describe("rateLimit", () => {
  it("bloqueia com 429 e Retry-After depois do limite", async () => {
    const app = criarApp();
    await app.request("/?k=a");
    await app.request("/?k=a");

    const res = await app.request("/?k=a");
    const body = (await res.json()) as ErrorResponse;

    expect(res.status).toBe(429);
    expect(body.error.code).toBe("MUITAS_REQUISICOES");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("conta cada chave separadamente", async () => {
    const app = criarApp();
    await app.request("/?k=a");
    await app.request("/?k=a");

    expect((await app.request("/?k=b")).status).toBe(200);
  });

  it("libera novamente quando a janela termina", async () => {
    const app = criarApp(50);
    await app.request("/?k=a");
    await app.request("/?k=a");
    expect((await app.request("/?k=a")).status).toBe(429);

    await Bun.sleep(60);

    expect((await app.request("/?k=a")).status).toBe(200);
  });
});
