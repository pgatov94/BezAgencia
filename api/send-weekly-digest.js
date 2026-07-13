// Vercel Cron Job — изпраща обобщен имейл до всички абонати за бюлетина
// ВСЕКИ ПЕТЪК (не при всяко качване на оферта, за да не се получава спам).
// Изброява текущите публикувани оферти с линк към пълния списък.
//
// Настройка в Vercel: вече е добавен в vercel.json — вика се веднъж
// седмично, в петък.

import { supabaseAdmin as supabase } from "./_lib/supabaseAdmin.js";
import { sendEmail, emailWrap } from "./_lib/email.js";

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  try {
    const { data: subs, error: subsErr } = await supabase.from("newsletter_subscribers").select("id");
    if (subsErr) throw subsErr;
    if (!subs || subs.length === 0) {
      res.status(200).json({ ok: true, sent: 0, total: 0, note: "Няма абонати." });
      return;
    }

    const { data: deals, error: dealsErr } = await supabase.from("deals").select("id, data");
    if (dealsErr) throw dealsErr;

    const dealsList = (deals || [])
      .map((d) => d.data)
      .filter(Boolean)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 6);

    const link = "https://bezagencia.com/?deals=1";

    let dealsHtml = "";
    if (dealsList.length > 0) {
      dealsHtml = dealsList.map((d) => `
        <div style="padding:10px 0;border-bottom:1px solid #232b3d;">
          <div style="color:#EEF1F6;font-weight:700;font-size:15px;">${d.title || ""}${d.city ? ` (${d.city})` : ""}</div>
          <div style="color:#D4AF37;font-weight:700;font-size:15px;">${d.totalPrice ? `${d.totalPrice} €` : ""}</div>
        </div>
      `).join("");
    }

    const html = emailWrap("Оферти на седмицата", `
      <p style="margin:0 0 10px;">Здравей,</p>
      <p style="margin:0 0 18px;">Ето най-новите оферти в БезАгенция тази седмица:</p>
      ${dealsHtml || '<p style="margin:0 0 18px;color:#8E99AE;">В момента подготвяме нови оферти — очаквай ги скоро!</p>'}
      <p style="text-align:center;margin:22px 0 0;">
        <a href="${link}" style="display:inline-block;background:#D4AF37;color:#0A0E17;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:15px;">Виж всички оферти</a>
      </p>
    `);

    let sent = 0;
    for (const s of subs) {
      const email = s.id;
      if (!email || !email.includes("@")) continue;
      try {
        const ok = await sendEmail({ to: email, subject: "Офертите на седмицата в БезАгенция", html });
        if (ok) sent++;
      } catch { /* продължаваме към следващия абонат при грешка на един имейл */ }
    }

    res.status(200).json({ ok: true, sent, total: subs.length, dealsIncluded: dealsList.length });
  } catch (e) {
    res.status(500).json({ error: e.message || "Неизвестна грешка." });
  }
}
