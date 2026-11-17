// Paginação reutilizável: query ?page=&limit=, conversão para Prisma e metadados da resposta
import { z } from "@hono/zod-openapi";

export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION_MAX_LIMIT)
    .default(PAGINATION_DEFAULT_LIMIT),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const paginatedResponseSchema = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), meta: paginationMetaSchema });

// Converte page/limit em skip/take para consultas com Prisma
export const toSkipTake = ({ page, limit }: PaginationQuery) => ({
  skip: (page - 1) * limit,
  take: limit,
});

export const buildPaginationMeta = (
  { page, limit }: PaginationQuery,
  total: number,
): PaginationMeta => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
