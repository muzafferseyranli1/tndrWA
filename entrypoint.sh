#!/bin/sh
# Migration başarısız olursa başlatmayı DURDURUR (sessizce geçmez).
set -e

echo "[entrypoint] veritabanı migration uygulanıyor..."
npx prisma migrate deploy
echo "[entrypoint] migration tamam."

# Boş veritabanında menüyü bir kez yükler (ürün varsa dokunmaz)
echo "[entrypoint] başlangıç menüsü kontrol ediliyor..."
npx tsx prisma/seed.ts --if-empty
echo "[entrypoint] sunucu başlıyor."

exec npm start
