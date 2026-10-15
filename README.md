# Ozon A/B

Веб-приложение для A/B-тестов карточек Ozon: ротация фото/названия через Seller API, заказы из отгрузок, рекламная статистика через Performance API.

## Self-host (Docker)

1. Скопируйте `env.example` в `.env` и задайте секреты и публичный `https://` адрес.
2. `docker compose up -d --build`
3. Откройте адрес из `APP_URL`, зарегистрируйтесь по почте и паролю.
4. В «Магазины» вставьте Seller API ключи. Для рекламы — отдельно Client ID / Secret Performance API.

Ротация идёт **внутри процесса** каждые 20 секунд. Вкладку держать открытой не нужно. Дополнительно можно дергать:

```
curl -H "Authorization: Bearer $CRON_SECRET" https://ab.example.com/api/cron/tick
```

Проверка живности: `GET /api/health`

## Без Docker

Нужны Node 22 и Postgres.

```
cp env.example .env
# заполните DATABASE_URL, BETTER_AUTH_SECRET, APP_URL, BETTER_AUTH_URL
npm ci
NITRO_PRESET=node-server npm run build:selfhost
npm run db:migrate
HOST=0.0.0.0 PORT=8080 npm start
```

## Что важно

- **BETTER_AUTH_SECRET** не меняйте после первого запуска — иначе ключи магазинов не расшифруются.
- **APP_URL** должен быть доступен из интернета: Ozon качает загруженные фото по этому адресу.
- Органические просмотры карточки — только Premium Plus. Заказы собираются без Premium. Реклама — Performance API.
- Ozon не делит трафик по вариантам: тест идёт **временной ротацией**.

## Переменные

| Переменная | Зачем |
|---|---|
| `DATABASE_URL` | Postgres |
| `BETTER_AUTH_SECRET` | Сессии + шифрование ключей Ozon |
| `BETTER_AUTH_URL` / `APP_URL` | Публичный origin |
| `CRON_SECRET` | Защита ручного тика |
| `AUTH_TRUSTED_ORIGINS` | Доп. origin для входа |
| `NITRO_PRESET=node-server` | Сборка под свой сервер, не Vercel |
