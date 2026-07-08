// Споделена помощна функция за изпращане на имейли през Resend — ползва се
// от api/stripe-webhook.js (директно, сървър до сървър, без HTTP заобикалка).

export async function sendEmail({ to, subject, html, replyTo }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error("sendEmail: липсва RESEND_API_KEY");
    return false;
  }
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "БезАгенция <info@bezagencia.com>",
        to: Array.isArray(to) ? to : [to],
        reply_to: replyTo || undefined,
        subject,
        html,
        text,
      }),
    });
    return resp.ok;
  } catch (e) {
    console.error("sendEmail грешка:", e.message);
    return false;
  }
}

// Същата визуална обвивка с логото, ползвана и в клиентската част (App.jsx),
// пресъздадена тук като чист JS (без JSX), за да може да се ползва в
// сървърна функция.
export function emailWrap(title, bodyHtml) {
  return `
  <div style="background:#0A0E17;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#111826;border-radius:16px;overflow:hidden;border:1px solid #232b3d;">
      <div style="text-align:center;padding:26px 20px 6px;">
        <img src="https://bezagencia.com/logo.png" alt="БезАгенция" style="height:56px;width:auto;display:inline-block;" />
      </div>
      ${title ? `<div style="text-align:center;color:#D4AF37;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:18px;">${title}</div>` : ""}
      <div style="padding:0 28px 30px;color:#EEF1F6;font-size:14px;line-height:1.7;">
        ${bodyHtml}
      </div>
      <div style="text-align:center;padding:16px;border-top:1px solid #232b3d;color:#8E99AE;font-size:11px;">
        БезАгенция — бюджетни екскурзии без агенция
      </div>
    </div>
  </div>`;
}
