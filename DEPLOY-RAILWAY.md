# Деплой на Railway — пошагово

## 1. Переменные (Variables)

| Имя | Значение |
|-----|----------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | случайная строка 32+ символа |

`PORT` Railway задаёт **сам** — не меняйте и не удаляйте.

## 2. Публичный домен (важно!)

1. **Settings → Networking**
2. Удалите старый домен (иконка корзины), если был создан с неверным портом
3. **Generate Domain**
4. В поле **Port** введите число из **Variables → PORT** (часто `8080`, не `3000` и не `80800`)

Если порт домена ≠ `PORT` приложения → ошибка **Application failed to respond**.

## 3. Проверка

После зелёного деплоя:

- `https://ВАШ-ДОМЕН.up.railway.app/health` → `ok`
- `https://ВАШ-ДОМЕН.up.railway.app/` → сайт

## 4. Логи

**Deployments → View logs** — ищите:

```text
[startup] PORT=8080 → listen 8080
[startup] Порт 8080 открыт
Сервер готов: https://...
```

## 5. Админ

- Email: `admin@niko.ru`
- Пароль: `admin123`
