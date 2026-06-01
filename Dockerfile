FROM node:20-bookworm-slim

WORKDIR /app

# Сборка нативного модуля better-sqlite3
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# SESSION_SECRET и прочие переменные задаются при запуске контейнера
CMD ["npm", "start"]
