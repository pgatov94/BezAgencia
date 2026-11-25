// Чат на живо — сървърен endpoint (Vercel). Всички действия минават оттук;
// таблиците са затворени с RLS и се достъпват само със service role.
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin as supabase } from "./_lib/supabaseAdmin.js";
import { sendEmail, emailWrap } from "./_lib/email.js";
import { tokenOk } from "./_lib/unsubscribeToken.js";

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
  // Отписване от бюлетина (линк в имейлите): GET /api/chat?unsub=1&e=...&t=...
  if (req.method === "GET" && req.query?.unsub) return unsubscribeHandler(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const action = b.action;
  // Правни действия (отметки при поръчка, съгласие за бюлетин, отказ от договор)
  if (["recordConsent", "newsletterConsent", "withdraw", "videoRequest", "videoStatus"].includes(action)) return legalHandler(req, res, b);

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
              <p style="background:#f7f5f0;color:#0F172A;padding:12px 14px;border-radius:10px;font-size:16px;line-height:1.5;">${esc(message)}</p>
              <p><a href="${SITE}/admin" style="display:inline-block;background:#D4AF37;color:#0F172A;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;">Отвори чата в админ панела</a></p>`),
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
              <p style="background:#f7f5f0;color:#0F172A;padding:12px 14px;border-radius:10px;font-size:16px;line-height:1.5;">${esc(message)}</p>
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

    /* ───────── СЧЕТОВОДСТВО (само админ) ───────── */
    if (action === "accList") {
      const { data, error } = await supabase.from("accounting_docs").select("id, data, updated_at").order("updated_at", { ascending: true }).limit(2000);
      if (error) throw error;
      return res.status(200).json({ ok: true, rows: data || [] });
    }

    if (action === "accSave") {
      const id = String(b.id || "");
      if (!/^[A-Za-z0-9_-]{3,60}$/.test(id)) return res.status(400).json({ error: "Невалиден номер на записа." });
      const doc = b.doc;
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) return res.status(400).json({ error: "Липсват данни." });
      const json = JSON.stringify(doc);
      if (json.length > 20000) return res.status(400).json({ error: "Записът е твърде голям." });
      const { error } = await supabase.from("accounting_docs").upsert({ id, data: doc, updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === "accDelete") {
      const id = String(b.id || "");
      if (!/^[A-Za-z0-9_-]{3,60}$/.test(id) || id === "settings") return res.status(400).json({ error: "Невалиден запис." });
      const { error } = await supabase.from("accounting_docs").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    /* ───────── ФАКТУРИ КЪМ КЛИЕНТИ (само админ) ───────── */
    if (action === "invList") {
      const { data: cons, error } = await supabase.from("order_consents").select("id, data, updated_at").order("updated_at", { ascending: false }).limit(1000);
      if (error) throw error;
      const withInv = (cons || []).filter((c) => c.data?.invoice);
      const ids = withInv.map((c) => c.id);
      let pays = [], inqs = [];
      if (ids.length) {
        const [p, q] = await Promise.all([
          supabase.from("payments").select("id, data").in("id", ids),
          supabase.from("inquiries").select("id, data").in("id", ids.map((x) => x.replace(/-V$/, ""))),
        ]);
        pays = p.data || []; inqs = q.data || [];
      }
      const rows = withInv.map((c) => {
        const pay = pays.find((x) => x.id === c.id)?.data || {};
        const inq = inqs.find((x) => x.id === c.id.replace(/-V$/, ""))?.data || {};
        return {
          id: c.id, invoice: c.data.invoice, acceptedAt: c.data.acceptedAt || null,
          paid: pay.paid === true, amount: pay.amount ?? c.data.amountShown ?? null, paidAt: pay.updatedAt || null,
          email: inq.email || pay.customerEmail || "", customerName: inq.name || "", video: c.id.endsWith("-V"),
        };
      });
      return res.status(200).json({ ok: true, rows });
    }

    if (action === "invSend") {
      const to = String(b.to || "").trim();
      if (!EMAIL_RE.test(to)) return res.status(400).json({ error: "Невалиден имейл на клиента." });
      const subject = String(b.subject || "").trim().slice(0, 150);
      const html = String(b.html || "");
      if (!subject || !html || html.length > 80000) return res.status(400).json({ error: "Липсва тема или съдържание." });
      await sendEmail({ to, subject, html });
      return res.status(200).json({ ok: true });
    }

    /* ───────── ВИДЕО КОНСУЛТАЦИИ (само админ) ───────── */
    if (action === "videoList") {
      const { data: rows, error } = await supabase.from("payments").select("id, data, updated_at").like("id", "%-V").order("updated_at", { ascending: false }).limit(300);
      if (error) throw error;
      const vids = (rows || []).filter((r) => r.data?.kind === "video");
      const bases = vids.map((r) => r.id.replace(/-V$/, ""));
      let inqs = [];
      if (bases.length) inqs = (await supabase.from("inquiries").select("id, data").in("id", bases)).data || [];
      const out = vids.map((r) => {
        const base = r.id.replace(/-V$/, "");
        const inq = inqs.find((x) => x.id === base)?.data || {};
        return { id: r.id, base, ...r.data, name: inq.name || "", email: r.data.customerEmail || inq.email || "" };
      });
      return res.status(200).json({ ok: true, rows: out });
    }

    if (action === "videoSet") {
      const id = String(b.id || "").trim().toUpperCase();
      if (!ID_RE.test(id) || !id.endsWith("-V")) return res.status(400).json({ error: "Невалиден номер." });
      const status = ["paid", "scheduled", "done", "cancelled"].includes(b.status) ? b.status : null;
      if (!status) return res.status(400).json({ error: "Невалиден статус." });
      const { data: row } = await supabase.from("payments").select("data").eq("id", id).maybeSingle();
      if (!row || row.data?.kind !== "video") return res.status(404).json({ error: "Не намирам консултацията." });
      if (!row.data.paid) return res.status(409).json({ error: "Консултацията още не е платена." });
      const whenText = String(b.whenText ?? row.data.whenText ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
      const link = String(b.link ?? row.data.link ?? "").trim().slice(0, 500);
      if (link && !/^https:\/\/[^\s]+$/.test(link)) return res.status(400).json({ error: "Линкът трябва да започва с https://" });
      const next = { ...row.data, status, whenText, link, updatedAt: Date.now() };
      let emailed = false;
      if (status === "scheduled" && b.sendEmail === true) {
        if (!whenText || !link) return res.status(400).json({ error: "За имейл попълни дата/час и линк." });
        const base = id.replace(/-V$/, "");
        const inq = (await supabase.from("inquiries").select("data").eq("id", base).maybeSingle()).data?.data || {};
        const to = row.data.customerEmail || inq.email || "";
        if (!EMAIL_RE.test(to)) return res.status(400).json({ error: "Няма имейл на клиента." });
        await sendEmail({
          to, subject: `Видео консултация — ${whenText}`,
          html: emailWrap("Видео консултацията ти е потвърдена", `
            <p style="margin:0 0 10px;">Здравей${inq.name ? " " + esc(inq.name) : ""},</p>
            <p style="margin:0 0 10px;">Потвърждавам видео консултацията по запитване <strong>${esc(base)}</strong>.</p>
            <p style="margin:0 0 4px;"><strong>Дата и час:</strong> ${esc(whenText)}</p>
            <p style="margin:0 0 4px;"><strong>Платформа:</strong> ${esc(row.data.platform || "")}</p>
            <p style="margin:0 0 12px;"><strong>Връзка за срещата:</strong> <a href="${esc(link)}">${esc(link)}</a></p>
            <p style="margin:0 0 6px;"><strong>Какво да подготвиш:</strong></p>
            <ul style="margin:0 0 12px;padding-left:20px;">
              <li>Маршрута, който си получил, отворен на екрана или разпечатан.</li>
              <li>Лаптоп или телефон с камера и микрофон. Ако ще резервираме заедно, по-удобен е лаптопът.</li>
              <li>Сайтовете на доставчиците, в които искаш да резервираш, и собствените ти данни и карта под ръка.</li>
            </ul>
            <p style="margin:0 0 10px;">Ако не знаеш как се прави резервацията, ще минем заедно през всяка стъпка: ти ще споделиш екрана си и ще въвеждаш данните сам/сама, а аз ще те насочвам. Не показвай на екрана документи за самоличност и платежни данни на други хора. Срещата не се записва.</p>
            <p style="margin:0;">Ако часът не ти е удобен, отговори на този имейл и ще го преместим.</p>
          `),
        });
        emailed = true;
      }
      const { error } = await supabase.from("payments").upsert({ id, data: next, updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.status(200).json({ ok: true, emailed });
    }

    return res.status(400).json({ error: "Непознато действие." });
  } catch (e) {
    console.error("chat api:", e?.message || e);
    return res.status(500).json({ error: "Грешка на сървъра." });
  }
}

/* ───────── Правни действия ───────── */
const ID_RE = /^[A-Z0-9-]{6,40}$/;
const TERMS_VERSION = "1.0";

const hits = new Map(); // грубо ограничение по IP
function limited(req, max, windowMs) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "x";
  const now = Date.now();
  const rec = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  rec.push(now); hits.set(ip, rec);
  return rec.length > max;
}

async function legalHandler(req, res, b) {
  if (limited(req, 30, 3600 * 1000)) return res.status(429).json({ error: "Твърде много опити. Опитай по-късно." });

  try {
    /* ── Избор при поръчка (отметки): записва се преди плащането ── */
    if (b.action === "recordConsent") {
      const id = String(b.inquiryId || "").trim().toUpperCase();
      if (!ID_RE.test(id)) return res.status(400).json({ error: "Невалиден номер." });
      if (b.acceptedTerms !== true || b.over18 !== true) return res.status(400).json({ error: "Липсва потвърждение на Общите условия." });
      const startNow = b.startBeforeWithdrawal === true;
      const lose = b.acknowledgeLoss === true;
      if (!startNow || !lose) return res.status(400).json({ error: "Отбележи и двете полета за началото на изпълнението, за да продължиш." });

      const { data: pay } = await supabase.from("payments").select("data").eq("id", id).maybeSingle();
      if (!pay) return res.status(404).json({ error: "Не намираме плащане по този номер." });
      if (pay.data?.paid) return res.status(409).json({ error: "Плащането вече е извършено." });

      // Данни за фактура (по желание). Проверяват се и се чистят от сървъра.
      let invoice = null;
      if (b.invoice && typeof b.invoice === "object") {
        const t = (x, n) => String(x ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
        const type = b.invoice.type === "company" ? "company" : "person";
        invoice = {
          type,
          name: t(b.invoice.name, 120),
          eik: t(b.invoice.eik, 13).replace(/\s+/g, ""),
          vat: t(b.invoice.vat, 20).replace(/\s+/g, "").toUpperCase(),
          mol: t(b.invoice.mol, 80),
          address: t(b.invoice.address, 200),
          city: t(b.invoice.city, 60),
          consentElectronic: true,
        };
        if (invoice.name.length < 3 || invoice.address.length < 5) return res.status(400).json({ error: "Попълни име и адрес за фактурата." });
        if (type === "company" && !/^\d{9}(\d{4})?$/.test(invoice.eik)) return res.status(400).json({ error: "Невалиден ЕИК за фактурата." });
        if (type === "person") { invoice.eik = ""; invoice.vat = ""; invoice.mol = ""; }
      }

      const rec = {
        termsVersion: TERMS_VERSION,
        acceptedAt: new Date().toISOString(),
        acceptedTerms: true,
        over18: true,
        startBeforeWithdrawal: startNow,
        acknowledgeLoss: startNow ? lose : false,
        amountShown: pay.data?.amount ?? null,
        ...(invoice ? { invoice } : {}),
      };
      const { error } = await supabase.from("order_consents").upsert({ id, data: rec, updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    /* ── Видео консултация: заявка (цената 20 EUR се определя тук, не от браузъра) ── */
    if (b.action === "videoRequest") {
      const base = String(b.inquiryId || "").trim().toUpperCase();
      if (!ID_RE.test(base) || base.endsWith("-V")) return res.status(400).json({ error: "Невалиден номер." });
      if (b.acceptedTerms !== true || b.over18 !== true || b.startBeforeWithdrawal !== true || b.acknowledgeLoss !== true) {
        return res.status(400).json({ error: "За да продължиш към плащането, отбележи всички полета." });
      }
      const clean = (x, n) => String(x ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
      const platform = ["Google Meet", "Zoom", "Microsoft Teams"].includes(b.platform) ? b.platform : "";
      const slots = clean(b.slots, 400);
      const notes = clean(b.notes, 600);
      if (!platform) return res.status(400).json({ error: "Избери платформа за срещата." });
      if (slots.length < 5) return res.status(400).json({ error: "Напиши поне един удобен ден и час." });

      const { data: pay } = await supabase.from("payments").select("data").eq("id", base).maybeSingle();
      if (!pay?.data?.paid) return res.status(409).json({ error: "Видео консултация може да се поръча след платена оферта." });
      const vid = `${base}-V`;
      const { data: ex } = await supabase.from("payments").select("data").eq("id", vid).maybeSingle();
      if (ex?.data?.paid) return res.status(409).json({ error: "Вече имаш платена видео консултация към тази поръчка." });

      let invoice = null;
      if (b.invoice && typeof b.invoice === "object") {
        const type = b.invoice.type === "company" ? "company" : "person";
        invoice = {
          type, name: clean(b.invoice.name, 120), eik: clean(b.invoice.eik, 13).replace(/\s+/g, ""),
          vat: clean(b.invoice.vat, 20).replace(/\s+/g, "").toUpperCase(), mol: clean(b.invoice.mol, 80),
          address: clean(b.invoice.address, 200), city: clean(b.invoice.city, 60), consentElectronic: true,
        };
        if (invoice.name.length < 3 || invoice.address.length < 5) return res.status(400).json({ error: "Попълни име и адрес за фактурата." });
        if (type === "company" && !/^\d{9}(\d{4})?$/.test(invoice.eik)) return res.status(400).json({ error: "Невалиден ЕИК за фактурата." });
        if (type === "person") { invoice.eik = ""; invoice.vat = ""; invoice.mol = ""; }
      }

      const nowIso = new Date().toISOString();
      const { error: e1 } = await supabase.from("payments").upsert({
        id: vid, updated_at: nowIso,
        data: { kind: "video", amount: 20, currency: "EUR", status: "pending", paid: false, platform, slots, notes, createdAt: Date.now(), updatedAt: Date.now() },
      });
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("order_consents").upsert({
        id: vid, updated_at: nowIso,
        data: { kind: "video", termsVersion: TERMS_VERSION, acceptedAt: nowIso, acceptedTerms: true, over18: true, startBeforeWithdrawal: true, acknowledgeLoss: true, amountShown: 20, ...(invoice ? { invoice } : {}) },
      });
      if (e2) throw e2;
      return res.status(200).json({ ok: true, videoId: vid, amount: 20 });
    }

    if (b.action === "videoStatus") {
      const base = String(b.inquiryId || "").trim().toUpperCase();
      if (!ID_RE.test(base) || base.endsWith("-V")) return res.status(400).json({ error: "Невалиден номер." });
      const { data } = await supabase.from("payments").select("data").eq("id", `${base}-V`).maybeSingle();
      const d = data?.data;
      if (!d || d.kind !== "video") return res.status(200).json({ ok: true, exists: false });
      return res.status(200).json({ ok: true, exists: true, paid: d.paid === true, status: d.status || "pending", platform: d.platform || "", slots: d.slots || "", whenText: d.whenText || "" });
    }

    /* ── Съгласие за бюлетин (доказателство: дата и начин) ── */
    if (b.action === "newsletterConsent") {
      const email = String(b.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Невалиден имейл." });
      const { data: row } = await supabase.from("newsletter_subscribers").select("data").eq("id", email).maybeSingle();
      if (!row) return res.status(404).json({ error: "Абонатът не е намерен." });
      const data = { ...(row.data || {}), consent: { at: new Date().toISOString(), method: "Отметка във формата „Абонирай се“ на bezagencia.com", policyVersion: "1.0" } };
      await supabase.from("newsletter_subscribers").upsert({ id: email, data, updated_at: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }

    /* ── Отказ от договора ── */
    if (b.action === "withdraw") {
      const id = String(b.inquiryId || "").trim().toUpperCase();
      const email = String(b.email || "").trim().toLowerCase();
      const name = String(b.name || "").trim().slice(0, 120);
      if (!ID_RE.test(id) || !EMAIL_RE.test(email) || !name) return res.status(400).json({ error: "Попълни номера на поръчката, името и имейла си." });

      const [{ data: inq }, { data: pay }] = await Promise.all([
        supabase.from("inquiries").select("data").eq("id", id).maybeSingle(),
        supabase.from("payments").select("data").eq("id", id).maybeSingle(),
      ]);
      const inqEmail = String(inq?.data?.email || "").trim().toLowerCase();
      if (!inq || !pay?.data?.paid || inqEmail !== email) {
        return res.status(404).json({ error: "Не намираме сключен договор с тези данни. Провери номера и имейла или ни пиши на pgatov94@gmail.com." });
      }

      const { data: existing } = await supabase.from("withdrawals").select("data").eq("id", id).maybeSingle();
      const at = existing?.data?.at || new Date().toISOString();
      if (!existing) {
        const { error } = await supabase.from("withdrawals").upsert({ id, data: { at, name, email, amount: pay.data.amount ?? null }, updated_at: new Date().toISOString() });
        if (error) throw error;
      }
      const { data: cons } = await supabase.from("order_consents").select("data").eq("id", id).maybeSingle();

      // Потвърждение до клиента (чл. 49) — съдържание на изявлението, дата и час
      try {
        await sendEmail({
          to: email,
          subject: `Потвърждение за получен отказ от договор № ${id}`,
          html: emailWrap("Получихме отказа ти", `
            <p style="margin:0 0 12px;">Здравей, ${esc(name)}.</p>
            <p style="margin:0 0 12px;">Потвърждаваме, че получихме твоето изявление за отказ от договора по поръчка № <strong>${esc(id)}</strong>.</p>
            <div style="background:#f7f5f0;color:#0F172A;padding:12px 14px;border-radius:10px;font-size:15px;line-height:1.6;margin:0 0 14px;">
              <strong>Изявление:</strong> „Отказвам се от договора за предоставяне на консултантска услуга по поръчка № ${esc(id)}.“<br>
              <strong>Име:</strong> ${esc(name)}<br><strong>Имейл:</strong> ${esc(email)}<br>
              <strong>Подадено на:</strong> ${esc(sofia(at))} (българско време)
            </div>
            <p style="margin:0;">Ще обработим отказа и ще уредим връщането на дължимите суми по реда на Общите условия — не по-късно от 14 дни от подаването му, по същия платежен метод.</p>`),
        });
      } catch (e) { console.error("withdraw confirm mail:", e?.message); }

      // Известие към теб
      try {
        await sendEmail({
          to: NOTIFY_TO,
          subject: `⚠️ Отказ от договор № ${id}`,
          replyTo: email,
          html: emailWrap("Отказ от договор", `
            <p style="margin:0 0 10px;"><strong>${esc(name)}</strong> (${esc(email)}) се отказа от договора по поръчка <strong>${esc(id)}</strong>.</p>
            <div style="background:#f7f5f0;color:#0F172A;padding:12px 14px;border-radius:10px;font-size:15px;line-height:1.6;">
              Подадено: ${esc(sofia(at))}<br>
              Платена сума: ${esc(pay.data.amount ?? "—")} €<br>
              Поискал изпълнение преди края на срока за отказ: <strong>${cons?.data?.startBeforeWithdrawal ? "ДА (дължи се пропорционална част по чл. 52)" : "НЕ (връща се цялата сума по чл. 53)"}</strong>
            </div>
            <p style="margin:14px 0 0;">Върни сумата през Stripe в срок до 14 дни.</p>`),
        });
      } catch (e) { console.error("withdraw admin mail:", e?.message); }

      return res.status(200).json({ ok: true, at, atText: sofia(at), already: !!existing });
    }

    return res.status(400).json({ error: "Непознато действие." });
  } catch (e) {
    console.error("legal api:", e?.message || e);
    return res.status(500).json({ error: "Грешка на сървъра." });
  }
}

/* ───────── Отписване от бюлетина ───────── */
const unsubPage = (msg) => `<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Отписване — БезАгенция</title></head>
<body style="margin:0;background:#F7F5F0;font-family:system-ui,sans-serif;color:#0F172A;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;">
<div style="max-width:460px;background:#fff;border:1px solid #E7E2D6;border-radius:16px;padding:28px;text-align:center;">
<h1 style="font-size:22px;margin:0 0 10px;">БезАгенция</h1><p style="font-size:16px;line-height:1.6;margin:0 0 18px;">${msg}</p>
<a href="https://bezagencia.com/" style="color:#8A6410;font-weight:700;">Към сайта</a></div></body></html>`;

async function unsubscribeHandler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const email = String(req.query?.e || "").trim().toLowerCase();
  const token = String(req.query?.t || "");
  if (!email || !tokenOk(email, token)) {
    return res.status(400).send(unsubPage("Линкът за отписване е невалиден или е непълен. Пиши ни на pgatov94@gmail.com и ще те отпишем ръчно."));
  }
  try {
    await supabase.from("newsletter_subscribers").delete().eq("id", email);
    return res.status(200).send(unsubPage("Отписахме те от бюлетина. Повече няма да получаваш съобщения от нас."));
  } catch {
    return res.status(500).send(unsubPage("Възникна грешка. Опитай пак или ни пиши на pgatov94@gmail.com."));
  }
}
