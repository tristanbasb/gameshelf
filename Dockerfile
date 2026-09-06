# syntax=docker/dockerfile:1

# --------------------------------------------------------------------------
# Etape 1 : dependances.
# better-sqlite3 fournit des binaires precompiles pour la plupart des
# plateformes ; les outils de compilation ne servent que de filet de securite.
# --------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# --------------------------------------------------------------------------
# Etape 2 : image finale
# --------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# openssl : generation du certificat local (scan par camera).
# curl    : sonde de sante.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl curl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/data/uploads && chown -R node:node /app

USER node
EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "src/server.js"]
