// Vercel Serverless Function — записва нов абонат за бюлетина и му
// изпраща еднократен код за 10% отстъпка от комисионната. Прави го
// сървърно (service role), защото таблицата vouchers вече не позволява
// директно писане от браузъра (виж rls.sql) — само оттук или от
// api/submit-review.js/stripe-webhook.js могат да се създават ваучери,
// за да не може посетител сам да си "издаде" код.
//
// "Еднократен" тук означава две неща:
//  1. Самият ваучер код може да се използва само веднъж (used: true след
//     употреба, проверява се при плащане — вече съществуваща логика).
//  2. Един и същ имейл получава код за абониране само първия път — ако
//     вече е получавал (voucherIssued: true), само го записваме отново
//     като абонат, но не му пращаме втори код.

import { supabaseAdmin } from "./_lib/supabaseAdmin.js";
import { sendEmail, emailWrap } from "./_lib/email.js";

function genVoucherCode() {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `NEWS10-${rand}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { email: rawEmail } = req.body || {};
  const email = (rawEmail || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Невалиден имейл." });
    return;
  }

  try {
    const { data: existingRow } = await supabaseAdmin.from("newsletter_subscribers").select("data").eq("id", email).maybeSingle();
    const existing = existingRow?.data || null;
    const alreadyHadVoucher = !!existing?.voucherIssued;
    const code = alreadyHadVoucher ? null : genVoucherCode();

    await supabaseAdmin.from("newsletter_subscribers").upsert({
      id: email,
      data: {
        email,
        createdAt: existing?.createdAt || Date.now(),
        voucherIssued: alreadyHadVoucher || !!code,
        voucherCode: alreadyHadVoucher ? existing?.voucherCode || null : code,
      },
      updated_at: new Date().toISOString(),
    });

    if (code) {
      await supabaseAdmin.from("vouchers").upsert({
        id: code,
        data: { code, percent: 10, source: "newsletter", email, createdAt: Date.now(), used: false },
        updated_at: new Date().toISOString(),
      });
    }

    const html = alreadyHadVoucher
      ? emailWrap("Бюлетин", `
          <p style="margin:0 0 10px;">Здравей,</p>
          <p style="margin:0;">Вече си абониран/а за бюлетина на БезАгенция — ще получаваш нашите оферти всяка седмица. (Кодът за отстъпка се дава само веднъж на имейл адрес — ако вече си го получил/а, провери предишните ни писма.)</p>
        `)
      : emailWrap("Добре дошъл/дошла", `
          <p style="margin:0 0 10px;">Здравей,</p>
          <p style="margin:0 0 20px;">Благодарим, че се абонира за бюлетина на БезАгенция! Ето твоя еднократен код за 10% отстъпка от комисионната при следващото ти пътуване:</p>
          <p style="text-align:center;margin:0 0 20px;">
            <span style="display:inline-block;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.4);color:#D4AF37;font-weight:700;font-size:20px;letter-spacing:1px;padding:14px 22px;border-radius:10px;">${code}</span>
          </p>
          <p style="margin:0;font-size:13px;color:#8E99AE;">Въведи кода в полето за код за отстъпка, когато получиш персонална оферта. Важи еднократно, за едно пътуване.</p>
        `);

    const ok = await sendEmail({
      to: email,
      subject: alreadyHadVoucher ? "Абонамент за бюлетина на БезАгенция" : "Твоят код за 10% отстъпка — БезАгенция",
      html,
    });

    res.status(200).json({ ok: true, voucherIssued: !alreadyHadVoucher, emailSent: ok });
  } catch (e) {
    res.status(500).json({ error: e.message || "Неизвестна грешка." });
  }
}
