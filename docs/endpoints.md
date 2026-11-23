# Endpoints da API

Referência das 70 operações da API do SGHSS. O contrato completo (todos os campos, tipos e respostas de erro) está no Swagger, em `/docs`, gerado a partir do próprio código (`/openapi.json`). Os exemplos da seção 3 foram capturados da API rodando com os dados fictícios do seed.

## 1. Convenções

| Item              | Convenção                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| URL base          | `http://localhost:3000` (local)                                                                                                   |
| Autenticação      | `Authorization: Bearer <token>`, obtido em `POST /auth/login`; validade de 1 hora                                                 |
| Formato           | JSON (`Content-Type: application/json`); datas em ISO 8601 (UTC); filtros de data no formato `AAAA-MM-DD`, no horário de Brasília |
| Sucesso           | `{ "data": ... }`; listagens: `{ "data": [...], "meta": { "page", "limit", "total", "totalPages" } }`                             |
| Paginação         | `?page=1&limit=20` (máximo 100)                                                                                                   |
| Erro              | `{ "error": { "code", "message", "details"? } }`; `details` aponta o campo inválido                                               |
| Exclusão (DELETE) | Inativação lógica quando há dados clínicos ou legais vinculados                                                                   |

| Status | Quando                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------- |
| 400    | Dados inválidos (`VALIDACAO`)                                                                       |
| 401    | Token ausente, inválido, expirado ou conta inativa                                                  |
| 403    | Perfil sem permissão para a operação                                                                |
| 404    | Recurso inexistente ou que pertence a outro usuário (não revela que existe)                         |
| 409    | Conflito com o estado atual (horário ocupado, prazo vencido, leito não livre, estoque insuficiente) |
| 429    | Limite de tentativas excedido (login, cadastro, validação de receita, anonimização)                 |
| 502    | Provedor de vídeo indisponível                                                                      |
| 503    | Banco de dados indisponível (`/health/ready`)                                                       |

## 2. Rotas

**Perfis**: ADMIN · MEDICO · ENFERMEIRO · TECNICO · PACIENTE. "Profissional" = MEDICO, ENFERMEIRO ou TECNICO. "Autenticado" = qualquer perfil.

### Saúde e autenticação

| Método | Rota             | Perfil      | Descrição                                                         |
| ------ | ---------------- | ----------- | ----------------------------------------------------------------- |
| GET    | `/health`        | Público     | Liveness: a API está no ar                                        |
| GET    | `/health/ready`  | Público     | Readiness: a API alcança o banco (503 se não alcançar)            |
| POST   | `/auth/register` | Público     | Autocadastro de paciente com aceite do termo (10 por hora por IP) |
| POST   | `/auth/login`    | Público     | Emite o token (5 tentativas a cada 15 min por e-mail e IP)        |
| GET    | `/auth/me`       | Autenticado | Dados de acesso do usuário logado                                 |

### Unidades, profissionais e agenda

| Método | Rota                                       | Perfil                          | Descrição                                                    |
| ------ | ------------------------------------------ | ------------------------------- | ------------------------------------------------------------ |
| GET    | `/unidades`                                | Autenticado                     | Lista unidades (inativas só para o ADMIN)                    |
| GET    | `/unidades/{id}`                           | Autenticado                     | Consulta uma unidade                                         |
| POST   | `/unidades`                                | ADMIN                           | Cadastra uma unidade                                         |
| PUT    | `/unidades/{id}`                           | ADMIN                           | Atualiza ou reativa                                          |
| DELETE | `/unidades/{id}`                           | ADMIN                           | Inativa (409 com consultas futuras ou pacientes internados)  |
| GET    | `/profissionais`                           | Autenticado                     | Lista com filtro de unidade e especialidade                  |
| GET    | `/profissionais/{id}`                      | Autenticado                     | Consulta um profissional                                     |
| POST   | `/profissionais`                           | ADMIN                           | Cadastra o profissional e o usuário de acesso (CRM ou COREN) |
| PUT    | `/profissionais/{id}`                      | ADMIN                           | Atualiza ou reativa                                          |
| DELETE | `/profissionais/{id}`                      | ADMIN                           | Inativa (409 com consultas futuras)                          |
| GET    | `/profissionais/{id}/horarios?data=`       | Autenticado                     | Agenda do dia, com o status de cada horário                  |
| POST   | `/profissionais/{id}/horarios`             | ADMIN ou o próprio profissional | Abre um horário (409 se sobrepuser outro)                    |
| PATCH  | `/profissionais/{id}/horarios/{horarioId}` | ADMIN ou o próprio profissional | Bloqueia ou libera um horário não reservado                  |

