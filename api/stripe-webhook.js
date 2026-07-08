// Vercel Serverless Function — Stripe праща тук известие веднага щом
// клиентът реално плати. Автоматично маркираме съответното плащане като
// "платено" в Supabase, без да е нужно админът да го прави ръчно.
//
// Изисква STRIPE_WEBHOOK_SECRET в Environment Variables (взима се при
// създаване на webhook endpoint-а в Stripe Dashboard, виж README.md).

import crypto from "crypto";
import { supabase } from "../src/supabaseClient.js";
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const rawBody = await getRawBody(req);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers["stripe-signature"];

  if (webhookSecret) {
    if (!verifyStripeSignature(rawBody, sig, webhookSecret)) {
      res.status(400).json({ error: "Невалиден webhook подпис." });
      return;
    }
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
    const inquiryId = session?.metadata?.inquiryId;
    const amount = session?.amount_total ? (session.amount_total / 100).toFixed(0) : null;
    const customerEmail = session?.customer_details?.email || session?.customer_email || null;

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
