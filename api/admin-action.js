// Vercel Serverless Function — изпълнява админ действията, които преди
// пишеха директно в Supabase от браузъра (смяна на цена по запитване,
// ръчно маркиране "платено"). Изисква паролата за админ панела, за да
// потвърди, че заявката идва наистина от админа, а не от случаен
// посетител, познал/прочел структурата на сайта.
//
// Изисква Environment Variable ADMIN_PASSCODE във Vercel — сложи СЪЩАТА
// стойност като константата ADMIN_PASSCODE в src/App.jsx, за да остане
// паролата ти една и съща навсякъде.

import { supabaseAdmin } from "./_lib/supabaseAdmin.js";
import { sendEmail, emailWrap } from "./_lib/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { passcode, action } = req.body || {};
  const REAL_PASSCODE = process.env.ADMIN_PASSCODE;

  if (!REAL_PASSCODE) {
    res.status(500).json({ error: "Липсва ADMIN_PASSCODE в Environment Variables на Vercel." });
    return;
  }
  if (passcode !== REAL_PASSCODE) {
    res.status(401).json({ error: "Грешна парола." });
    return;
  }

  try {
    if (action === "setPaymentAmount") {
      const { id: rawId, amount } = req.body || {};
      const id = (rawId || "").trim().toUpperCase();
      const amt = Number(amount);
      if (!id || !amt || amt <= 0) {
        res.status(400).json({ error: "Невалидни данни." });
        return;
      }

      const { data: existingRow } = await supabaseAdmin.from("payments").select("data").eq("id", id).maybeSingle();
      const existing = existingRow?.data || {};

      await supabaseAdmin.from("payments").upsert({
        id,
        data: {
          ...existing,
          amount: amt, status: "pending", paid: false, updatedAt: Date.now(),
          // offerSentAt се задава само първия път — редакция на цената не
          // рестартира броенето на дните за автоматичните напомняния.
          offerSentAt: existing.offerSentAt || Date.now(),
        },
        updated_at: new Date().toISOString(),
      });

      let notifyStatus = "no-email";
      try {
        const { data: inqRow } = await supabaseAdmin.from("inquiries").select("data").eq("id", id).maybeSingle();
        const info = inqRow?.data || null;
        if (info?.email) {
          const offerLink = `https://bezagencia.com/?offer=${encodeURIComponent(id)}`;
          const ok = await sendEmail({
            to: info.email,
            subject: `Може да платиш по запитване ${id}`,
            html: emailWrap("Плащане", `
              <p style="margin:0 0 10px;">Здравей ${info.name || ""},</p>
              <p style="margin:0 0 10px;">Твоята оферта по запитване <strong style="color:#D4AF37;">${id}</strong> вече е готова за плащане.</p>
              <p style="margin:0 0 14px;font-size:22px;font-weight:700;color:#D4AF37;">${amt} €</p>
              <p style="text-align:center;margin:0;">
                <a href="${offerLink}" style="display:inline-block;background:#D4AF37;color:#0A0E17;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:15px;">Виж офертата</a>
              </p>
            `),
          });
          notifyStatus = ok ? "notified" : "notify-error";
        }
      } catch {
        notifyStatus = "notify-error";
      }

      res.status(200).json({ ok: true, notifyStatus });
      return;
    }

    if (action === "markPaid") {
      const { id: rawId, amount, currentlyPaid } = req.body || {};
      const id = (rawId || "").trim().toUpperCase();
      if (!id) {
        res.status(400).json({ error: "Невалидни данни." });
        return;
      }

      const { data: payRow } = await supabaseAdmin.from("payments").select("data").eq("id", id).maybeSingle();
      const current = payRow?.data || {};

      await supabaseAdmin.from("payments").upsert({
        id,
        data: {
          ...current,
          amount: amount ?? current.amount,
          status: currentlyPaid ? "pending" : "paid",
          paid: !currentlyPaid,
          updatedAt: Date.now(),
        },
        updated_at: new Date().toISOString(),
      });

      res.status(200).json({ ok: true });
      return;
    }

    if (action === "deletePayment") {
      const { id: rawId } = req.body || {};
      const id = (rawId || "").trim().toUpperCase();
      if (!id) { res.status(400).json({ error: "Невалидни данни." }); return; }
      await supabaseAdmin.from("payments").delete().eq("id", id);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "deleteInquiry") {
      const { id: rawId } = req.body || {};
      const id = (rawId || "").trim().toUpperCase();
      if (!id) { res.status(400).json({ error: "Невалидни данни." }); return; }
      await supabaseAdmin.from("inquiries").delete().eq("id", id);
      await supabaseAdmin.from("payments").delete().eq("id", id);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "resetCategory") {
      const { category } = req.body || {};
      if (category === "inquiries") {
        await supabaseAdmin.from("inquiries").delete().neq("id", "");
        await supabaseAdmin.from("payments").delete().neq("id", "");
      } else if (category === "payments") {
        await supabaseAdmin.from("payments").delete().neq("id", "");
      } else {
        res.status(400).json({ error: "Непозната категория." });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "getVisitStats") {
      const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows, error: visitsErr } = await supabaseAdmin
        .from("site_visits")
        .select("created_at, path, referrer, device, session_id")
        .gte("created_at", since90);
      if (visitsErr) { res.status(500).json({ error: visitsErr.message }); return; }

      const all = rows || [];
      const now = Date.now();
      const DAY = 24 * 60 * 60 * 1000;
      const within = (ms) => all.filter((r) => now - new Date(r.created_at).getTime() <= ms);

      const countUnique = (list) => new Set(list.map((r) => r.session_id).filter(Boolean)).size;

      // Прегледи по ден за последните 30 дни (за графиката).
      const byDay = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * DAY);
        const key = d.toISOString().slice(0, 10);
        byDay[key] = 0;
      }
      for (const r of within(30 * DAY)) {
        const key = new Date(r.created_at).toISOString().slice(0, 10);
        if (key in byDay) byDay[key]++;
      }

      // Най-разглеждани страници.
      const pageCounts = {};
      for (const r of all) pageCounts[r.path || "(непознато)"] = (pageCounts[r.path || "(непознато)"] || 0) + 1;
      const topPages = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

      // Топ реферери (откъде идват хората) — извличаме само домейна.
      const refCounts = {};
      for (const r of all) {
        let ref = "Директен достъп / без реферер";
        if (r.referrer) {
          try { ref = new URL(r.referrer).hostname.replace(/^www\./, ""); } catch { ref = r.referrer; }
        }
        refCounts[ref] = (refCounts[ref] || 0) + 1;
      }
      const topReferrers = Object.entries(refCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

      // Устройства.
      const deviceCounts = { mobile: 0, desktop: 0 };
      for (const r of all) {
        if (r.device === "mobile") deviceCounts.mobile++;
        else deviceCounts.desktop++;
      }

      res.status(200).json({
        ok: true,
        totalViews: { today: within(DAY).length, last7: within(7 * DAY).length, last30: within(30 * DAY).length, last90: all.length },
        uniqueVisitors: { today: countUnique(within(DAY)), last7: countUnique(within(7 * DAY)), last30: countUnique(within(30 * DAY)), last90: countUnique(all) },
        byDay,
        topPages,
        topReferrers,
        deviceCounts,
      });
      return;
    }

    res.status(400).json({ error: "Непознато действие." });
  } catch (e) {
    res.status(500).json({ error: e.message || "Неизвестна грешка." });
  }
}
