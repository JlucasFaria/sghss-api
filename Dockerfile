# Imagem da API do SGHSS (RNF13). Multi-stage: as ferramentas de build ficam nos
# estágios intermediários e a imagem final leva só o necessário para rodar.
#   docker build -t sghss-api .
ARG BUN_VERSION=1.3.14

# ---------- deps: todas as dependências e o Prisma Client gerado ----------
# Também usado como imagem das migrations (tem a CLI do Prisma, que é dependência de dev)
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
# O schema e a configuração são necessários ao "prisma generate" do postinstall
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN bun install --frozen-lockfile

# ---------- prod-deps: só as dependências de execução ----------
FROM oven/bun:${BUN_VERSION}-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
# Sem peers opcionais: o @prisma/client declara a CLI do Prisma e o TypeScript como
# peers, que só servem para gerar o client (já gerado no estágio deps)
RUN bun install --frozen-lockfile --production --ignore-scripts --omit=peer

# ---------- runtime: imagem final ----------
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=deps /app/generated ./generated
COPY package.json tsconfig.json ./
COPY src ./src

# Usuário sem privilégios, já existente na imagem oficial do Bun
USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

CMD ["bun", "src/index.ts"]
