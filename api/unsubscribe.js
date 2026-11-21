// Отписване от бюлетина с едно кликване (линк във всеки имейл).
import { supabaseAdmin as supabase } from "./_lib/supabaseAdmin.js";
import { tokenOk } from "./_lib/unsubscribeToken.js";

const page = (msg) => `<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Отписване — БезАгенция</title></head>
<body style="margin:0;background:#F7F5F0;font-family:system-ui,sans-serif;color:#0F172A;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;">
<div style="max-width:460px;background:#fff;border:1px solid #E7E2D6;border-radius:16px;padding:28px;text-align:center;">
<h1 style="font-size:22px;margin:0 0 10px;">БезАгенция</h1><p style="font-size:16px;line-height:1.6;margin:0 0 18px;">${msg}</p>
<a href="https://bezagencia.com/" style="color:#8A6410;font-weight:700;">Към сайта</a></div></body></html>`;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const email = String(req.query?.e || "").trim().toLowerCase();
  const token = String(req.query?.t || "");
  if (!email || !tokenOk(email, token)) {
    return res.status(400).send(page("Линкът за отписване е невалиден или е непълен. Пиши ни на pgatov94@gmail.com и ще те отпишем ръчно."));
  }
  try {
    await supabase.from("newsletter_subscribers").delete().eq("id", email);
    return res.status(200).send(page("Отписахме те от бюлетина. Повече няма да получаваш съобщения от нас."));
  } catch {
    return res.status(500).send(page("Възникна грешка. Опитай пак или ни пиши на pgatov94@gmail.com."));
  }
}
