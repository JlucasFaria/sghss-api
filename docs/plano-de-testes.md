# Plano de testes

Plano de testes da API do SGHSS (VidaPlus). Define o que é testado, como e com quais critérios de aceitação, e registra os resultados obtidos na última execução completa.

Referências: [requisitos](requisitos.md) · [rastreabilidade](rastreabilidade.md) · [testes não funcionais](../tests/README.md) · [coleção Postman](postman/README.md).

## 1. Objetivo

Demonstrar que a API atende aos requisitos funcionais (RF01–RF31) e não funcionais (RNF01–RNF13) do recorte implementado, com foco em:

- regras de negócio corretas nos fluxos centrais (agenda, consulta, prontuário, receita, internação);
- rejeição de entradas inválidas e de acessos indevidos;
- proteção de dados pessoais e clínicos (LGPD);
- desempenho e segurança dentro das metas definidas.

## 2. Escopo

**Dentro do escopo:** todas as rotas da API, a integração entre os módulos, a integração com o provedor de vídeo (simulado), o banco PostgreSQL real e o pipeline de CI.

**Fora do escopo:** interface visual (a ênfase do projeto é back-end), provedores externos reais (vídeo, e-mail, SMS), testes de intrusão manuais e testes em ambiente de produção.

## 3. Ambiente e ferramentas

| Item                 | Detalhe                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Testes automatizados | `bun:test`, com banco PostgreSQL de testes (`sghss_test`) esvaziado a cada teste               |
| Integração contínua  | GitHub Actions: lint, formatação, tipos, migrations e testes com cobertura a cada pull request |
| Testes manuais/API   | Coleção Postman, executável também pelo Newman (Docker)                                        |
| Carga                | k6 (Docker), contra a API local com o banco de desenvolvimento e o seed                        |
| Segurança            | OWASP ZAP em modo baseline (Docker), autenticado, sobre o contrato OpenAPI                     |
| Dados                | Fictícios: factories nos testes automatizados e seed (`bun run db:seed`) nos demais            |

## 4. Estratégia por tipo de teste

| Tipo                           | Como é testado                                                                                                                                                                                                                                           | Onde                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Unitário                       | Funções puras e utilitários: validadores (CPF, telefone, texto sem HTML), criptografia, token, datas, paginação, logger                                                                                                                                  | `src/utils/__tests__`, `src/config/__tests__`                     |
| Funcional (rotas)              | Cada rota chamada pela aplicação Hono, com banco real: status HTTP, corpo da resposta, efeito no banco e registro de auditoria                                                                                                                           | `src/api/**/__tests__`                                            |
| Negativo                       | Dados inválidos (400 com o campo apontado), sem token (401), perfil sem permissão (403), recurso inexistente ou de outro usuário (404), conflito de estado (409), excesso de tentativas (429)                                                            | Testes de rota e pasta `[Negativo]` da coleção Postman            |
| Integração entre módulos       | Fluxo completo só pela API: cadastro do médico, agenda, agendamento, prontuário, conclusão, receita, validação pela farmácia, histórico e trilha de auditoria                                                                                            | `src/__tests__/fluxo-completo.test.ts`; pastas 04 e 05 da coleção |
| Integração com serviço externo | Provedor de vídeo simulado atrás de uma interface (`ProvedorVideo`): sucesso e falha do provedor (502, sem alterar nada)                                                                                                                                 | `src/api/telemedicina/__tests__`                                  |
| Concorrência                   | Requisições simultâneas no mesmo recurso: um único sucesso e estado consistente (horário, leito, estoque, internação)                                                                                                                                    | Testes de consultas, internações e suprimentos                    |
| Segurança e LGPD               | Hash de senha, cifra de dados sensíveis, mascaramento de CPF, minimização por perfil, rate limit, auditoria, consentimento, portabilidade e anonimização; varredura OWASP ZAP                                                                            | Testes de rota, `src/middlewares/__tests__`, `tests/seguranca`    |
| Desempenho                     | Carga com k6 em dois cenários simultâneos (leitura e agendamento), com metas automáticas (thresholds)                                                                                                                                                    | `tests/carga`                                                     |
| Disponibilidade                | Liveness (`/health`) e readiness (`/health/ready`): banco ok, fora do ar e travado (503 dentro do tempo limite); erros inesperados respondidos como 500 sem derrubar a API; reinício do container e queda real do banco verificados com o Docker Compose | `src/api/health/__tests__`, `src/middlewares/__tests__`           |
| Usabilidade da API             | Contrato OpenAPI válido e publicado, envelope padrão `{ data }`/`{ error }`, mensagens em português com o campo inválido                                                                                                                                 | `src/__tests__/app.test.ts`, `error-handler.test.ts`              |

