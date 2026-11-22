# SGHSS API — VidaPlus

API REST do **Sistema de Gestão Hospitalar e de Serviços de Saúde (SGHSS)** da instituição VidaPlus, que administra hospitais, clínicas de bairro, laboratórios e equipes de home care.

Projeto desenvolvido para a disciplina de Projeto Multidisciplinar (UNINTER), com ênfase em **Back-end**.

## Objetivo

Centralizar em uma única API segura:

- cadastro e atendimento de pacientes (consultas, exames, prontuários);
- gestão de profissionais de saúde (agendas e prescrições);
- administração hospitalar (leitos, internações, relatórios);
- telemedicina (teleconsultas e prescrições online);
- segurança e compliance (controle de acesso por perfil, auditoria e LGPD).

## Stack

| Camada         | Tecnologia                           |
| -------------- | ------------------------------------ |
| Runtime        | [Bun](https://bun.sh)                |
| Framework HTTP | [Hono](https://hono.dev)             |
| Banco de dados | PostgreSQL 16 (Docker)               |
| ORM            | Prisma 7 com adapter `pg`            |
| Testes         | `bun:test`                           |
| Qualidade      | TypeScript estrito, ESLint, Prettier |
| CI             | GitHub Actions                       |

## Como rodar

Pré-requisitos: [Bun](https://bun.sh) 1.3+ e [Docker](https://www.docker.com).

```bash
# 1. Instalar dependências (gera o Prisma Client automaticamente)
bun install

# 2. Criar o arquivo de variáveis de ambiente
cp .env.example .env

# 3. Subir o PostgreSQL
bun run db:up

# 4. Aplicar as migrations e popular o banco com dados fictícios
bun run db:deploy
bun run db:seed

# 5. Iniciar a API em modo desenvolvimento
bun run dev
```

A API sobe em `http://localhost:3000`. Para verificar: `GET /health`.

### Testes

Os testes de integração usam um banco separado (`sghss_test`), que é esvaziado a cada teste.

```bash
# 1. Criar o arquivo de ambiente dos testes (ajuste a senha conforme o .env)
cp .env.test.example .env.test

# 2. Criar o banco de testes e aplicar as migrations
bun run db:test:prepare

# 3. Executar os testes
bun test
```

## Scripts

| Script                    | Descrição                                     |
| ------------------------- | --------------------------------------------- |
| `bun run dev`             | Inicia a API com recarga automática           |
| `bun run start`           | Inicia a API                                  |
| `bun test`                | Executa os testes                             |
| `bun run lint`            | Verifica o código com ESLint                  |
| `bun run lint:fix`        | Corrige automaticamente problemas do ESLint   |
| `bun run format`          | Formata o código com Prettier                 |
| `bun run format:check`    | Verifica a formatação                         |
| `bun run typecheck`       | Verifica os tipos com TypeScript              |
| `bun run db:up`           | Sobe o PostgreSQL e aguarda ficar saudável    |
| `bun run db:stop`         | Para o container (mantém os dados)            |
| `bun run db:down`         | Remove o container (mantém o volume)          |
| `bun run db:logs`         | Acompanha os logs do PostgreSQL               |
| `bun run db:generate`     | Gera o Prisma Client                          |
| `bun run db:migrate`      | Cria e aplica migrations em desenvolvimento   |
| `bun run db:deploy`       | Aplica migrations pendentes (CI/produção)     |
| `bun run db:seed`         | Popula o banco com dados fictícios (dev)      |
| `bun run db:studio`       | Abre o Prisma Studio                          |
| `bun run db:test:prepare` | Cria o banco de testes e aplica as migrations |
| `bun run docs:diagramas`  | Gera os PNGs dos diagramas PlantUML (Docker)  |

## Estrutura

```
src/
├── api/<dominio>/   # rotas, regras de negócio, schemas e testes por domínio
├── db/              # cliente Prisma
├── test/            # helpers de teste (reset do banco e factories)
├── app.ts           # composição da aplicação (usada nos testes)
└── index.ts         # ponto de entrada do servidor
prisma/              # schema e migrations
```
