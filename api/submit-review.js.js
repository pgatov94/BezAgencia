// Vercel Serverless Function — приема подаден отзив от страница "Отзиви".
//
// ЗАЩО Е НУЖЕН: преди тази промяна браузърът пишеше директно в Supabase
// (review + payment.reviewed + voucher) с публичния ключ. След включване
// на Row Level Security публичният ключ вече не може да пише в тези
// таблици — затова записът минава оттук, през service role ключа, а
// проверката "наистина ли е платено и още не е получавано ваучер" се
// прави ОТНОВО тук, сървърно, вместо да се вярва на браузъра.

import { supabaseAdmin } from "./_lib/supabaseAdmin.js";
import { sendEmail, emailWrap } from "./_lib/email.js";

function genVoucherCode() {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `VIP10-${rand}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { inquiryId, name, rating, text } = req.body || {};
  const id = (inquiryId || "").trim().toUpperCase();
  if (!id || !text || !text.trim()) {
    res.status(400).json({ error: "Липсват задължителни полета." });
    return;
  }

  try {
    const { data: payRow } = await supabaseAdmin.from("payments").select("data").eq("id", id).maybeSingle();
    const pay = payRow?.data || null;

    if (!pay || !pay.paid) {
      res.status(403).json({ error: "notpaid" });
      return;
    }
    if (pay.reviewed) {
      res.status(409).json({ error: "already", voucherCode: pay.voucherCode || null });
      return;
    }

    const { data: inqRow } = await supabaseAdmin.from("inquiries").select("data").eq("id", id).maybeSingle();
    const inq = inqRow?.data || null;

    const code = genVoucherCode();
    const safeRating = Math.min(5, Math.max(1, Number(rating) || 5));

    await supabaseAdmin.from("reviews").upsert({
      id,
      data: {
        inquiryId: id,
        name: (name || inq?.name || "Анонимен клиент").trim() || "Анонимен клиент",
        rating: safeRating,
        text: text.trim(),
        city: inq?.city || null,
        country: inq?.country || null,
        createdAt: Date.now(),
      },
      updated_at: new Date().toISOString(),
    });

    await supabaseAdmin.from("payments").upsert({
      id,
      data: { ...pay, reviewed: true, voucherCode: code },
      updated_at: new Date().toISOString(),
    });

    await supabaseAdmin.from("vouchers").upsert({
      id: code,
      data: { code, percent: 10, inquiryId: id, createdAt: Date.now(), used: false },
      updated_at: new Date().toISOString(),
    });

    if (inq?.email) {
      await sendEmail({
        to: inq.email,
        subject: "Благодарим за отзива! Ето твоя ваучер за 10% отстъпка",
        html: emailWrap("Ваучер за отстъпка", `
          <p style="margin:0 0 10px;">Здравей ${inq.name || ""},</p>
          <p style="margin:0 0 20px;">Благодарим ти, че отдели време да оставиш отзив! Ето твоя код за 10% отстъпка от следващото пътуване:</p>
          <p style="text-align:center;margin:0 0 20px;">
            <span style="display:inline-block;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.4);color:#D4AF37;font-weight:700;font-size:20px;letter-spacing:1px;padding:14px 22px;border-radius:10px;">${code}</span>
          </p>
          <p style="margin:0;font-size:13px;color:#8E99AE;">Спомени кода при следващото си запитване или го въведи в полето за код за отстъпка, когато получиш персонална оферта.</p>
        `),
      });
    }

    res.status(200).json({ ok: true, voucherCode: code });
  } catch (e) {
    res.status(500).json({ error: e.message || "Неизвестна грешка." });
  }
}