## 5. Casos de teste

Formato: **ID · entrada · comportamento esperado · resultado esperado · resultado obtido**. Cada caso aponta o arquivo que o automatiza. Resultado obtido na execução de 22/11/2026.

| ID   | Requisito   | Entrada                                                                     | Comportamento esperado                                                                           | Resultado esperado                                               | Resultado obtido                                                                                     |
| ---- | ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| CT01 | RF08        | Cadastro de paciente com dados válidos; busca pelo CPF                      | Paciente criado, CPF cifrado no banco e encontrado pelo hash                                     | 201 e 200 com os dados do paciente                               | Aprovado (`pacientes.routes.test.ts`)                                                                |
| CT02 | RF08, RNF03 | Cadastro com CPF de dígito verificador inválido                             | Validação na borda, nada gravado                                                                 | 400 com o campo `cpf` e mensagem clara                           | Aprovado (`pacientes.routes.test.ts`)                                                                |
| CT03 | RNF03       | Nome com `<script>`                                                         | Texto com HTML recusado (bloqueia XSS armazenado)                                                | 400 no campo `nome`                                              | Aprovado (`pacientes.routes.test.ts`)                                                                |
| CT04 | RF01, RF24  | Autocadastro com aceite do termo                                            | Conta, paciente, consentimento e auditoria na mesma transação                                    | 201; consentimento com versão do termo                           | Aprovado (`auth.routes.test.ts`)                                                                     |
| CT05 | RF02, RNF02 | Login com senha errada 6 vezes                                              | Mesma mensagem para e-mail inexistente ou senha errada; limite por e-mail e IP                   | 401 nas 5 primeiras e 429 na sexta                               | Aprovado (`auth.routes.test.ts`)                                                                     |
| CT06 | RF04        | Paciente chama rota exclusiva do ADMIN                                      | RBAC barra antes da regra de negócio                                                             | 403                                                              | Aprovado (`auth.test.ts`; Postman pasta 03)                                                          |
| CT07 | RF07        | Horário sobreposto a outro do mesmo profissional                            | Conflito detectado sob trava                                                                     | 409                                                              | Aprovado (`agenda.routes.test.ts`; Postman pasta 04)                                                 |
| CT08 | RF11        | Dois pacientes agendam o mesmo horário ao mesmo tempo                       | Só um agendamento; horário fica RESERVADO                                                        | Um 201 e um 409                                                  | Aprovado (`consultas.routes.test.ts`)                                                                |
| CT09 | RF12        | Paciente cancela com menos de 24 h de antecedência                          | Prazo do paciente respeitado; profissional e ADMIN podem cancelar                                | 409 para o paciente                                              | Aprovado (`consultas.routes.test.ts`)                                                                |
| CT10 | RF15        | Evolução registrada antes do início da consulta                             | Registro clínico só em consulta iniciada                                                         | 409                                                              | Aprovado (`prontuario.routes.test.ts`; Postman 05)                                                   |
| CT11 | RF15, RNF05 | Adendo depois da conclusão; tentativas de PUT, PATCH e DELETE no prontuário | Prontuário somente inclusão: a correção é uma nova evolução, e não há rota de edição ou exclusão | 201 para o adendo; 404 nas tentativas; evolução original intacta | Aprovado (`prontuario.routes.test.ts`)                                                               |
| CT12 | RF16, RF17  | Médico emite receita; farmácia valida o código sem login                    | Código exibido uma vez, só o hash gravado; validação com dados mínimos                           | 201 com o código; 200 com `VALIDA` e nome abreviado              | Aprovado (`receitas.routes.test.ts`; fluxo completo)                                                 |
| CT13 | RF17, RNF02 | Validações repetidas de códigos inexistentes                                | Limite de requisições contra descoberta por tentativa                                            | 404 e depois 429                                                 | Aprovado (`receitas.routes.test.ts`)                                                                 |
| CT14 | RF18, RNF11 | Criação de teleconsulta com o provedor de vídeo fora do ar                  | Falha do serviço externo tratada sem alterar o banco                                             | 502                                                              | Aprovado (`telemedicina.routes.test.ts`)                                                             |
| CT15 | RF10        | Profissional sem vínculo pede o histórico de um paciente                    | Acesso negado sem revelar se o paciente existe                                                   | 403                                                              | Aprovado (`historico.routes.test.ts`)                                                                |
| CT16 | RF20, RF21  | Agendamento, reagendamento e cancelamento                                   | Notificações geradas na mesma transação do evento                                                | Três notificações do tipo correto                                | Aprovado (`notificacoes.test.ts`)                                                                    |
| CT17 | RF23        | ADMIN filtra a auditoria por ação e período                                 | Período no horário de Brasília, data final inclusiva                                             | 200 só com os registros do filtro                                | Aprovado (`auditoria.routes.test.ts`)                                                                |
| CT18 | RF25        | Paciente exporta os próprios dados                                          | JSON completo, decifrado, sem dados de terceiros nem hashes                                      | 200 com `Content-Disposition` de arquivo                         | Aprovado (`lgpd.routes.test.ts`; Postman 06)                                                         |
| CT19 | RF26        | Anonimização com senha correta                                              | Identificação removida, registros clínicos preservados, acesso encerrado                         | 204; token seguinte responde 401                                 | Aprovado (`lgpd.routes.test.ts`)                                                                     |
| CT20 | RF27        | Mudar para MANUTENCAO um leito ocupado                                      | Status de leito ocupado só muda pela internação                                                  | 409                                                              | Aprovado (`leitos.routes.test.ts`)                                                                   |
| CT21 | RF28        | Alta e transferência simultâneas da mesma internação                        | Trava na internação; nenhum leito fica preso como ocupado                                        | Ambos os leitos LIVRE ao final                                   | Aprovado (`internacoes.routes.test.ts`)                                                              |
| CT22 | RF29        | Relatório de consultas sem período                                          | Período obrigatório                                                                              | 400 nos campos `de` e `ate`                                      | Aprovado (`relatorios.routes.test.ts`; Postman 07)                                                   |
| CT23 | RF30        | Duas saídas simultâneas que somadas excedem o saldo                         | Condição de saldo na própria escrita                                                             | Um 201 e um 409; saldo nunca negativo                            | Aprovado (`suprimentos.routes.test.ts`)                                                              |
| CT24 | RF31        | Lançamentos de 0,10 e 0,20                                                  | Soma em decimal, sem erro de ponto flutuante                                                     | Receitas `"0.30"`                                                | Aprovado (`relatorios.routes.test.ts`)                                                               |
| CT25 | RNF04       | Erro inesperado no servidor                                                 | Mensagem genérica, detalhe só no log interno                                                     | 500 sem a mensagem original                                      | Aprovado (`error-handler.test.ts`)                                                                   |
| CT26 | Integração  | Fluxo completo pela API, do cadastro do médico à validação da receita       | Módulos funcionando em conjunto; auditoria na ordem dos eventos                                  | Todas as etapas com o status esperado                            | Aprovado (`fluxo-completo.test.ts`)                                                                  |
| CT27 | RNF07       | Carga: 20 usuários navegando e 5 agendando por 1 min 30 s                   | Desempenho dentro da meta sob concorrência, também só na escrita                                 | p95 < 500 ms (geral e do agendamento) e erros < 1%               | Aprovado: p95 = 39,0 ms (agendamento: 50,7 ms); 0% de erros em 8.235 requisições                     |
| CT28 | RNF03       | Varredura OWASP ZAP baseline autenticada (71 URLs do contrato)              | Sem alertas de segurança pendentes                                                               | 0 FAIL e 0 WARN                                                  | Aprovado: 119 regras aprovadas; 1 alerta informativo justificado (CORS aberto só em desenvolvimento) |
| CT29 | RNF12       | Suíte automatizada com cobertura                                            | Cobertura mínima garantida no CI                                                                 | ≥ 80% de linhas e funções em cada arquivo                        | Aprovado: 99,56% de linhas e 99,80% de funções (392 testes)                                          |
| CT30 | Postman     | Coleção completa (42 requisições, 77 asserções)                             | Fluxo autenticado e casos negativos passando em sequência                                        | 0 falhas                                                         | Aprovado: 77/77 asserções                                                                            |

