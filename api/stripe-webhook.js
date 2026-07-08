// Vercel Serverless Function — Stripe праща тук известие веднага щом
// клиентът реално плати. Автоматично маркираме съответното плащане като
// "платено" в Supabase, без да е нужно админът да го прави ръчно.
//
// Изисква STRIPE_WEBHOOK_SECRET в Environment Variables (взима се при
// създаване на webhook endpoint-а в Stripe Dashboard, виж README.md).

import crypto from "crypto";
import { supabase } from "../src/supabaseClient.js";

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

    if (inquiryId) {
      try {
        const { data } = await supabase.from("payments").select("data").eq("id", inquiryId).maybeSingle();
        const current = data?.data || {};
        await supabase.from("payments").upsert({
          id: inquiryId,
          data: { ...current, paid: true, status: "paid", updatedAt: Date.now() },
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error("Webhook: неуспешно обновяване в Supabase:", e.message);
      }
    }
  }

  res.status(200).json({ received: true });
}
