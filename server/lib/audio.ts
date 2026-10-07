export interface DetectedAudio {
  ext: "mp3" | "wav" | "ogg" | "m4a";
  mime: string;
}

/** Uzantıya/MIME'a değil ilk baytlara bakarak MP3, WAV, OGG veya M4A olduğunu doğrular. */
export function detectAudio(buf: Buffer): DetectedAudio | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 3).toString("latin1") === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: "mp3", mime: "audio/mpeg" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WAVE") return { ext: "wav", mime: "audio/wav" };
  if (buf.subarray(0, 4).toString("latin1") === "OggS") return { ext: "ogg", mime: "audio/ogg" };
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") return { ext: "m4a", mime: "audio/mp4" };
  return null;
}
