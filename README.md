# База отдыха «Нико» — веб-сайт

Полнофункциональный сайт базы активного отдыха: бронирование, личный кабинет, админ-панель, отзывы.

**Стек:** Node.js, Express, EJS, SQLite (better-sqlite3), Tailwind CSS 4, Vite.

## Возможности

- 9+ страниц: главная, услуги, бронирование, галерея, контакты, профиль, админка и др.
- Онлайн-бронирование и оплата (демо-логика)
- Личный кабинет и админ-панель
- Отзывы, мероприятия, сертификаты, чат поддержки
- Хеширование паролей (bcrypt), cookie-сессии

## Локальный запуск

**Требования:** Node.js 18+

```bash
npm install
cp .env.example .env
# Отредактируйте .env при необходимости
npm run dev
```

Сайт: [http://localhost:3000](http://localhost:3000)

**Админ по умолчанию** (создаётся при первом запуске):

| Поле    | Значение        |
|---------|-----------------|
| Email   | `admin@niko.ru` |
| Пароль  | `admin123`      |

Смените пароль после первого входа.

## Публикация на GitHub

```bash
cd "путь/к/проекту"
git init
git add .
git commit -m "Initial commit: сайт базы отдыха Нико"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/niko-base.git
git push -u origin main
```

На GitHub создайте **пустой** репозиторий (без README), затем выполните команды выше.

> В репозиторий не попадают: `.env`, база `*.db`, `node_modules`, `dist` — они перечислены в `.gitignore`.

## Деплой на хостинг (VPS / VPS + Nginx)

### 1. Клонирование и сборка на сервере

```bash
git clone https://github.com/ВАШ_ЛОГИН/niko-base.git
cd niko-base
npm install
cp .env.example .env
nano .env
```

Обязательно в `.env` на сервере:

```env
NODE_ENV=production
PORT=3000
APP_URL=https://ваш-домен.ru
SESSION_SECRET=длинная-случайная-строка-32+символов
```

Сгенерировать секрет:

```bash
openssl rand -base64 32
```

Сборка фронтенда и запуск:

```bash
npm run build
npm start
```

Для постоянной работы используйте **PM2**:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 2. Nginx + SSL

Пример конфигурации: [`deploy/nginx.conf.example`](deploy/nginx.conf.example)

```bash
sudo certbot --nginx -d ваш-домен.ru
```

### 3. База данных

SQLite-файл `niko.db` создаётся автоматически при первом запуске. Для постоянного хранения на VPS укажите путь вне репозитория:

```env
DATABASE_PATH=/var/lib/niko-base/niko.db
```

Регулярно делайте резервную копию этого файла.

## Docker

```bash
docker build -t niko-base .
docker run -d \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e SESSION_SECRET=ваш-секрет \
  -e APP_URL=https://ваш-домен.ru \
  -v niko-data:/app/data \
  -e DATABASE_PATH=/app/data/niko.db \
  --name niko-base \
  niko-base
```

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `NODE_ENV` | `production` на сервере |
| `PORT` | Порт (по умолчанию 3000) |
| `APP_URL` | Публичный URL сайта |
| `SESSION_SECRET` | **Обязательно** в production |
| `DATABASE_PATH` | Путь к SQLite (опционально) |
| `GEMINI_API_KEY` | AI-функции (опционально) |
| `SMTP_HOST` | SMTP-сервер (опционально, подбирается по домену) |
| `SMTP_USER` / `SMTP_PASS` | Логин и пароль SMTP |
| `SMTP_PROVIDER` | `gmail`, `yandex`, `mailru`, `outlook` и др. |
| `ADMIN_EMAIL` | Почта админа (можно несколько через запятую) |

Полный список: [`.env.example`](.env.example)

## Скрипты npm

| Команда | Назначение |
|---------|------------|
| `npm run dev` | Разработка (Express + Vite HMR) |
| `npm run build` | Сборка статики в `dist/` |
| `npm start` | Production-запуск |
| `npm run lint` | Проверка TypeScript |

## Структура проекта

```
├── server.ts          # Express-сервер и API
├── views/             # EJS-шаблоны страниц
├── src/               # React/Vite (вспомогательные ресурсы)
├── ecosystem.config.cjs
├── Dockerfile
└── deploy/nginx.conf.example
```
