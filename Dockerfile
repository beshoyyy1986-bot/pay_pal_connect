# صورة جاهزة فيها Chromium + كل مكتبات Playwright
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app
ENV NODE_ENV=production
ENV HEADLESS=true

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
