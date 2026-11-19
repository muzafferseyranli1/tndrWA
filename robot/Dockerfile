# Tarayıcısı hazır Playwright görüntüsü (sürüm package.json'daki playwright ile aynı olmalı)
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY rms-customers.mjs ./
ENV NODE_ENV=production
CMD ["node", "rms-customers.mjs"]
