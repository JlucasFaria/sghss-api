// Verificação de prontidão (RNF08): a API só está pronta se alcança o banco
import { prisma } from "../../db/client";
import { AppError } from "../../utils/app-error";

// Sem limite, uma conexão travada deixaria o monitor esperando indefinidamente
const TEMPO_LIMITE_BANCO_MS = 2000;

const consultaMinima = () => prisma.$queryRaw`SELECT 1`;

// A consulta e o tempo limite podem ser trocados nos testes (banco fora do ar ou travado)
export async function verificarBanco({
  consultar = consultaMinima,
  tempoLimiteMs = TEMPO_LIMITE_BANCO_MS,
}: { consultar?: () => Promise<unknown>; tempoLimiteMs?: number } = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tempoEsgotado = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(
      () => rejeitar(new Error("tempo limite do banco")),
      tempoLimiteMs,
    );
  });

  try {
    await Promise.race([consultar(), tempoEsgotado]);
  } catch {
    // O motivo fica fora da resposta pública (não expõe detalhes da infraestrutura)
    throw new AppError(
      503,
      "SERVICO_INDISPONIVEL",
      "Serviço temporariamente indisponível.",
    );
  } finally {
    clearTimeout(timer);
  }
}
