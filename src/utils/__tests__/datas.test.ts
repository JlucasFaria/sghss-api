import { describe, expect, it } from "bun:test";
import { intervaloDoDia } from "../datas";

describe("intervaloDoDia", () => {
  it("delimita o dia no horário de Brasília (UTC−3)", () => {
    const { inicio, fim } = intervaloDoDia("2030-03-10");

    expect(inicio.toISOString()).toBe("2030-03-10T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2030-03-11T03:00:00.000Z");
  });
});
