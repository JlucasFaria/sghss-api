import { describe, expect, it } from "bun:test";
import { app } from "../../../app";

describe("GET /health", () => {
  it("responde 200 com status ok e timestamp ISO", async () => {
    const res = await app.request("/health");
    const body = (await res.json()) as { status: string; timestamp: string };

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("responde 404 para rota inexistente", async () => {
    const res = await app.request("/rota-inexistente");

    expect(res.status).toBe(404);
  });
});