### Pacientes e LGPD

| Método | Rota                                | Perfil                   | Descrição                                                       |
| ------ | ----------------------------------- | ------------------------ | --------------------------------------------------------------- |
| GET    | `/pacientes`                        | ADMIN                    | Lista com CPF mascarado                                         |
| POST   | `/pacientes/busca`                  | ADMIN                    | Busca pelo CPF, enviado no corpo (nunca na URL)                 |
| GET    | `/pacientes/{id}`                   | ADMIN                    | Dados completos (leitura auditada)                              |
| PUT    | `/pacientes/{id}`                   | ADMIN                    | Atualiza ou reativa (409 se anonimizado)                        |
| DELETE | `/pacientes/{id}`                   | ADMIN                    | Inativa o acesso; o prontuário é preservado                     |
| GET    | `/pacientes/me`                     | PACIENTE                 | Dados cadastrais do titular                                     |
| PUT    | `/pacientes/me`                     | PACIENTE                 | Atualiza nome, data de nascimento e telefone                    |
| GET    | `/pacientes/me/historico`           | PACIENTE                 | Histórico clínico: consultas, exames, prescrições e internações |
| GET    | `/pacientes/{id}/historico`         | Profissional com vínculo | Histórico de um paciente que o profissional atende (auditado)   |
| GET    | `/pacientes/me/consentimentos`      | PACIENTE                 | Consentimentos, inclusive os revogados                          |
| POST   | `/pacientes/me/consentimentos`      | PACIENTE                 | Aceita o termo vigente                                          |
| DELETE | `/pacientes/me/consentimentos/{id}` | PACIENTE                 | Revoga um consentimento, mantendo o aceite como prova           |
| GET    | `/pacientes/me/dados`               | PACIENTE                 | Exporta todos os dados do titular em JSON (portabilidade)       |
| POST   | `/pacientes/me/anonimizacao`        | PACIENTE                 | Anonimiza os dados pessoais, confirmada com a senha             |

### Consultas, exames, prontuário e receitas

