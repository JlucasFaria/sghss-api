import { describe, expect, it } from "bun:test";
import {
  dataDeHoje,
  formatarDataHora,
  intervaloDoDia,
  somarDias,
} from "../datas";

describe("intervaloDoDia", () => {
  it("delimita o dia no horário de Brasília (UTC−3)", () => {
    const { inicio, fim } = intervaloDoDia("2030-03-10");

    expect(inicio.toISOString()).toBe("2030-03-10T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2030-03-11T03:00:00.000Z");
  });
});

describe("dataDeHoje", () => {
  it("usa o dia de Brasília, não o dia UTC", () => {
    // 01:00 UTC de 23/12 = 22:00 de 22/12 em Brasília
    expect(dataDeHoje(new Date("2026-12-23T01:00:00Z"))).toBe("2026-12-22");
    expect(dataDeHoje(new Date("2026-12-23T03:00:00Z"))).toBe("2026-12-23");
  });
});

describe("somarDias", () => {
  it("soma dias atravessando o fim do mês e do ano", () => {
    expect(somarDias("2026-12-22", 30).toISOString()).toBe(
      "2027-01-21T00:00:00.000Z",
    );
  });
});

describe("formatarDataHora", () => {
  it("formata no horário de Brasília", () => {
    expect(formatarDataHora(new Date("2026-12-23T01:05:00Z"))).toBe(
      "22/12/2026 às 22:05",
    );
  });
});
