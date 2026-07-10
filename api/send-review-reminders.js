// Vercel Cron Job — веднъж дневно проверява всички платени запитвания,
// чиято крайна дата на пътуване (dateTo) вече е минала, и ако още не сме
// пращали покана за отзив, изпраща имейл с линк, който автоматично
// зарежда номера на резервацията в страница "Отзиви".
//
// Настройка в Vercel:
//   1. vercel.json вече казва на Vercel да вика тази функция веднъж дневно.
//   2. Изисква SUPABASE_SERVICE_ROLE_KEY (виж api/_lib/supabaseAdmin.js) —
//      същата стойност, която вече си добавил за stripe-webhook.js.
//   3. (Препоръчително) CRON_SECRET — Vercel автоматично я праща като
//      "Authorization: Bearer <CRON_SECRET>" при всяко cron извикване.

import { supabaseAdmin as supabase } from "./_lib/supabaseAdmin.js";
import { sendEmail, emailWrap } from "./_lib/email.js";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const today = todayStr();
  const sent = [];
  const errors = [];

  try {
    const { data: payments, error: payErr } = await supabase.from("payments").select("id, data");
    if (payErr) throw payErr;

    const eligiblePayments = (payments || []).filter((p) => {
      const d = p.data || {};
      return d.paid === true && !d.reviewed && !d.reviewEmailSent;
    });

    for (const p of eligiblePayments) {
      try {
        const { data: inqRow, error: inqErr } = await supabase
          .from("inquiries")
          .select("data")
          .eq("id", p.id)
          .maybeSingle();
        if (inqErr || !inqRow?.data) continue;

        const inq = inqRow.data;
        if (!inq.dateTo || inq.dateTo > today) continue;
        if (!inq.email) continue;

        const link = `https://bezagencia.com/?review=${encodeURIComponent(p.id)}`;
        const ok = await sendEmail({
          to: inq.email,
          subject: "Как мина пътуването? Остави отзив и вземи 10% отстъпка",
          html: emailWrap(
            "Разкажи ни за пътуването",
            `
            <p style="margin:0 0 14px;">Здравей ${inq.name || ""},</p>
            <p style="margin:0 0 20px;">Надяваме се пътуването до ${inq.city || ""}${inq.country ? `, ${inq.country}` : ""} е минало страхотно! Отдели минута да оставиш отзив — в замяна получаваш код за 10% отстъпка от комисионната при следващото си пътуване.</p>
            <p style="text-align:center;margin:0 0 22px;">
              <a href="${link}" style="display:inline-block;background:#D4AF37;color:#0A0E17;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:15px;">Остави отзив</a>
            </p>
            <p style="margin:0;font-size:14.5px;color:#8E99AE;">Номерът на резервацията (${p.id}) вече е попълнен автоматично, когато отвориш линка.</p>
            `
          ),
        });

        await supabase
          .from("payments")
          .update({ data: { ...p.data, reviewEmailSent: true, reviewEmailSentAt: Date.now(), reviewEmailOk: ok } })
          .eq("id", p.id);

        if (ok) sent.push(p.id); else errors.push({ id: p.id, reason: "Resend отказа изпращането" });
      } catch (e) {
        errors.push({ id: p.id, reason: e.message });
      }
    }

    res.status(200).json({ ok: true, checked: eligiblePayments.length, sent, errors });
  } catch (e) {
    res.status(500).json({ error: e.message || "Неизвестна грешка." });
  }
}
