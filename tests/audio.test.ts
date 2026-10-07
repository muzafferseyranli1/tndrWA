import assert from "node:assert/strict";
import { test } from "node:test";
import { detectAudio } from "../server/lib/audio";

const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);

test("ses türü ilk baytlardan tanınır", () => {
  assert.equal(detectAudio(Buffer.concat([Buffer.from("ID3"), Buffer.alloc(16)]))?.ext, "mp3");
  assert.equal(detectAudio(pad([0xff, 0xfb, 0x90, 0x00]))?.ext, "mp3");
  assert.equal(detectAudio(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(4)]))?.ext, "wav");
  assert.equal(detectAudio(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(16)]))?.ext, "ogg");
  assert.equal(detectAudio(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A "), Buffer.alloc(8)]))?.ext, "m4a");
});

test("ses olmayan dosya (görsel, metin, kısa) reddedilir", () => {
  assert.equal(detectAudio(pad([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(detectAudio(Buffer.from("merhaba dunya, bu bir metin")), null);
  assert.equal(detectAudio(Buffer.from("ID3")), null);
});
