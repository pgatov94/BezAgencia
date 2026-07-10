// Vercel Cron Job — веднъж дневно проверява всички платени запитвания,
// чиято крайна дата на пътуване (dateTo) вече е минала, и ако още не сме
// пращали покана за отзив, изпраща имейл с линк, който автоматично
// зарежда номера на резервацията в страница "Отзиви". Ако клиентът остави
// отзив, автоматично получава ваучер за 10% отстъпка (виж App.jsx,
// handleSubmitReview — тази логика вече съществуваше и не е променяна).
//
// Настройка в Vercel:
//   1. Добави vercel.json (виж файла в корена на проекта) — той казва
//      на Vercel да вика тази функция веднъж дневно.
//   2. (Препоръчително) Добави Environment Variable CRON_SECRET с произволна
//      дълга случайна стойност — Vercel автоматично я праща като
//      "Authorization: Bearer <CRON_SECRET>" при всяко cron извикване,
//      а тази функция я проверява, за да не може случаен посетител
//      да задейства масово изпращане на имейли по всички клиенти.
//   3. Изисква SUPABASE_URL/VITE_SUPABASE_URL и
//      SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY (вече ги имаш зададени
//      за клиентската част — тази функция ги чете директно от
//      process.env, така че не трябва да добавяш нищо ново, освен
//      евентуално CRON_SECRET).

import { createClient } from "@supabase/supabase-js";
import { sendEmail, emailWrap } from "./email.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  // Защита: само Vercel Cron (или някой с CRON_SECRET) може да задейства.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ error: "Липсват SUPABASE_URL / SUPABASE_ANON_KEY в Environment Variables." });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
        // Само за пътувания с точна крайна дата (не "гъвкав, най-изгодна цена
        // през месец X" — там няма точна дата, от която да броим).
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
            <p style="margin:0;font-size:12.5px;color:#8E99AE;">Номерът на резервацията (${p.id}) вече е попълнен автоматично, когато отвориш линка.</p>
            `
          ),
        });

        // Маркираме като изпратено независимо от резултата от Resend,
        // за да не се опитваме безкрайно всеки ден при трайна грешка
        // (напр. невалиден имейл) — грешките се връщат в отговора за преглед.
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
