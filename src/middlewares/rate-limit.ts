// Limite de requisições por chave em janela fixa (proteção contra força bruta)
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { AppError } from "../utils/app-error";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  // Identifica quem está sendo limitado (ex.: IP + e-mail no login)
  key: (c: Context) => string | Promise<string>;
};

// Contadores em memória: suficientes para uma instância. Com várias instâncias da API,
// o armazenamento precisaria ser compartilhado (ex.: Redis) para o limite valer no total.
export const rateLimit = ({ windowMs, max, key }: RateLimitOptions) => {
  const hits = new Map<string, { count: number; resetAt: number }>();

  // Remove janelas vencidas para o mapa não crescer indefinidamente
  setInterval(() => {
    const now = Date.now();
    for (const [k, hit] of hits) if (hit.resetAt <= now) hits.delete(k);
  }, windowMs).unref();

  const middleware = createMiddleware(async (c, next) => {
    const now = Date.now();
    const id = await key(c);
    const hit = hits.get(id);

    if (!hit || hit.resetAt <= now) {
      hits.set(id, { count: 1, resetAt: now + windowMs });
    } else if (++hit.count > max) {
      c.header("Retry-After", String(Math.ceil((hit.resetAt - now) / 1000)));
      throw new AppError(
        429,
        "MUITAS_REQUISICOES",
        "Muitas tentativas. Tente novamente mais tarde.",
      );
    }

    await next();
  });

  // reset() zera os contadores (usado nos testes, que compartilham o mesmo IP)
  return Object.assign(middleware, { reset: () => hits.clear() });
};