## 6. Critérios de aceitação

Uma entrega (pull request) é aceita quando:

1. Lint, formatação e verificação de tipos passam sem erros.
2. Todos os testes automatizados passam no CI, com banco real.
3. Nenhum arquivo fica abaixo de 80% de linhas ou de funções cobertas (a medição considera os arquivos carregados pelos testes; todas as rotas e services são carregados pelo app).
4. Todo requisito implementado tem ao menos um caso de teste na [matriz de rastreabilidade](rastreabilidade.md).
5. Antes de uma versão: carga com p95 < 500 ms (no geral e no agendamento) e erros < 1%; varredura ZAP sem WARN ou FAIL pendente; coleção Postman sem falhas.

## 7. Resultados consolidados

| Verificação                    | Resultado                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Testes automatizados           | 392 testes em 33 arquivos, todos aprovados                                            |
| Cobertura                      | 99,56% das linhas e 99,80% das funções                                                |
| Coleção Postman (Newman)       | 42 requisições, 77 asserções, 0 falhas                                                |
| Carga (k6)                     | 8.235 requisições; p95 = 39,0 ms (agendamento: 50,7 ms); 0% de erros; 100% dos checks |
| Segurança (OWASP ZAP baseline) | 0 FAIL, 0 WARN, 1 INFO justificado, 119 regras aprovadas                              |

