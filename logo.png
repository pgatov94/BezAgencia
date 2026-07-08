// Vercel Serverless Function — изпраща имейли през Resend (resend.com),
// вместо през Formspree (който имаше проблем с Formshield спам филтъра,
// маркиращ автоматичните ни AJAX заявки като спам).
//
// Изисква екологична променлива RESEND_API_KEY, зададена във Vercel
// (Project → Settings → Environment Variables). Виж README.md за пълни
// стъпки за настройка на Resend + верификация на домейна.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    res.status(500).json({ error: "Липсва RESEND_API_KEY в Environment Variables на Vercel." });
    return;
  }

  const { to, subject, html, replyTo } = req.body || {};
  if (!to || !subject || !html) {
    res.status(400).json({ error: "Липсват задължителни полета (to, subject, html)." });
    return;
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Смени с адрес на твоя верифициран в Resend домейн (виж README.md).
        from: "БезАгенция <info@bezagencia.com>",
        to: Array.isArray(to) ? to : [to],
        reply_to: replyTo || undefined,
        subject,
        html,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      res.status(resp.status).json({ error: data?.message || "Грешка от Resend." });
      return;
    }
    res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    res.status(500).json({ error: e.message || "Неизвестна грешка при изпращане." });
  }
}
