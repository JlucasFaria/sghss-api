import { describe, expect, it } from "bun:test";
import { app } from "../../../app";

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
