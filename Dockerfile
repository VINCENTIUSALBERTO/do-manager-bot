# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runner
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn
WORKDIR /app

# Run as the unprivileged "node" user shipped with the official image.
RUN apk add --no-cache tini

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
