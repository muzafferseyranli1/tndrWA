FROM node:22-alpine

# curl: Coolify sağlık kontrolü için; openssl: Prisma motoru için
RUN apk add --no-cache curl openssl

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Derleme için devDependencies gerekli (TypeScript, Tailwind)
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
# Not: gizli değerler build sırasında verilmez (ARG yok); yalnızca çalışma zamanında ortamdan okunur.
RUN npx prisma generate && npx next build

# Kalıcı veri (SQLite + yüklenen görseller): Coolify > Persistent Storage'da /data için volume tanımlayın
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
ENTRYPOINT ["sh", "./entrypoint.sh"]
