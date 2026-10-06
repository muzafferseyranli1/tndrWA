// Yönetici şifresini sorar (ekrana yazmaz), hash'ini .env dosyasına yazar.
// Şifre hiçbir yere düz metin olarak kaydedilmez ve ekrana basılmaz.
// Çalıştırma: npm run admin:password

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import { hashPassword } from "../server/lib/password";

const ENV_PATH = ".env";
const MIN_LENGTH = 10;

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const state = rl as unknown as { stdoutMuted: boolean; _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    process.stdout.write(question);
    state.stdoutMuted = true;
    state._writeToOutput = (s: string) => {
      if (!state.stdoutMuted || s.includes("\n") || s.includes("\r")) state.output.write(s);
    };
    rl.question("", (answer) => {
      state.stdoutMuted = false;
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function setKey(content: string, key: string, value: string, eol: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) return content.replace(re, line);
  const sep = content.length && !content.endsWith("\n") ? eol : "";
  return `${content}${sep}${line}${eol}`;
}

async function main() {
  const password = await askHidden("Yeni yönetici şifresi (en az 10 karakter): ");
  if (password.length < MIN_LENGTH) {
    console.error(`Şifre en az ${MIN_LENGTH} karakter olmalı. Hiçbir şey değiştirilmedi.`);
    process.exit(1);
  }
  const again = await askHidden("Şifreyi tekrar yazın: ");
  if (password !== again) {
    console.error("Şifreler uyuşmuyor. Hiçbir şey değiştirilmedi.");
    process.exit(1);
  }

  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const eol = content.includes("\r\n") ? "\r\n" : "\n";

  content = setKey(content, "ADMIN_PASSWORD_HASH", await hashPassword(password), eol);
  if (!/^ADMIN_USERNAME=.+$/m.test(content)) content = setKey(content, "ADMIN_USERNAME", "admin", eol);
  if (!/^SESSION_SECRET=.{32,}$/m.test(content)) content = setKey(content, "SESSION_SECRET", randomBytes(48).toString("base64url"), eol);
  if (!/^DATABASE_URL=.+$/m.test(content)) content = setKey(content, "DATABASE_URL", "file:./dev.db", eol);

  writeFileSync(ENV_PATH, content);
  console.log("Tamam: .env güncellendi (ADMIN_PASSWORD_HASH, SESSION_SECRET, ADMIN_USERNAME, DATABASE_URL). Diğer satırlara dokunulmadı.");
}

main();
