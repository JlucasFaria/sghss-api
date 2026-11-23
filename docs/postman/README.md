# Coleção Postman

Coleção com o fluxo autenticado da API e casos negativos, organizada em pastas que seguem a ordem de uso do sistema:

| Pasta                       | Conteúdo                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------- |
| 01 Saúde e documentação     | `/health` e contrato OpenAPI                                                          |
| 02 Autenticação             | Login dos perfis ADMIN, MEDICO e PACIENTE; senha errada, sem token, cadastro inválido |
| 03 Cadastros (ADMIN)        | Unidades, profissionais e pacientes; acesso negado ao paciente, UF inválida           |
| 04 Agenda e consultas       | Abertura de horário, agendamento, conflito, notificação e cancelamento                |
| 05 Atendimento e receita    | Prontuário, conclusão, receita e validação pela farmácia                              |
| 06 LGPD e auditoria         | Consentimentos, exportação de dados e trilha de auditoria                             |
| 07 Administração hospitalar | Leitos e relatórios gerenciais                                                        |

Requisições marcadas com **[Negativo]** verificam respostas de erro (400, 401, 403, 409) e o envelope `{ error }`.

## Pré-requisitos

- API rodando (`bun run dev`) com o banco populado pelo seed (`bun run db:seed`).
- Environment **SGHSS - local** (`sghss.postman_environment.json`) selecionado; ele traz a URL base e os usuários fictícios do seed.

## Como executar

**No Postman:** importe os dois arquivos, selecione o environment e rode a coleção inteira pelo _Collection Runner_, na ordem. As requisições guardam tokens e ids em variáveis da coleção para as seguintes.

**Pela linha de comando (Newman via Docker):**

```bash
docker run --rm -v "$(pwd)/docs/postman:/etc/newman" postman/newman:6-alpine \
  run sghss.postman_collection.json -e sghss.postman_environment.json \
  --env-var baseUrl=http://host.docker.internal:3000
```

## Observações

- A pasta 05 abre um horário que começa 15 segundos depois e aguarda esse início antes de registrar o prontuário, porque a API só aceita registros clínicos em consultas já iniciadas.
- O login tem limite de 5 tentativas a cada 15 minutos por e-mail e IP. Ao rodar a coleção várias vezes seguidas, aguarde esse intervalo se aparecer o status 429.
