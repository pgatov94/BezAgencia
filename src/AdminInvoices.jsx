import React, { useState, useEffect, useMemo } from "react";
import { invoiceHtml, money, bgDateStr, DEFAULT_INVOICE_NOTE } from "./invoiceHtml";

/* Фактури към клиенти (без ДДС): заявки от сайта → издаване → печат/PDF → имейл */

const inp = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid #CFC8B6", fontSize: 15, background: "#fff", color: "#0F172A", outline: "none", boxSizing: "border-box" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5, fontWeight: 600, color: "#566074" };
const pad2 = (n) => String(n).padStart(2, "0");
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const isoOfMs = (ms) => { if (!ms) return ""; const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

export default function AdminInvoices({ adminActionFetch, P, company, settings, saleDocs, onChanged }) {
  const [reqs, setReqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState(null); // {orderId, buyer, issueDate, supplyDate, amount, description, email}
  const [busy, setBusy] = useState("");

  const card = { background: P.panel, border: `1px solid ${P.panelBorder}`, borderRadius: 16, padding: "20px 22px", marginBottom: 18 };
  const h = { fontFamily: "Manrope, system-ui, sans-serif", fontWeight: 700, fontSize: 18, color: P.ink, margin: "0 0 12px" };
  const btn = (primary) => ({
    background: primary ? P.gold : P.panel, color: primary ? P.bgDeep : P.ink, border: primary ? "none" : `1px solid ${P.panelBorder}`,
    borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "Manrope, system-ui, sans-serif",
  });

  const seller = useMemo(() => ({
    name: company.companyName, eik: company.eik, address: settings.companyAddress || company.address, mol: company.mol,
    note: settings.invoiceNote || DEFAULT_INVOICE_NOTE,
  }), [company, settings]);

  const load = async () => {
    setLoading(true);
    const { ok, data } = await adminActionFetch({ action: "invList" }, "/api/chat");
    if (ok && data?.rows) setReqs(data.rows);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const issued = useMemo(() => [...saleDocs].sort((a, b) => String(b.number).localeCompare(String(a.number))), [saleDocs]);
  const issuedOrders = useMemo(() => new Set(saleDocs.map((d) => d.orderId)), [saleDocs]);
  const pending = reqs.filter((r) => !issuedOrders.has(r.id));
  const nextNumber = () => {
    const nums = saleDocs.map((d) => parseInt(d.number, 10)).filter((n) => !isNaN(n));
    return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(10, "0");
  };

  const startDraft = (r) => setDraft({
    orderId: r.id, buyer: { ...r.invoice }, email: r.email || "", issueDate: todayIso(), supplyDate: isoOfMs(r.paidAt) || todayIso(),
    paidDate: isoOfMs(r.paidAt) || todayIso(), amount: String(r.amount ?? ""),
    description: `Консултантска услуга — индивидуален маршрут за пътуване, поръчка ${r.id}`,
  });

  const issue = async () => {
    setMsg("");
    try {
      const amount = Number(String(draft.amount).replace(",", "."));
      if (!(amount > 0)) throw new Error("Въведи валидна сума.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.issueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.supplyDate)) throw new Error("Невалидна дата.");
      if (issuedOrders.has(draft.orderId)) throw new Error("За тази поръчка вече има фактура.");
      if (!draft.buyer.name || !draft.buyer.address) throw new Error("Липсват име или адрес на получателя.");
      const number = nextNumber();
      const doc = {
        kind: "sale", number, orderId: draft.orderId, issueDate: draft.issueDate, supplyDate: draft.supplyDate, paidDate: draft.paidDate,
        amount, currency: "EUR", description: String(draft.description || "").slice(0, 300), buyer: draft.buyer, email: draft.email,
        payment: "Платено с карта онлайн (Stripe)", sentAt: null,
      };
      const { ok, data } = await adminActionFetch({ action: "accSave", id: `sale_${number}`, doc }, "/api/chat");
      if (!ok) throw new Error(data?.error || "Неуспешен запис.");
      setDraft(null);
      await onChanged();
      setMsg(`Издадена фактура № ${number} ✓`);
    } catch (e) { setMsg(e.message); }
  };

  const openInvoice = (d) => {
    const w = window.open("", "_blank");
    if (!w) { setMsg("Разреши изскачащите прозорци, за да отвориш фактурата."); return; }
    w.document.write(invoiceHtml(seller, d));
    w.document.close();
  };

  const sendEmail = async (d) => {
    const to = window.prompt("Изпрати фактурата на имейл:", d.email || "");
    if (!to) return;
    setBusy(d.number); setMsg("");
    const html = invoiceHtml(seller, d, { email: true });
    const { ok, data } = await adminActionFetch({ action: "invSend", to: to.trim(), subject: `Фактура № ${d.number} — ${company.companyName}`, html: `<p style="font-family:Arial,sans-serif;">Здравей, в тази фактура са данните за твоето плащане по поръчка ${d.orderId}.</p>${html}` }, "/api/chat");
    setBusy("");
    if (!ok) { setMsg(data?.error || "Имейлът не е изпратен."); return; }
    const { id: _o, ...rest } = d;
    await adminActionFetch({ action: "accSave", id: `sale_${d.number}`, doc: { ...rest, email: to.trim(), sentAt: new Date().toISOString() } }, "/api/chat");
    await onChanged();
    setMsg(`Фактура № ${d.number} е изпратена на ${to.trim()} ✓`);
  };

  const setB = (k) => (e) => setDraft({ ...draft, buyer: { ...draft.buyer, [k]: e.target.value } });
  const setD = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const F = (label, el, style) => <label style={{ ...lbl, ...style }}>{label}{el}</label>;

  return (
    <div style={card}>
      <h3 style={h}>Фактури към клиенти</h3>
      <p style={{ margin: "0 0 12px", fontSize: 14.5, color: P.inkMuted, lineHeight: 1.6 }}>
        Тук се появяват поръчките, при които клиентът е отбелязал „Искам фактура“. Фактурата се издава без ДДС (основанието е в „Данни за декларацията“). Издай я до 5 дни след плащането. Издадените фактури не се изтриват — грешка се коригира с кредитно известие.
      </p>
      {msg && <p style={{ margin: "0 0 12px", fontSize: 14.5, fontWeight: 600, color: msg.includes("✓") ? P.jungle : P.coralDark }}>{msg}</p>}

      {draft && (
        <div style={{ background: "rgba(15,23,42,0.03)", border: `1px solid ${P.panelBorder}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: P.ink, marginBottom: 10 }}>Нова фактура № {nextNumber()} — поръчка {draft.orderId}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
            {F("Получател", <input value={draft.buyer.name || ""} onChange={setB("name")} style={inp} />)}
            {draft.buyer.type === "company" && F("ЕИК", <input value={draft.buyer.eik || ""} onChange={setB("eik")} style={inp} />)}
            {draft.buyer.type === "company" && F("ДДС номер", <input value={draft.buyer.vat || ""} onChange={setB("vat")} style={inp} />)}
            {draft.buyer.type === "company" && F("МОЛ", <input value={draft.buyer.mol || ""} onChange={setB("mol")} style={inp} />)}
            {F("Адрес", <input value={draft.buyer.address || ""} onChange={setB("address")} style={inp} />)}
            {F("Град", <input value={draft.buyer.city || ""} onChange={setB("city")} style={inp} />)}
            {F("Дата на издаване", <input type="date" value={draft.issueDate} onChange={setD("issueDate")} style={inp} />)}
            {F("Дата на данъчното събитие (плащане)", <input type="date" value={draft.supplyDate} onChange={setD("supplyDate")} style={inp} />)}
            {F("Сума (EUR)", <input value={draft.amount} onChange={setD("amount")} style={inp} inputMode="decimal" />)}
            {F("Имейл на клиента", <input value={draft.email} onChange={setD("email")} style={inp} />)}
          </div>
          {F("Описание", <input value={draft.description} onChange={setD("description")} style={{ ...inp, marginTop: 0 }} maxLength={300} />, { marginTop: 10 })}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={issue} style={btn(true)}>Издай фактурата</button>
            <button onClick={() => setDraft(null)} style={btn(false)}>Отказ</button>
          </div>
        </div>
      )}

      <div style={{ fontWeight: 700, color: P.ink, margin: "6px 0 8px" }}>Чакат фактура ({pending.filter((r) => r.paid).length})</div>
      {loading && <p style={{ fontSize: 14.5, color: P.inkMuted }}>Зареждам…</p>}
      {!loading && pending.length === 0 && <p style={{ fontSize: 14.5, color: P.inkMuted, margin: "0 0 12px" }}>Няма поръчки с искана фактура.</p>}
      {pending.map((r) => (
        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 0", borderTop: `1px solid ${P.panelBorder}`, opacity: r.paid ? 1 : 0.6 }}>
          <div style={{ fontSize: 14.5, color: P.ink, lineHeight: 1.5 }}>
            <b>{r.id}</b> · {r.invoice.name}{r.invoice.type === "company" ? ` (ЕИК ${r.invoice.eik})` : ""} · {r.amount ?? "?"} €
            <div style={{ fontSize: 13, color: P.inkMuted }}>{r.paid ? `Платено ${bgDateStr(isoOfMs(r.paidAt))}` : "Още не е платено"} · {r.email || "няма имейл"}</div>
          </div>
          <button onClick={() => startDraft(r)} disabled={!r.paid} style={{ ...btn(true), opacity: r.paid ? 1 : 0.5, cursor: r.paid ? "pointer" : "not-allowed" }}>Издай фактура</button>
        </div>
      ))}

      <div style={{ fontWeight: 700, color: P.ink, margin: "16px 0 8px" }}>Издадени фактури ({issued.length})</div>
      {issued.length === 0 && <p style={{ fontSize: 14.5, color: P.inkMuted, margin: 0 }}>Още няма издадени фактури.</p>}
      {issued.map((d) => (
        <div key={d.number} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 0", borderTop: `1px solid ${P.panelBorder}` }}>
          <div style={{ fontSize: 14.5, color: P.ink, lineHeight: 1.5 }}>
            <b>№ {d.number}</b> · {bgDateStr(d.issueDate)} · {d.buyer?.name} · {money(d.amount)} €
            <div style={{ fontSize: 13, color: P.inkMuted }}>Поръчка {d.orderId}{d.sentAt ? ` · изпратена на ${d.email}` : " · не е изпращана"}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => openInvoice(d)} style={btn(false)}>Печат / PDF</button>
            <button onClick={() => sendEmail(d)} disabled={busy === d.number} style={btn(true)}>{busy === d.number ? "Изпращам…" : d.sentAt ? "Изпрати пак" : "Изпрати по имейл"}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
