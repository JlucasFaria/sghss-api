// Mensagens de validação do Zod em português do Brasil para toda a aplicação
import { z } from "zod";

z.config(z.locales.ptBR());

// Campo ausente recebe mensagem direta, qualquer que seja o tipo esperado (texto, enum,
// literal...); os demais casos seguem o locale acima
z.config({
  customError: (issue) =>
    issue.input === undefined ? "Campo obrigatório." : undefined,
});
