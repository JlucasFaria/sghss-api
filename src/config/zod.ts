// Mensagens de validação do Zod em português do Brasil para toda a aplicação
import { z } from "zod";

z.config(z.locales.ptBR());

// Campo ausente recebe mensagem direta; os demais casos seguem o locale acima
z.config({
  customError: (issue) =>
    issue.code === "invalid_type" && issue.input === undefined
      ? "Campo obrigatório."
      : undefined,
});
