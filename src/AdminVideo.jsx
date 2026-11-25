import React, { useState, useEffect } from "react";

/* Таб „Консултации“ — платени видео консултации: насрочване и имейл с линк */

const inp = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid #CFC8B6", fontSize: 15, background: "#fff", color: "#0F172A", outline: "none", boxSizing: "border-box" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5, fontWeight: 600, color: "#566074" };
const STATUS = { pending: "Чака плащане", paid: "Платена — чака час", scheduled: "Насрочена", done: "Проведена", cancelled: "Отказана" };

export default function AdminVideo({ adminActionFetch, P }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState({}); // id -> {whenText, link}
  const [busy, setBusy] = useState("");

  const card = { background: P.panel, border: `1px solid ${P.panelBorder}`, borderRadius: 16, padding: "20px 22px", marginBottom: 18 };
  const btn = (primary) => ({
    background: primary ? P.gold : P.panel, color: primary ? P.bgDeep : P.ink, border: primary ? "none" : `1px solid ${P.panelBorder}`,
    borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "Manrope, system-ui, sans-serif",
  });

  const load = async () => {
    setLoading(true);
    const { ok, data } = await adminActionFetch({ action: "videoList" }, "/api/chat");
    if (ok && data?.rows) setRows(data.rows);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const get = (r) => edit[r.id] || { whenText: r.whenText || "", link: r.link || "" };
  const setE = (r, k, v) => setEdit({ ...edit, [r.id]: { ...get(r), [k]: v } });

  const act = async (r, status, sendEmail) => {
    setMsg(""); setBusy(r.id + status);
    const e = get(r);
    const { ok, data } = await adminActionFetch({ action: "videoSet", id: r.id, status, whenText: e.whenText, link: e.link, sendEmail: !!sendEmail }, "/api/chat");
    setBusy("");
    if (!ok) { setMsg(data?.error || "Неуспешно."); return; }
    setMsg(sendEmail ? `Записано и изпратено на клиента ✓` : "Записано ✓");
    await load();
  };

  return (
    <div style={card}>
      <h3 style={{ fontFamily: "Manrope, system-ui, sans-serif", fontWeight: 700, fontSize: 18, color: P.ink, margin: "0 0 8px" }}>Видео консултации</h3>
      <p style={{ margin: "0 0 12px", fontSize: 14.5, color: P.inkMuted, lineHeight: 1.6 }}>
        Платените консултации са 20 € / 30 мин. Създай среща (напр. в Google Calendar с Meet), вписваш дата, час и линк и натискаш „Насрочи и изпрати“. Клиентът получава имейл с линка и напомняне какво да подготви. Фактурата се издава от Счетоводство → Фактури към клиенти.
      </p>
      {msg && <p style={{ margin: "0 0 12px", fontSize: 14.5, fontWeight: 600, color: msg.includes("✓") ? P.jungle : P.coralDark }}>{msg}</p>}
      {loading && <p style={{ fontSize: 14.5, color: P.inkMuted }}>Зареждам…</p>}
      {!loading && rows.length === 0 && <p style={{ fontSize: 14.5, color: P.inkMuted, margin: 0 }}>Още няма заявки за видео консултация.</p>}
      {rows.map((r) => {
        const st = r.paid ? (r.status || "paid") : "pending";
        const e = get(r);
        return (
          <div key={r.id} style={{ borderTop: `1px solid ${P.panelBorder}`, padding: "14px 0", opacity: r.paid ? 1 : 0.6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              <div style={{ fontSize: 15, color: P.ink }}><b>{r.base}</b> · {r.name || "—"} · {r.email || "няма имейл"}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: st === "scheduled" || st === "done" ? P.jungle : P.goldText }}>{STATUS[st] || st}</div>
            </div>
            <div style={{ fontSize: 14, color: P.inkMuted, lineHeight: 1.6, marginBottom: 8 }}>
              Платформа: <b>{r.platform}</b><br />Удобни часове: {r.slots}{r.notes ? <><br />Бележки: {r.notes}</> : null}
            </div>
            {r.paid && st !== "done" && st !== "cancelled" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginBottom: 10 }}>
                  <label style={lbl}>Дата и час<input value={e.whenText} onChange={(x) => setE(r, "whenText", x.target.value)} placeholder="напр. сряда, 3 декември, 18:30 ч." style={inp} maxLength={200} /></label>
                  <label style={lbl}>Линк за срещата<input value={e.link} onChange={(x) => setE(r, "link", x.target.value)} placeholder="https://meet.google.com/…" style={inp} maxLength={500} /></label>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => act(r, "scheduled", true)} disabled={!!busy} style={btn(true)}>{st === "scheduled" ? "Изпрати пак" : "Насрочи и изпрати"}</button>
                  <button onClick={() => act(r, "done", false)} disabled={!!busy} style={btn(false)}>Проведена</button>
                  <button onClick={() => { if (window.confirm("Да отбележа ли консултацията като отказана? Парите се връщат ръчно от Stripe.")) act(r, "cancelled", false); }} disabled={!!busy} style={btn(false)}>Отказана</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
