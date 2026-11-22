// Rotina periódica de lembretes de consulta. É iniciada só pelo servidor (src/index.ts),
// nunca nos testes, que chamam gerarLembretes() diretamente.
import { logger } from "../../utils/logger";
import { gerarLembretes } from "./notificacoes.service";

const INTERVALO_MS = 15 * 60 * 1000;

export function iniciarRotinaDeLembretes() {
  const executar = () =>
    gerarLembretes()
      .then((total) => {
        if (total > 0) logger.info("lembretes_gerados", { total });
      })
      .catch((error: unknown) =>
        logger.error("lembretes_falharam", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );

  void executar();
  return setInterval(executar, INTERVALO_MS);
}
