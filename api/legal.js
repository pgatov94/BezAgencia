// Правни действия: запис на избора при поръчка, запис на съгласие за бюлетин,
// отказ от договор (с имейл потвърждение по чл. 49 от Общите условия).
import { supabaseAdmin as supabase } from "./_lib/supabaseAdmin.js";
import { sendEmail, emailWrap } from "./_lib/email.js";

const ADMIN_EMAIL = process.env.CHAT_NOTIFY_EMAIL || "pgatov94@gmail.com";
const ID_RE = /^[A-Z0-9-]{6,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TERMS_VERSION = "1.0";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sofia = (d) => new Date(d).toLocaleString("bg-BG", { timeZone: "Europe/Sofia", dateStyle: "long", timeStyle: "medium" });

const hits = new Map(); // грубо ограничение по IP
function limited(req, max, windowMs) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "x";
  const now = Date.now();
  const rec = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  rec.push(now); hits.set(ip, rec);
  return rec.length > max;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (limited(req, 30, 3600 * 1000)) return res.status(429).json({ error: "Твърде много опити. Опитай по-късно." });
  const b = req.body && typeof req.body === "object" ? req.body : {};

  try {
    /* ── Избор при поръчка (отметки): записва се преди плащането ── */
    if (b.action === "recordConsent") {
      const id = String(b.inquiryId || "").trim().toUpperCase();
      if (!ID_RE.test(id)) return res.status(400).json({ error: "Невалиден номер." });
      if (b.acceptedTerms !== true || b.over18 !== true) return res.status(400).json({ error: "Липсва потвърждение на Общите условия." });
      const startNow = b.startBeforeWithdrawal === true;
      const lose = b.acknowledgeLoss === true;
      if (!startNow || !lose) return res.status(400).json({ error: "Отбележи и двете полета за началото на изпълнението, за да продължиш." });

      const { data: pay } = await supabase.from("payments").select("data").eq("id", id).maybeSingle();
      if (!pay) return res.status(404).json({ error: "Не намираме плащане по този номер." });
      if (pay.data?.paid) return res.status(409).json({ error: "Плащането вече е извършено." });

      const rec = {
        termsVersion: TERMS_VERSION,
        acceptedAt: new Date().toISOString(),
        acceptedTerms: true,
        over18: true,
        startBeforeWithdrawal: startNow,
        acknowledgeLoss: startNow ? lose : false,
        amountShown: pay.data?.amount ?? null,
      };
      const { error } = await supabase.from("order_consents").upsert({ id, data: rec, updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    /* ── Съгласие за бюлетин (доказателство: дата и начин) ── */
    if (b.action === "newsletterConsent") {
      const email = String(b.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Невалиден имейл." });
      const { data: row } = await supabase.from("newsletter_subscribers").select("data").eq("id", email).maybeSingle();
      if (!row) return res.status(404).json({ error: "Абонатът не е намерен." });
      const data = { ...(row.data || {}), consent: { at: new Date().toISOString(), method: "Отметка във формата „Абонирай се“ на bezagencia.com", policyVersion: "1.0" } };
      await supabase.from("newsletter_subscribers").upsert({ id: email, data, updated_at: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }

    /* ── Отказ от договора ── */
    if (b.action === "withdraw") {
      const id = String(b.inquiryId || "").trim().toUpperCase();
      const email = String(b.email || "").trim().toLowerCase();
      const name = String(b.name || "").trim().slice(0, 120);
      if (!ID_RE.test(id) || !EMAIL_RE.test(email) || !name) return res.status(400).json({ error: "Попълни номера на поръчката, името и имейла си." });

      const [{ data: inq }, { data: pay }] = await Promise.all([
        supabase.from("inquiries").select("data").eq("id", id).maybeSingle(),
        supabase.from("payments").select("data").eq("id", id).maybeSingle(),
      ]);
      const inqEmail = String(inq?.data?.email || "").trim().toLowerCase();
      if (!inq || !pay?.data?.paid || inqEmail !== email) {
        return res.status(404).json({ error: "Не намираме сключен договор с тези данни. Провери номера и имейла или ни пиши на pgatov94@gmail.com." });
      }

      const { data: existing } = await supabase.from("withdrawals").select("data").eq("id", id).maybeSingle();
      const at = existing?.data?.at || new Date().toISOString();
      if (!existing) {
        const { error } = await supabase.from("withdrawals").upsert({ id, data: { at, name, email, amount: pay.data.amount ?? null }, updated_at: new Date().toISOString() });
        if (error) throw error;
      }
      const { data: cons } = await supabase.from("order_consents").select("data").eq("id", id).maybeSingle();

      // Потвърждение до клиента (чл. 49) — съдържание на изявлението, дата и час
      try {
        await sendEmail({
          to: email,
          subject: `Потвърждение за получен отказ от договор № ${id}`,
          html: emailWrap("Получихме отказа ти", `
            <p style="margin:0 0 12px;">Здравей, ${esc(name)}.</p>
            <p style="margin:0 0 12px;">Потвърждаваме, че получихме твоето изявление за отказ от договора по поръчка № <strong>${esc(id)}</strong>.</p>
            <div style="background:#f7f5f0;color:#0F172A;padding:12px 14px;border-radius:10px;font-size:15px;line-height:1.6;margin:0 0 14px;">
              <strong>Изявление:</strong> „Отказвам се от договора за предоставяне на консултантска услуга по поръчка № ${esc(id)}.“<br>
              <strong>Име:</strong> ${esc(name)}<br><strong>Имейл:</strong> ${esc(email)}<br>
              <strong>Подадено на:</strong> ${esc(sofia(at))} (българско време)
            </div>
            <p style="margin:0;">Ще обработим отказа и ще уредим връщането на дължимите суми по реда на Общите условия — не по-късно от 14 дни от подаването му, по същия платежен метод.</p>`),
        });
      } catch (e) { console.error("withdraw confirm mail:", e?.message); }

      // Известие към теб
      try {
        await sendEmail({
          to: ADMIN_EMAIL,
          subject: `⚠️ Отказ от договор № ${id}`,
          replyTo: email,
          html: emailWrap("Отказ от договор", `
            <p style="margin:0 0 10px;"><strong>${esc(name)}</strong> (${esc(email)}) се отказа от договора по поръчка <strong>${esc(id)}</strong>.</p>
            <div style="background:#f7f5f0;color:#0F172A;padding:12px 14px;border-radius:10px;font-size:15px;line-height:1.6;">
              Подадено: ${esc(sofia(at))}<br>
              Платена сума: ${esc(pay.data.amount ?? "—")} €<br>
              Поискал изпълнение преди края на срока за отказ: <strong>${cons?.data?.startBeforeWithdrawal ? "ДА (дължи се пропорционална част по чл. 52)" : "НЕ (връща се цялата сума по чл. 53)"}</strong>
            </div>
            <p style="margin:14px 0 0;">Върни сумата през Stripe в срок до 14 дни.</p>`),
        });
      } catch (e) { console.error("withdraw admin mail:", e?.message); }

      return res.status(200).json({ ok: true, at, atText: sofia(at), already: !!existing });
    }

    return res.status(400).json({ error: "Непознато действие." });
  } catch (e) {
    console.error("legal api:", e?.message || e);
    return res.status(500).json({ error: "Грешка на сървъра." });
  }
}
