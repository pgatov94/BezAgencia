// Проверка на админ паролата САМО на сървъра. В кода на сайта няма парола.
import { timingSafeEqual } from "node:crypto";

const fails = new Map(); // грубо ограничение по IP (в рамките на инстанцията)

function passOk(given) {
  const real = process.env.ADMIN_PASSCODE || "";
  if (!real || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const rec = fails.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - rec.t > 15 * 60 * 1000) { rec.n = 0; rec.t = Date.now(); }
  if (rec.n >= 8) return res.status(429).json({ error: "Твърде много опити. Опитай след 15 минути." });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (passOk(body.passcode)) {
    fails.delete(ip);
    return res.status(200).json({ ok: true });
  }
  rec.n += 1; fails.set(ip, rec);
  await new Promise((r) => setTimeout(r, 800));
  return res.status(401).json({ error: "Грешна парола." });
}
