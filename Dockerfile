FROM node:24-slim

WORKDIR /app

COPY package*.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY config/ ./config/
COPY skills/ ./skills/
COPY system-prompt.md ./

RUN mkdir -p /app/data /app/vault/documents /app/vault/receipts /app/vault/id_cards /app/vault/media

ENV NODE_ENV=production
ENV PORT=4500
ENV DB_PATH=/app/data/bot.db

EXPOSE 4500

CMD ["node", "--env-file=/app/.env", "src/index.js"]