| Método | Rota                            | Perfil                                      | Descrição                                                                |
| ------ | ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/consultas`                    | PACIENTE                                    | Agenda consulta presencial ou teleconsulta                               |
| GET    | `/consultas`                    | Autenticado                                 | Lista: o paciente vê as suas, o profissional as da agenda, o ADMIN todas |
| GET    | `/consultas/{id}`               | Paciente, profissional da consulta ou ADMIN | Consulta os dados (o ADMIN não vê o motivo)                              |
| POST   | `/consultas/{id}/cancelamento`  | Paciente, profissional da consulta ou ADMIN | Cancela; o paciente precisa de 24 h de antecedência                      |
| POST   | `/consultas/{id}/reagendamento` | Paciente, profissional da consulta ou ADMIN | Move para outro horário do mesmo profissional                            |
| POST   | `/consultas/{id}/prontuario`    | Profissional                                | Registra uma evolução (consulta já iniciada)                             |
| GET    | `/consultas/{id}/prontuario`    | PACIENTE ou profissional                    | Lista as evoluções (leitura do profissional auditada)                    |
| POST   | `/consultas/{id}/conclusao`     | Profissional da consulta                    | Conclui o atendimento (exige ao menos uma evolução)                      |
| POST   | `/consultas/{id}/receitas`      | MEDICO da consulta                          | Emite a receita; o código de verificação aparece só nesta resposta       |
| GET    | `/receitas/{id}`                | PACIENTE ou profissional                    | Consulta uma receita (sem o código)                                      |
| POST   | `/receitas/validacao`           | Público                                     | Farmácia valida o código (30 por IP a cada 15 min)                       |
| POST   | `/exames`                       | PACIENTE                                    | Agenda um exame                                                          |
| GET    | `/exames`                       | PACIENTE ou profissional                    | Lista: os do paciente ou os da unidade do profissional                   |
| GET    | `/exames/{id}`                  | PACIENTE ou profissional                    | Consulta um exame                                                        |
| PATCH  | `/exames/{id}/resultado`        | Profissional da unidade                     | Registra o resultado (cifrado), depois da data marcada                   |

### Telemedicina e notificações

| Método | Rota                                        | Perfil                               | Descrição                                            |
| ------ | ------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| POST   | `/consultas/{id}/teleconsulta`              | Profissional da consulta             | Cria a sala no provedor de vídeo (502 se fora do ar) |
| POST   | `/consultas/{id}/teleconsulta/entrada`      | Paciente ou profissional da consulta | Entra na sala e recebe o token temporário            |
| POST   | `/consultas/{id}/teleconsulta/encerramento` | Profissional da consulta             | Encerra a sala e conclui a consulta                  |
| GET    | `/notificacoes?naoLidas=`                   | Autenticado                          | Notificações do próprio usuário                      |
| PATCH  | `/notificacoes/{id}/leitura`                | Autenticado                          | Marca como lida                                      |

### Administração hospitalar e auditoria

| Método | Rota                              | Perfil | Descrição                                                     |
| ------ | --------------------------------- | ------ | ------------------------------------------------------------- |
| GET    | `/leitos`                         | ADMIN  | Lista com filtro de unidade, status e tipo                    |
| GET    | `/leitos/{id}`                    | ADMIN  | Consulta um leito                                             |
| POST   | `/leitos`                         | ADMIN  | Cadastra (começa LIVRE; código único na unidade)              |
| PUT    | `/leitos/{id}`                    | ADMIN  | Atualiza; status manual só entre LIVRE e MANUTENCAO           |
| DELETE | `/leitos/{id}`                    | ADMIN  | Exclui leito sem histórico (com histórico, usar MANUTENCAO)   |
| GET    | `/internacoes`                    | ADMIN  | Lista por situação, unidade e paciente (sem o motivo clínico) |
| POST   | `/internacoes`                    | ADMIN  | Interna o paciente, ocupando um leito livre                   |
| POST   | `/internacoes/{id}/transferencia` | ADMIN  | Transfere: ocupa o destino e libera a origem                  |
| POST   | `/internacoes/{id}/alta`          | ADMIN  | Dá alta e libera o leito                                      |
| GET    | `/suprimentos?estoqueBaixo=`      | ADMIN  | Lista com o alerta de estoque mínimo                          |
| POST   | `/suprimentos`                    | ADMIN  | Cadastra (saldo inicial zero)                                 |
| POST   | `/suprimentos/{id}/movimentacoes` | ADMIN  | Entrada ou saída (409 se a saída exceder o saldo)             |
| GET    | `/financeiro/lancamentos`         | ADMIN  | Lista por unidade, tipo e competência                         |
| POST   | `/financeiro/lancamentos`         | ADMIN  | Registra receita ou despesa (somente inclusão)                |
| GET    | `/relatorios/ocupacao-leitos`     | ADMIN  | Ocupação atual por unidade                                    |
| GET    | `/relatorios/consultas?de=&ate=`  | ADMIN  | Consultas por período e unidade, por status e modalidade      |
| GET    | `/relatorios/financeiro?de=&ate=` | ADMIN  | Receitas, despesas e saldo por período e unidade              |
| GET    | `/auditoria`                      | ADMIN  | Trilha de auditoria filtrada por usuário, ação e período      |

## 3. Exemplos

Os identificadores e datas são reais da execução local com o seed; o token e o e-mail do autocadastro foram encurtados para leitura.

### Login

`POST /auth/login` → **200**

```json
{ "email": "admin@vidaplus.example", "senha": "Vidaplus@2026" }
```

```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "tipo": "Bearer",
    "expiraEm": 3600
  }
}
```

### Autocadastro de paciente

`POST /auth/register` → **201**

```json
{
  "email": "carla.mendes@exemplo.com",
  "senha": "SenhaForte123",
  "nome": "Carla Mendes",
  "cpf": "390.533.447-05",
  "dataNascimento": "1990-05-20",
  "telefone": "(41) 98765-4321",
  "aceiteTermo": true
}
```

```json
{
  "data": {
    "id": "db267348-dd62-4a2b-9cd6-1a67f2c8990d",
    "email": "carla.mendes@exemplo.com",
    "perfil": "PACIENTE"
  }
}
```

### Erro de validação

`POST /auth/register` → **400**

```json
{
  "email": "invalido",
  "senha": "123",
  "nome": "Ana",
  "cpf": "111.111.111-11",
  "dataNascimento": "1990-01-01",
  "aceiteTermo": true
}
```

```json
{
  "error": {
    "code": "VALIDACAO",
    "message": "Dados inválidos. Verifique os campos informados.",
    "details": [
      { "field": "email", "message": "E-mail inválido." },
      {
        "field": "senha",
        "message": "A senha deve ter ao menos 8 caracteres."
      },
      {
        "field": "senha",
        "message": "A senha deve conter ao menos uma letra."
      },
      { "field": "cpf", "message": "CPF inválido." }
    ]
  }
}
```

### Acesso negado

`GET /pacientes` com token de PACIENTE → **403**

```json
{
  "error": {
    "code": "ACESSO_NEGADO",
    "message": "Você não tem permissão para acessar este recurso."
  }
}
```

### Listagem paginada de pacientes (CPF mascarado)

`GET /pacientes?limit=2` (ADMIN) → **200**

```json
{
  "data": [
    {
      "id": "4542170c-52ff-4739-9d19-33b666175e27",
      "nome": "Carla Mendes",
      "cpf": "***.533.447-**",
      "dataNascimento": "1990-05-20",
      "email": "carla.mendes@exemplo.com",
      "ativo": true
    },
    {
      "id": "f0ac7d44-ac94-4d58-9033-7a987df0a608",
      "nome": "João Pereira",
      "cpf": "***.995.350-**",
      "dataNascimento": "1985-04-12",
      "email": "joao.pereira@vidaplus.example",
      "ativo": true
    }
  ],
  "meta": { "page": 1, "limit": 2, "total": 3, "totalPages": 2 }
}
```

### Abertura de horário

`POST /profissionais/{id}/horarios` (a própria médica) → **201**

```json
{ "inicio": "2026-11-23T01:18:20.683Z", "fim": "2026-11-23T01:19:20.683Z" }
```

```json
{
  "data": {
    "id": "49a54c7d-fb61-467b-9db1-ff235366356d",
    "inicio": "2026-11-23T01:18:20.683Z",
    "fim": "2026-11-23T01:19:20.683Z",
    "status": "DISPONIVEL"
  }
}
```

### Agendamento de consulta

`POST /consultas` (PACIENTE) → **201**

```json
{
  "horarioId": "49a54c7d-fb61-467b-9db1-ff235366356d",
  "modalidade": "PRESENCIAL",
  "motivo": "Dor de cabeça frequente"
}
```

```json
{
  "data": {
    "id": "3e010940-7177-4d4c-8881-4a63e06f09c6",
    "status": "AGENDADA",
    "modalidade": "PRESENCIAL",
    "motivoCancelamento": null,
    "criadoEm": "2026-11-23T01:18:12.734Z",
    "paciente": {
      "id": "f0ac7d44-ac94-4d58-9033-7a987df0a608",
      "nome": "João Pereira"
    },
    "unidade": {
      "id": "7f3c1a52-4b8e-4d1a-9c6f-0a1b2c3d4e01",
      "nome": "Hospital VidaPlus Centro"
    },
    "motivo": "Dor de cabeça frequente",
    "inicio": "2026-11-23T01:18:20.683Z",
    "fim": "2026-11-23T01:19:20.683Z",
    "profissional": {
      "id": "a5690847-4a95-42ea-a87e-557c22c59f30",
      "nome": "Dra. Ana Souza",
      "especialidade": "Cardiologia"
    }
  }
}
```

### Registro no prontuário

`POST /consultas/{id}/prontuario` (médica da consulta, após o início) → **201**

```json
{ "conteudo": "Cefaleia tensional. PA 12x8. Orientado sobre hidratação." }
```

```json
{
  "data": {
    "id": "7d67b834-fa90-4669-9b5c-429e0c0a4267",
    "criadoEm": "2026-11-23T01:18:21.905Z",
    "autor": {
      "id": "a5690847-4a95-42ea-a87e-557c22c59f30",
      "nome": "Dra. Ana Souza"
    },
    "conteudo": "Cefaleia tensional. PA 12x8. Orientado sobre hidratação."
  }
}
```

Em seguida, `POST /consultas/{id}/conclusao` → **204** (consulta passa a `REALIZADA`).

### Emissão de receita

`POST /consultas/{id}/receitas` (MEDICO da consulta) → **201**

```json
{
  "itens": [
    {
      "medicamento": "Paracetamol",
      "dosagem": "750 mg",
      "posologia": "1 comprimido a cada 8 horas, se dor",
      "quantidade": 10
    }
  ]
}
```

```json
{
  "data": {
    "id": "ceb85dae-52b3-4098-8848-581e2eeceaf9",
    "consultaId": "3e010940-7177-4d4c-8881-4a63e06f09c6",
    "emitidaEm": "2026-11-23T01:18:21.953Z",
    "observacoes": null,
    "itens": [
      {
        "medicamento": "Paracetamol",
        "dosagem": "750 mg",
        "posologia": "1 comprimido a cada 8 horas, se dor",
        "quantidade": 10
      }
    ],
    "validaAte": "2026-12-22",
    "medico": {
      "id": "a5690847-4a95-42ea-a87e-557c22c59f30",
      "nome": "Dra. Ana Souza",
      "conselho": "CRM",
      "registro": "123456-PR"
    },
    "paciente": {
      "id": "f0ac7d44-ac94-4d58-9033-7a987df0a608",
      "nome": "João Pereira"
    },
    "codigoVerificacao": "Uwbuq1MPWECMP95bqNoS_QN0lY6uaU9pNSEYe93pIqI"
  }
}
```

### Validação da receita pela farmácia

`POST /receitas/validacao` (sem login) → **200**

```json
{ "codigo": "Uwbuq1MPWECMP95bqNoS_QN0lY6uaU9pNSEYe93pIqI" }
```

```json
{
  "data": {
    "situacao": "VALIDA",
    "emitidaEm": "2026-11-23T01:18:21.953Z",
    "validaAte": "2026-12-22",
    "itens": [
      {
        "medicamento": "Paracetamol",
        "dosagem": "750 mg",
        "posologia": "1 comprimido a cada 8 horas, se dor",
        "quantidade": 10
      }
    ],
    "medico": {
      "nome": "Dra. Ana Souza",
      "conselho": "CRM",
      "registro": "123456-PR"
    },
    "paciente": { "nome": "João P." }
  }
}
```

### Teleconsulta: criação da sala e entrada

`POST /consultas/{id}/teleconsulta` (profissional) → **201**

```json
{
  "data": {
    "id": "d86bd71b-9454-4ae7-a451-5299e2f0a8ac",
    "consultaId": "2e36bd4a-0d81-44b4-b99a-5c5ce4a90947",
    "provedor": "simulado",
    "urlSala": "https://video.vidaplus.example/0b03577a-6ab3-4b6b-bffe-5ffd8a7438c3",
    "iniciadaEm": null,
    "encerradaEm": null,
    "criadoEm": "2026-11-23T01:18:12.858Z"
  }
}
```

`POST /consultas/{id}/teleconsulta/entrada` (paciente, dentro da janela) → **200**

```json
{
  "data": {
    "urlSala": "https://video.vidaplus.example/0b03577a-6ab3-4b6b-bffe-5ffd8a7438c3",
    "token": "Pzn08C4m56_Di6XxBrrO1zFjShkWz6poyKQzwgVbQbs",
    "expiraEm": "2026-11-23T02:28:12.780Z"
  }
}
```

### Internação

`POST /internacoes` (ADMIN) → **201**

```json
{
  "pacienteId": "8252e72b-aa94-495a-bc72-f6b7afca1bd1",
  "leitoId": "4508e532-26b9-4bbf-be20-ae16325bc85f",
  "motivo": "Pneumonia comunitária"
}
```

```json
{
  "data": {
    "id": "37cecd81-ce62-42d5-9063-c1cc442a1363",
    "admitidoEm": "2026-11-23T01:18:22.031Z",
    "altaEm": null,
    "paciente": {
      "id": "8252e72b-aa94-495a-bc72-f6b7afca1bd1",
      "nome": "Maria Santos"
    },
    "leito": {
      "id": "4508e532-26b9-4bbf-be20-ae16325bc85f",
      "codigo": "APT-201",
      "ala": "Cirúrgica",
      "unidade": {
        "id": "7f3c1a52-4b8e-4d1a-9c6f-0a1b2c3d4e01",
        "nome": "Hospital VidaPlus Centro"
      }
    }
  }
}
```

### Relatório de ocupação de leitos

`GET /relatorios/ocupacao-leitos` (ADMIN) → **200**

```json
{
  "data": {
    "geradoEm": "2026-11-23T01:18:22.052Z",
    "unidades": [
      {
        "unidade": {
          "id": "7f3c1a52-4b8e-4d1a-9c6f-0a1b2c3d4e01",
          "nome": "Hospital VidaPlus Centro"
        },
        "total": 4,
        "livres": 3,
        "ocupados": 1,
        "manutencao": 0,
        "taxaOcupacao": 25
      }
    ],
    "total": {
      "total": 4,
      "livres": 3,
      "ocupados": 1,
      "manutencao": 0,
      "taxaOcupacao": 25
    }
  }
}
```

### Consentimentos do titular (LGPD)

`GET /pacientes/me/consentimentos` (PACIENTE) → **200**

```json
{
  "data": [
    {
      "id": "9af08016-95dd-46a5-b781-9fe8a2c4b85e",
      "finalidade": "Tratamento de dados pessoais e de saúde para a prestação de serviços de saúde.",
      "versaoTermo": "1.0",
      "concedidoEm": "2026-11-23T01:18:12.617Z",
      "revogadoEm": null
    }
  ]
}
```

### Readiness

`GET /health/ready` → **200** (ou **503** com o banco fora do ar)

```json
{
  "data": {
    "status": "ok",
    "banco": "ok",
    "timestamp": "2026-11-23T01:18:22.064Z"
  }
}
```
