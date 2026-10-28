// Чат на живо — сървърен endpoint (Vercel). Всички действия минават оттук;
// таблиците са затворени с RLS и се достъпват само със service role.
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin as supabase } from "./_lib/supabaseAdmin.js";
import { sendEmail, emailWrap } from "./_lib/email.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NOTIFY_TO = process.env.CHAT_NOTIFY_EMAIL || "pgatov94@gmail.com";
const SITE = "https://bezagencia.com";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function passOk(given) {
  const real = process.env.ADMIN_PASSCODE || "";
  if (!real || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const action = b.action;

  try {
    /* ───────── ПОСЕТИТЕЛ ───────── */
    if (action === "visitorSend") {
      if (b.website) return res.status(200).json({ ok: true }); // honeypot
      const id = String(b.id || "");
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "Невалиден чат." });
      const message = String(b.message || "").trim().slice(0, 1000);
      if (!message) return res.status(400).json({ error: "Празно съобщение." });
      const name = String(b.name || "").trim().slice(0, 60);
      const emailRaw = String(b.email || "").trim().slice(0, 120);
      const email = EMAIL_RE.test(emailRaw) ? emailRaw : "";

      const { data: conv } = await supabase.from("chat_conversations").select("*").eq("id", id).maybeSingle();

      if (!conv) {
        if (!name) return res.status(400).json({ error: "Моля, въведи име." });
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { count } = await supabase
          .from("chat_conversations").select("id", { count: "exact", head: true }).gte("created_at", since);
        if ((count || 0) >= 200) return res.status(429).json({ error: "Чатът е временно недостъпен. Пиши ни по имейл." });
        const { error: e1 } = await supabase.from("chat_conversations").insert({
          id, visitor_name: name, visitor_email: email,
        });
        if (e1) throw e1;
      } else {
        const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from("chat_messages").select("id", { count: "exact", head: true })
          .eq("conversation_id", id).eq("sender", "visitor").gte("created_at", since);
        if ((count || 0) >= 20) return res.status(429).json({ error: "Твърде много съобщения. Опитай след малко." });
        if (email && !conv.visitor_email) {
          await supabase.from("chat_conversations").update({ visitor_email: email }).eq("id", id);
        }
      }

      const { error: e2 } = await supabase.from("chat_messages").insert({ conversation_id: id, sender: "visitor", body: message });
      if (e2) throw e2;

      const now = new Date();
      const cur = conv || { unread_admin: 0, last_notified_at: null, visitor_name: name, visitor_email: email };
      const shouldNotify = !cur.last_notified_at || now - new Date(cur.last_notified_at) > 10 * 60 * 1000;
      await supabase.from("chat_conversations").update({
        last_message_at: now.toISOString(),
        unread_admin: (cur.unread_admin || 0) + 1,
        visitor_seen_at: now.toISOString(),
        status: "open",
        ...(shouldNotify ? { last_notified_at: now.toISOString() } : {}),
      }).eq("id", id);

      if (shouldNotify) {
        try {
          await sendEmail({
            to: NOTIFY_TO,
            subject: `💬 Ново съобщение в чата от ${cur.visitor_name || name}`,
            replyTo: email || cur.visitor_email || undefined,
            html: emailWrap("Ново съобщение в чата", `
              <p><strong>${esc(cur.visitor_name || name)}</strong>${(email || cur.visitor_email) ? ` (${esc(email || cur.visitor_email)})` : ""} пише:</p>
              <p style="background:#f7f5f0;padding:12px 14px;border-radius:10px;">${esc(message)}</p>
              <p><a href="${SITE}/">Отвори админ панела → Чат</a></p>`),
          });
        } catch (e) { console.error("chat notify:", e?.message); }
      }
      return res.status(200).json({ ok: true });
    }

    if (action === "visitorHistory") {
      const id = String(b.id || "");
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "Невалиден чат." });
      const { data: msgs } = await supabase
        .from("chat_messages").select("id, sender, body, created_at")
        .eq("conversation_id", id).order("id", { ascending: true }).limit(300);
      if (msgs?.length) {
        await supabase.from("chat_conversations").update({ visitor_seen_at: new Date().toISOString() }).eq("id", id);
      }
      return res.status(200).json({ ok: true, messages: msgs || [] });
    }

    /* ───────── АДМИН ───────── */
    if (!passOk(b.passcode)) return res.status(401).json({ error: "Грешна парола." });

    if (action === "adminList") {
      const { data } = await supabase
        .from("chat_conversations").select("*").order("last_message_at", { ascending: false }).limit(100);
      return res.status(200).json({ ok: true, conversations: data || [] });
    }

    if (action === "adminMessages") {
      const id = String(b.id || "");
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "Невалиден чат." });
      const { data: msgs } = await supabase
        .from("chat_messages").select("id, sender, body, created_at")
        .eq("conversation_id", id).order("id", { ascending: true }).limit(500);
      await supabase.from("chat_conversations").update({ unread_admin: 0 }).eq("id", id);
      return res.status(200).json({ ok: true, messages: msgs || [] });
    }

    if (action === "adminReply") {
      const id = String(b.id || "");
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "Невалиден чат." });
      const message = String(b.message || "").trim().slice(0, 1500);
      if (!message) return res.status(400).json({ error: "Празно съобщение." });
      const { data: conv } = await supabase.from("chat_conversations").select("*").eq("id", id).maybeSingle();
      if (!conv) return res.status(404).json({ error: "Разговорът не е намерен." });
      const { error } = await supabase.from("chat_messages").insert({ conversation_id: id, sender: "admin", body: message });
      if (error) throw error;
      await supabase.from("chat_conversations").update({ last_message_at: new Date().toISOString(), unread_admin: 0 }).eq("id", id);

      const seen = conv.visitor_seen_at ? Date.now() - new Date(conv.visitor_seen_at).getTime() : Infinity;
      let emailed = false;
      if (conv.visitor_email && seen > 5 * 60 * 1000) {
        try {
          await sendEmail({
            to: conv.visitor_email,
            subject: "Отговор от БезАгенция",
            html: emailWrap("Имаш отговор в чата", `
              <p>Здравей${conv.visitor_name ? ", " + esc(conv.visitor_name) : ""}!</p>
              <p style="background:#f7f5f0;padding:12px 14px;border-radius:10px;">${esc(message)}</p>
              <p><a href="${SITE}/?chat=${id}" style="display:inline-block;background:#D4AF37;color:#0F172A;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;">Продължи разговора</a></p>`),
          });
          emailed = true;
        } catch (e) { console.error("chat reply mail:", e?.message); }
      }
      return res.status(200).json({ ok: true, emailed });
    }

    if (action === "adminDelete") {
      const id = String(b.id || "");
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "Невалиден чат." });
      await supabase.from("chat_conversations").delete().eq("id", id);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Непознато действие." });
  } catch (e) {
    console.error("chat api:", e?.message || e);
    return res.status(500).json({ error: "Грешка на сървъра." });
  }
}
