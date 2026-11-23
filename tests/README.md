# Testes não funcionais

Os testes funcionais e de integração ficam junto do código (`src/**/__tests__`) e rodam com `bun test`. Esta pasta reúne os testes que exigem a API rodando e são executados por ferramentas em Docker, sem instalação local.

Pré-requisitos comuns: API rodando (`bun run dev`) e banco populado pelo seed (`bun run db:seed`). Nunca execute contra o banco de testes nem contra produção.

## Carga com k6 (`carga/`)

```bash
bun run test:carga
```

O script `carga/consultas.k6.js` roda dois cenários ao mesmo tempo, por 1 min 30 s:

| Cenário       | Usuários virtuais   | O que faz                                                                                       |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `navegacao`   | sobe até 20 em 20 s | Consultas do paciente, agenda do dia, histórico, notificações e relatório de ocupação de leitos |
| `agendamento` | 5 constantes        | Agenda e cancela consultas (escrita com transação e travas no banco)                            |

Metas (thresholds): **p95 < 500 ms**, **taxa de erro < 1%** e **checks > 99%**. Se alguma não for atingida, o k6 termina com código de saída diferente de zero.

O login é feito uma vez no `setup` (a API limita tentativas de login), que também abre um horário por usuário virtual em um dia sorteado no futuro, para não colidir com execuções anteriores.

## Segurança com OWASP ZAP (`seguranca/`)

```bash
bun run test:seguranca
bun run db:seed   # restaura os dados fictícios depois da varredura
```

O script `seguranca/zap.ts` faz login como ADMIN e roda o `zap-api-scan.py` do OWASP ZAP em **modo baseline** (`-S`): o ZAP importa o contrato `/openapi.json`, chama cada rota com o token e analisa as respostas de forma passiva (cabeçalhos de segurança, cookies, vazamento de informação e de erros), sem enviar ataques.

- **Regras:** `seguranca/regras.conf` lista os alertas aceitos, cada um com a justificativa. Qualquer alerta novo fica como WARN e faz o comando terminar com erro, até ser corrigido ou justificado.
- **Relatórios:** `seguranca/relatorio-zap.html` e `relatorio-zap.json`, gerados a cada execução e fora do controle de versão.
- **Cuidado:** as rotas são chamadas com os exemplos do contrato, inclusive `POST`, `PUT` e `DELETE`. Use apenas o banco de desenvolvimento e rode `bun run db:seed` em seguida; o seed restaura as unidades fictícias alteradas pela varredura.
