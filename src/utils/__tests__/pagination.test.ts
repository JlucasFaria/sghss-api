import { describe, expect, it } from "bun:test";
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  buildPaginationMeta,
  paginationQuerySchema,
  toSkipTake,
} from "../pagination";

describe("paginationQuerySchema", () => {
  it("aplica valores padrão quando page e limit não são enviados", () => {
    expect(paginationQuerySchema.parse({})).toEqual({
      page: 1,
      limit: PAGINATION_DEFAULT_LIMIT,
    });
  });

  it("converte strings da query string em números", () => {
    expect(paginationQuerySchema.parse({ page: "3", limit: "15" })).toEqual({
      page: 3,
      limit: 15,
    });
  });

  it.each([
    [{ page: "0" }],
    [{ page: "-1" }],
    [{ page: "1.5" }],
    [{ page: "abc" }],
    [{ limit: "0" }],
    [{ limit: String(PAGINATION_MAX_LIMIT + 1) }],
  ])("rejeita valores inválidos: %p", (query) => {
    expect(paginationQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("toSkipTake", () => {
  it("calcula o deslocamento a partir da página", () => {
    expect(toSkipTake({ page: 1, limit: 10 })).toEqual({ skip: 0, take: 10 });
    expect(toSkipTake({ page: 3, limit: 10 })).toEqual({ skip: 20, take: 10 });
  });
});

describe("buildPaginationMeta", () => {
  it("arredonda o total de páginas para cima", () => {
    expect(buildPaginationMeta({ page: 2, limit: 10 }, 25)).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it("retorna zero páginas quando não há registros", () => {
    expect(buildPaginationMeta({ page: 1, limit: 10 }, 0).totalPages).toBe(0);
  });
});
