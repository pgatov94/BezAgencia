// Vercel Serverless Function — създава истинска Stripe Checkout сесия за
// плащане с карта. Изисква STRIPE_SECRET_KEY в Environment Variables на
// Vercel (Project → Settings → Environment Variables). Виж README.md.
//
// Ползваме директно Stripe REST API-то (form-encoded fetch), без да
// вграждаме тежкия "stripe" npm пакет — по-леко и по-бързо за serverless.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    res.status(500).json({ error: "Липсва STRIPE_SECRET_KEY в Environment Variables на Vercel." });
    return;
  }

  const { amount, inquiryId, email } = req.body || {};
  const amountNum = Number(amount);
  if (!amountNum || amountNum <= 0 || !inquiryId) {
    res.status(400).json({ error: "Липсва валидна сума или номер на запитване." });
    return;
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const params = new URLSearchParams();
    params.append("mode", "payment");
    // Само карта (в която автоматично се показват Apple Pay / Google Pay
    // за поддържани устройства/браузъри) + Revolut Pay. Без банкови
    // преводи, Klarna и т.н.
    params.append("payment_method_types[0]", "card");
    params.append("payment_method_types[1]", "revolut_pay");
    params.append("line_items[0][price_data][currency]", "eur");
    params.append("line_items[0][price_data][product_data][name]", `Пътуване — запитване ${inquiryId}`);
    params.append("line_items[0][price_data][unit_amount]", String(Math.round(amountNum * 100)));
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", `${origin}/?paid=success&inquiry=${encodeURIComponent(inquiryId)}`);
    params.append("cancel_url", `${origin}/?paid=cancelled&inquiry=${encodeURIComponent(inquiryId)}`);
    params.append("metadata[inquiryId]", inquiryId);
    if (email) params.append("customer_email", email);

    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await resp.json();
    if (!resp.ok) {
      res.status(resp.status).json({ error: data?.error?.message || "Грешка от Stripe." });
      return;
    }
    res.status(200).json({ url: data.url });
  } catch (e) {
    res.status(500).json({ error: e.message || "Неизвестна грешка при създаване на плащането." });
  }
}
