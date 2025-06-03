# Blockinar Scraper Service

Microservicio en Node.js/Playwright que hace scraping de activos en Blockinar y expone un endpoint HTTP.

## Setup
1. Clona el repositorio.
2. Ejecuta `npm install`.
3. Crea un archivo `.env` basado en `.env.example` con tus credenciales.
4. Ejecuta `npm start`.

## Endpoints
- `GET /health`: chequeo alive.
- `GET /data`: devuelve NDJSON con el histórico de scrapes.

## Deploy en Render
- Build Command: `npm install && npx playwright install chromium`
- Start Command: `npm start`
- Variables de entorno: `BLOCKINAR_EMAIL`, `BLOCKINAR_PASSWORD`

