// Logger estruturado: uma linha JSON por evento, pronta para agregadores de log
import { env } from "../config/env";

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const write = (level: Level, message: string, fields: Fields = {}) => {
  // Em testes os logs só poluiriam a saída do bun test
  if (env.NODE_ENV === "test") return;

  // Campos fixos por último para que os extras não os sobrescrevam
  const line = JSON.stringify({
    ...fields,
    level,
    message,
    timestamp: new Date().toISOString(),
  });

  if (level === "error") console.error(line);
  else console.log(line);
};

export const logger = {
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};
