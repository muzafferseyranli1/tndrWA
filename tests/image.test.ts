import assert from "node:assert/strict";
import { test } from "node:test";
import { detectImage, sizeWarning } from "../server/lib/image";

export function makePng(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

export function makeJpeg(width: number, height: number): Buffer {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0", "ascii"), Buffer.alloc(9)]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

test("PNG ilk baytlardan tanınır, boyut okunur", () => {
  const img = detectImage(makePng(800, 600));
  assert.deepEqual(img, { ext: "png", mime: "image/png", width: 800, height: 600 });
});

test("JPEG ilk baytlardan tanınır, boyut okunur", () => {
  const img = detectImage(makeJpeg(1200, 900));
  assert.deepEqual(img, { ext: "jpg", mime: "image/jpeg", width: 1200, height: 900 });
});

test("uzantısı resim gibi ama içeriği resim olmayan dosya reddedilir", () => {
  assert.equal(detectImage(Buffer.from("<html><script>alert(1)</script></html>")), null);
  assert.equal(detectImage(Buffer.from("GIF89a....................")), null);
  assert.equal(detectImage(Buffer.alloc(0)), null);
  assert.equal(detectImage(Buffer.from([0xff, 0xd8])), null);
});

test("500 px altı görsel için uyarı verilir, üstü için verilmez", () => {
  assert.match(sizeWarning(detectImage(makePng(400, 400))!) ?? "", /500x500/);
  assert.match(sizeWarning(detectImage(makeJpeg(1000, 300))!) ?? "", /1000x300/);
  assert.equal(sizeWarning(detectImage(makePng(500, 500))!), null);
});
