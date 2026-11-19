# RMS müşteri robotu

Her gün 04:30'da (Türkiye saati) RMS'e (suitablerms.com) girer, **Sadakat Yönetimi › Müşteriler › Excel'e Aktar** ile tüm müşteri listesini indirir ve yrndWA paneline gönderir.
Panel telefona göre birleştirir: yeni müşteri ekler, yeni adresleri adres listesine ekler, var olan dolu bilgilerin üzerine yazmaz.
Hata olursa panelde **Müşteriler** sayfasının üstünde uyarı görünür.

## Kurulum (Coolify)
1. **Panel uygulamasına** gizli ortam değişkeni ekleyin: `IMPORT_TOKEN` = uzun rastgele metin, sonra yeniden dağıtın.
2. Yeni uygulama: aynı depo, **Base Directory `/robot`**, Build Pack **Dockerfile**. Port gerekmez, alan adı verilmez.
3. Robot uygulamasına gizli ortam değişkenleri: `RMS_USER`, `RMS_PASS` (RMS'te yalnız bu iş için açılmış kullanıcı), `IMPORT_TOKEN` (panelle aynı), isteğe bağlı `PANEL_URL`, `RUN_AT`.
4. İlk denemede `RUN_ON_START=1` ekleyin (açılışta hemen çalışır), sonuç panelde görününce kaldırın.

## Elle deneme (kendi bilgisayarınızda, PowerShell)
```powershell
cd robot; npm install; npx playwright install chromium
$env:RMS_USER="..."; $env:RMS_PASS="..."; $env:IMPORT_TOKEN="..."; $env:HEADED="1"
node rms-customers.mjs --once
```
