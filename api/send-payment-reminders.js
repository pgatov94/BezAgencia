// Vercel Cron Job — веднъж дневно проверява всички неплатени оферти
// (payments с paid=false, за които вече има зададена цена — offerSentAt)
// и изпраща напомняне по имейл на 1-ви, 3-ти и 5-ти ден, ако клиентът още
// не е потвърдил/платил. Всяко напомняне се праща само веднъж (пази се
// remind1Sent / remind3Sent / remind5Sent флаг в самия запис).
//
// Настройка в Vercel: вече е добавен в vercel.json — вика се веднъж
// дневно заедно с send-review-reminders.

import { supabaseAdmin as supabase } from "./_lib/supabaseAdmin.js";
import { sendEmail, emailWrap } from "./_lib/email.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function reminderContent(day, name, id, amount) {
  const sum = amount ? `${amount} €` : "";
  if (day === 1) {
    return {
      subject: `Напомняне: офертата ти по запитване ${id} чака потвърждение`,
      html: `
        <p style="margin:0 0 10px;">Здравей ${name || ""},</p>
        <p style="margin:0 0 10px;">Вчера подготвихме персонална оферта за твоето пътуване${sum ? ` на стойност ${sum}` : ""} — номер на запитването <strong style="color:#D4AF37;">${id}</strong>.</p>
        <p style="margin:0;">Влез на сайта, отвори „Плащания" и въведи номера си, за да я видиш и потвърдиш с плащане.</p>
      `,
    };
  }
  if (day === 3) {
    return {
      subject: `Все още те чакаме — оферта ${id}`,
      html: `
        <p style="margin:0 0 10px;">Здравей ${name || ""},</p>
        <p style="margin:0 0 10px;">Твоята оферта по запитване <strong style="color:#D4AF37;">${id}</strong>${sum ? ` (${sum})` : ""} все още не е потвърдена.</p>
        <p style="margin:0;">Ако имаш въпроси или искаш промяна в датите/бюджета, просто ни пиши — иначе влез на сайта и потвърди, когато си готов/а.</p>
      `,
    };
  }
  return {
    subject: `Последно напомняне за оферта ${id}`,
    html: `
      <p style="margin:0 0 10px;">Здравей ${name || ""},</p>
      <p style="margin:0 0 10px;">Това е последното ни напомняне за офертата по запитване <strong style="color:#D4AF37;">${id}</strong>${sum ? ` (${sum})` : ""} — цените на полети и настаняване могат да се променят с времето.</p>
      <p style="margin:0;">Ако все още искаш да пътуваш, влез на сайта и потвърди с плащане възможно най-скоро.</p>
    `,
  };
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const now = Date.now();
  const sent = [];
  const errors = [];

  try {
    const { data: payments, error: payErr } = await supabase.from("payments").select("id, data");
    if (payErr) throw payErr;

    const eligiblePayments = (payments || []).filter((p) => {
      const d = p.data || {};
      return d.paid === false && !!d.offerSentAt;
    });

    for (const p of eligiblePayments) {
      const d = p.data;
      const daysSince = Math.floor((now - d.offerSentAt) / DAY_MS);

      let dayToSend = null;
      if (daysSince >= 1 && !d.remind1Sent) dayToSend = 1;
      else if (daysSince >= 3 && !d.remind3Sent) dayToSend = 3;
      else if (daysSince >= 5 && !d.remind5Sent) dayToSend = 5;

      if (!dayToSend) continue;

      try {
        const { data: inqRow } = await supabase.from("inquiries").select("data").eq("id", p.id).maybeSingle();
        const inq = inqRow?.data || null;
        if (!inq?.email) continue;

        const { subject, html } = reminderContent(dayToSend, inq.name, p.id, d.amount);
        const ok = await sendEmail({ to: inq.email, subject, html: emailWrap("Напомняне", html) });

        const flagKey = `remind${dayToSend}Sent`;
        await supabase.from("payments").update({ data: { ...d, [flagKey]: true } }).eq("id", p.id);

        if (ok) sent.push(`${p.id} (ден ${dayToSend})`); else errors.push({ id: p.id, day: dayToSend, reason: "Resend отказа изпращането" });
      } catch (e) {
        errors.push({ id: p.id, reason: e.message });
      }
    }

    res.status(200).json({ ok: true, checked: eligiblePayments.length, sent, errors });
  } catch (e) {
    res.status(500).json({ error: e.message || "Неизвестна грешка." });
  }
}
