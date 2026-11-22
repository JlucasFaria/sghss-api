// Schemas de entrada e saída da agenda do profissional
import { z } from "@hono/zod-openapi";
import { StatusHorario } from "../../../generated/prisma/client";
import { dataHoraSchema, mensagem, seSemErros } from "../../utils/validators";

// Limite de sanidade para um único horário (ex.: evita "fim" digitado no dia errado)
const DURACAO_MAXIMA_HORAS = 12;

export const abrirHorarioSchema = z
  .object({
    inicio: dataHoraSchema.openapi({
      type: "string",
      format: "date-time",
      example: "2026-12-01T09:00:00-03:00",
    }),
    fim: dataHoraSchema.openapi({
      type: "string",
      format: "date-time",
      example: "2026-12-01T09:30:00-03:00",
    }),
  })
  .refine(({ inicio, fim }) => fim > inicio, {
    path: ["fim"],
    message: "O fim deve ser posterior ao início.",
    ...seSemErros,
  })
  .refine(
    ({ inicio, fim }) =>
      fim.getTime() - inicio.getTime() <= DURACAO_MAXIMA_HORAS * 60 * 60 * 1000,
    {
      path: ["fim"],
      message: `O horário pode durar no máximo ${DURACAO_MAXIMA_HORAS} horas.`,
      ...seSemErros,
    },
  )
  .refine(({ inicio }) => inicio > new Date(), {
    path: ["inicio"],
    message: "O horário deve começar no futuro.",
    ...seSemErros,
  })
  .openapi("HorarioEntrada");

// O profissional só alterna entre disponível e bloqueado; RESERVADO vem do agendamento
export const atualizarHorarioSchema = z
  .object({
    status: z
      .enum([StatusHorario.DISPONIVEL, StatusHorario.BLOQUEADO])
      .openapi({ example: "BLOQUEADO" }),
  })
  .openapi("HorarioAtualizacao");

export const horarioSchema = z
  .object({
    id: z.uuid(),
    inicio: z.date(),
    fim: z.date(),
    status: z.enum(StatusHorario),
  })
  .openapi("Horario");

export const agendaQuerySchema = z.object({
  data: z.iso
    .date(mensagem("Data inválida. Use o formato AAAA-MM-DD."))
    .openapi({
      example: "2026-12-01",
      description: "Dia no horário de Brasília",
    }),
});

export const horarioParamsSchema = z.object({
  id: z
    .uuid(mensagem("Identificador inválido."))
    .openapi({ param: { name: "id", in: "path" } }),
  horarioId: z
    .uuid(mensagem("Identificador inválido."))
    .openapi({ param: { name: "horarioId", in: "path" } }),
});

export type AbrirHorarioInput = z.infer<typeof abrirHorarioSchema>;
export type AtualizarHorarioInput = z.infer<typeof atualizarHorarioSchema>;
