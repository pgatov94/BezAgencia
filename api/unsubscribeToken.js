// Подписан линк за отписване от бюлетина (без вход и без база за токени).
import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  return process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || process.env.ADMIN_PASSCODE || "";
}

export function unsubscribeToken(email) {
  return createHmac("sha256", secret()).update(String(email).toLowerCase()).digest("hex").slice(0, 32);
}

export function tokenOk(email, token) {
  if (!secret() || typeof token !== "string") return false;
  const a = Buffer.from(unsubscribeToken(email));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubscribeUrl(email) {
  return `https://bezagencia.com/api/chat?unsub=1&e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`;
}
