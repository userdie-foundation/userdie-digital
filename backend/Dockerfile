FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/v1/health/live').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["npm", "start"]
