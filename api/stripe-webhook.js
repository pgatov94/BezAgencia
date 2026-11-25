// Vercel Serverless Function — Stripe праща тук известие веднага щом
// клиентът реално плати. Автоматично маркираме съответното плащане като
// "платено" в Supabase, без да е нужно админът да го прави ръчно.
//
// Изисква STRIPE_WEBHOOK_SECRET в Environment Variables (взима се при
// създаване на webhook endpoint-а в Stripe Dashboard, виж README.md).
//
// ПРОМЯНА: вече ползва supabaseAdmin (service role, заобикаля RLS) вместо
// публичния src/supabaseClient.js — необходимо, защото след включването
// на Row Level Security публичният ключ вече не може да маркира плащания
// като платени (нарочно, за да не може посетител да си самопотвърди
// плащане без реално да е платил).

import crypto from "crypto";
import { supabaseAdmin as supabase } from "./_lib/supabaseAdmin.js";
import { sendEmail, emailWrap } from "./_lib/email.js";

const INQUIRY_EMAIL = "pgatov94@gmail.com"; // смени, ако смениш и в src/App.jsx

export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts.t;
  // Отхвърляме стари подписи (защита от повторно пускане), толеранс 5 минути.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Платена видео консултация (номер, завършващ на -V)
async function handleVideoPaid(inquiryId, customerEmail, sumText) {
  const { data } = await supabase.from("payments").select("data").eq("id", inquiryId).maybeSingle();
  const current = data?.data || {};
  if (current.kind !== "video") return;
  if (current.paid) return; // вече обработено (Stripe може да изпрати събитието повторно)
  await supabase.from("payments").upsert({
    id: inquiryId,
    data: { ...current, paid: true, status: "paid", paidAt: Date.now(), customerEmail: customerEmail || current.customerEmail || "", updatedAt: Date.now() },
    updated_at: new Date().toISOString(),
  });
  const base = inquiryId.replace(/-V$/, "");
  let customerName = "";
  try {
    const { data: inqData } = await supabase.from("inquiries").select("data").eq("id", base).maybeSingle();
    customerName = inqData?.data?.name || "";
  } catch { /* не е критично */ }
  const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  if (customerEmail) {
    await sendEmail({
      to: customerEmail,
      subject: `Плащането за видео консултация (${base}) е потвърдено`,
      html: emailWrap("Видео консултация — плащане потвърдено", `
        <p style="margin:0 0 10px;">Здравей ${esc(customerName)},</p>
        <p style="margin:0 0 10px;">Плащането ти за видео консултация по запитване <strong style="color:#D4AF37;">${esc(base)}</strong>${sumText ? ` (${esc(sumText)})` : ""} е потвърдено.</p>
        <p style="margin:0 0 10px;">Обикновено в рамките на един работен ден ще получиш имейл с потвърден ден, час и връзка за срещата. Ако ще резервираш полет, настаняване или екскурзии и не знаеш как, ще минем заедно през всяка стъпка по време на срещата.</p>
        <p style="margin:0;color:#8A6410;font-size:13px;">Платформа: ${esc(current.platform || "")}<br>Удобни часове: ${esc(current.slots || "")}</p>
      `),
    });
  }
  await sendEmail({
    to: INQUIRY_EMAIL,
    subject: `Нова видео консултация — ${base}`,
    html: emailWrap("Нова платена видео консултация", `
      <p style="margin:0 0 10px;">Клиент${customerName ? ` ${esc(customerName)}` : ""} плати видео консултация по <strong style="color:#D4AF37;">${esc(base)}</strong>${sumText ? ` — ${esc(sumText)}` : ""}.</p>
      <p style="margin:0 0 6px;"><strong>Платформа:</strong> ${esc(current.platform || "")}</p>
      <p style="margin:0 0 6px;"><strong>Удобни часове:</strong> ${esc(current.slots || "")}</p>
      ${current.notes ? `<p style="margin:0 0 6px;"><strong>Бележки:</strong> ${esc(current.notes)}</p>` : ""}
      ${customerEmail ? `<p style="margin:0;">Имейл на клиента: ${esc(customerEmail)}</p>` : ""}
      <p style="margin:10px 0 0;">Насрочи я в админ панела → Консултации.</p>
    `),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const rawBody = await getRawBody(req);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers["stripe-signature"];

  // Подписът е задължителен: без STRIPE_WEBHOOK_SECRET не приемаме нищо,
  // за да не може никой да маркира плащане като платено с фалшива заявка.
  if (!webhookSecret) {
    res.status(500).json({ error: "Липсва STRIPE_WEBHOOK_SECRET." });
    return;
  }
  if (!verifyStripeSignature(rawBody, sig, webhookSecret)) {
    res.status(400).json({ error: "Невалиден webhook подпис." });
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "Невалиден JSON payload." });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    // Маркираме като платено само ако парите реално са постъпили.
    if (session?.payment_status !== "paid") {
      res.status(200).json({ received: true, skipped: "not_paid" });
      return;
    }
    const inquiryId = session?.metadata?.inquiryId;
    const amount = session?.amount_total ? (session.amount_total / 100).toFixed(0) : null;
    const customerEmail = session?.customer_details?.email || session?.customer_email || null;

    if (inquiryId && /-V$/.test(String(inquiryId))) {
      try {
        await handleVideoPaid(String(inquiryId), customerEmail, amount ? `${amount} €` : "");
      } catch (e) {
        console.error("Webhook: грешка при видео консултация:", e.message);
        res.status(500).json({ error: "Временна грешка, Stripe ще опита пак." });
        return;
      }
      res.status(200).json({ received: true });
      return;
    }

    if (inquiryId) {
      let voucherCodeUsed = null;
      try {
        const { data } = await supabase.from("payments").select("data").eq("id", inquiryId).maybeSingle();
        const current = data?.data || {};
        voucherCodeUsed = current.voucherCode || null;
        await supabase.from("payments").upsert({
          id: inquiryId,
          data: { ...current, paid: true, status: "paid", updatedAt: Date.now() },
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error("Webhook: неуспешно обновяване в Supabase:", e.message);
      }

      // Маркираме ваучера като използван едва СЕГА — след реално платено
      // плащане, не само при клик на "Потвърди офертата". Проверяваме и
      // дали вече не е бил използван, за да не се задейства повторно при
      // случаен дублиран webhook от Stripe.
      if (voucherCodeUsed) {
        try {
          const { data: voucherRow } = await supabase.from("vouchers").select("data").eq("id", voucherCodeUsed).maybeSingle();
          const voucherData = voucherRow?.data || null;
          if (voucherData && !voucherData.used) {
            await supabase.from("vouchers").upsert({
              id: voucherCodeUsed,
              data: { ...voucherData, used: true, usedAt: Date.now() },
              updated_at: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.error("Webhook: неуспешно маркиране на ваучера:", e.message);
        }
      }

      // Извличаме и името на клиента (ако го имаме от запитването), за по-личен тон.
      let customerName = "";
      try {
        const { data: inqData } = await supabase.from("inquiries").select("data").eq("id", inquiryId).maybeSingle();
        customerName = inqData?.data?.name || "";
      } catch { /* не е критично */ }

      const sumText = amount ? `${amount} €` : "";

      if (customerEmail) {
        await sendEmail({
          to: customerEmail,
          subject: `Плащането по запитване ${inquiryId} е потвърдено`,
          html: emailWrap("Плащане потвърдено", `
            <p style="margin:0 0 10px;">Здравей ${customerName || ""},</p>
            <p style="margin:0 0 10px;">Плащането ти по запитване <strong style="color:#D4AF37;">${inquiryId}</strong>${sumText ? ` на стойност <strong style="color:#D4AF37;">${sumText}</strong>` : ""} е потвърдено успешно.</p>
            <p style="margin:0;">В най-кратки срокове ще получиш цялата налична информация за предстоящото пътуване (билети, настаняване и детайли) на този имейл.</p>
          `),
        });
      }

      await sendEmail({
        to: INQUIRY_EMAIL,
        subject: `Ново плащане по запитване ${inquiryId}`,
        html: emailWrap("Плащане потвърдено", `
          <p style="margin:0 0 10px;">Клиент${customerName ? ` ${customerName}` : ""} плати по запитване <strong style="color:#D4AF37;">${inquiryId}</strong>${sumText ? ` — сума ${sumText}` : ""}.</p>
          ${customerEmail ? `<p style="margin:0;">Имейл на клиента: ${customerEmail}</p>` : ""}
        `),
      });
    }
  }

  res.status(200).json({ received: true });
}