## 8. Riscos do sistema e mitigação

| Risco                                                        | Impacto                         | Mitigação adotada                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vazamento de dados pessoais e clínicos                       | Alto (LGPD, sigilo médico)      | Cifra AES-256-GCM em CPF, telefone, prontuário e resultados; minimização por perfil; CPF mascarado em listagens; auditoria                                     |
| Acesso indevido por token roubado ou senha fraca             | Alto                            | JWT com expiração; conta inativa barrada a cada requisição; senha forte com argon2id; rate limit em login e cadastro                                           |
| Agendamento duplo ou leito ocupado duas vezes                | Alto (atendimento comprometido) | Escritas condicionais e travas no banco, cobertas por testes de concorrência                                                                                   |
| Perda de rastreabilidade (quem acessou o quê)                | Alto (compliance)               | Trilha de auditoria somente inclusão, gravada na mesma transação da ação                                                                                       |
| Indisponibilidade do provedor de vídeo                       | Médio                           | Porta `ProvedorVideo` com tratamento de falha (502) sem estado parcial                                                                                         |
| Degradação de desempenho com o crescimento dos dados         | Médio                           | Paginação em todas as listagens, índices em FKs e filtros, agregações no banco; carga monitorada com k6                                                        |
| Limite de requisições em memória com várias instâncias       | Médio                           | Documentado; em escala horizontal, mover os contadores para armazenamento compartilhado (ex.: Redis)                                                           |
| IP real do cliente atrás de proxy reverso                    | Médio                           | `TRUST_PROXY`: o `X-Forwarded-For` só é lido quando a conexão vem de um proxy confiável, ignorando entradas forjadas (`src/utils/__tests__/client-ip.test.ts`) |
| Regressão em mudanças futuras                                | Médio                           | CI obrigatório com testes, cobertura mínima por arquivo e revisão por pull request                                                                             |
| Testes que dependem do relógio (prazos, janelas de consulta) | Baixo                           | Horários fixos ou relativos ao relógio nos testes; relógio simulado (`setSystemTime`) no fluxo completo                                                        |
| Varredura de segurança alterando dados do ambiente           | Baixo                           | Execução só no banco de desenvolvimento, seguida do seed, que restaura os dados fictícios                                                                      |
