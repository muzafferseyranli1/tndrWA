#!/bin/sh
# Migration başarısız olursa başlatmayı DURDURUR (sessizce geçmez).
set -e

echo "[entrypoint] veritabanı migration uygulanıyor..."
npx prisma migrate deploy
echo "[entrypoint] migration tamam, sunucu başlıyor."

exec npm start
