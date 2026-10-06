export interface DetectedImage {
  ext: "jpg" | "png";
  mime: "image/jpeg" | "image/png";
  width: number | null;
  height: number | null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Dosya uzantısına/MIME'a değil, ilk baytlara bakarak JPEG/PNG olduğunu doğrular ve boyutu okur. */
export function detectImage(buf: Buffer): DetectedImage | null {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    // IHDR: bayt 16-19 genişlik, 20-23 yükseklik
    return { ext: "png", mime: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg", ...jpegSize(buf) };
  }
  return null;
}

function jpegSize(buf: Buffer): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    // SOF0..SOF15 (DHT=C4, JPG=C8, DAC=CC hariç) çerçeve boyutunu taşır
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { width: null, height: null };
}

/** Meta kataloğu için önerilen en küçük kenar (px). Altındaysa uyarı verilir, yükleme reddedilmez. */
export const MIN_RECOMMENDED_SIDE = 500;

export function sizeWarning(img: DetectedImage): string | null {
  if (img.width === null || img.height === null) return null;
  if (img.width < MIN_RECOMMENDED_SIDE || img.height < MIN_RECOMMENDED_SIDE) {
    return `Görsel ${img.width}x${img.height} px. Meta en az ${MIN_RECOMMENDED_SIDE}x${MIN_RECOMMENDED_SIDE} px önerir, daha küçük görseller reddedilebilir.`;
  }
  return null;
}
