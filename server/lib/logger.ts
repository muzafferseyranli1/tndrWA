import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Gizli değerlerin yanlışlıkla loglanmasını engelle
  redact: ["req.headers.cookie", "req.headers.authorization", "*.password", "*.token", "*.accessToken"],
});
