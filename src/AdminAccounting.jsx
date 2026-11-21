import React, { useState, useEffect, useMemo } from "react";
import { buildFiles, buildVies, buildCsv, deadlineOf, docPeriod, baseCents, vatCents, downloadTxt, protocolHtml } from "./napExport";

/* Таб „Счетоводство“ — ДДС за лице по чл. 97а ЗДДС (самоначисляване) */

const inp = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid #CFC8B6", fontSize: 15, background: "#fff", color: "#0F172A", outline: "none", boxSizing: "border-box" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5, fontWeight: 600, color: "#566074" };
const eur = (c) => (c / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const pad2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function prevMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return [iso(first), iso(last)];
}

const EMPTY_FORM = {
  kind: "expense", name: "", vatId: "", country: "", address: "", invoiceNo: "", invoiceDate: "", currency: "EUR",
  amount: "", rate: "", description: "", protocolNo: "", protocolDate: "", docType: "01",
};

const IMPORT_EXAMPLE = `{
  "kind": "expense",
  "counterparty": { "name": "Meta Platforms Ireland Limited", "vatId": "IE9692928F", "country": "IE", "address": "4 Grand Canal Square, Dublin 2" },
  "invoiceNo": "FBADS-123-456",
  "invoiceDate": "2026-11-05",
  "currency": "EUR",
  "amount": 100.55,
  "description": "Реклама във Facebook/Instagram"
}`;

export default function AdminAccounting({ adminActionFetch, P, company }) {
  const defaults = {
    vatId: "BG" + company.eik, name: "БезАгенция ЕООД", submitter: company.mol, zeroSeq: "0",
    submitterEgn: "", submitterName: company.mol, submitterCity: "Асеновград", submitterPostal: "4230",
    submitterAddress: "ул. „Първомайска“ № 1, ет. 2", companyAddress: company.address, quality: "R",
  };
  const [docs, setDocs] = useState([]);
  const [settings, setSettings] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [importText, setImportText] = useState("");
  const [range, setRange] = useState(prevMonthRange());
  const [showSettings, setShowSettings] = useState(false);

  const card = { background: P.panel, border: `1px solid ${P.panelBorder}`, borderRadius: 16, padding: "20px 22px", marginBottom: 18 };
  const h = { fontFamily: "Manrope, system-ui, sans-serif", fontWeight: 700, fontSize: 18, color: P.ink, margin: "0 0 12px" };
  const btn = (primary) => ({
    background: primary ? P.gold : P.panel, color: primary ? P.bgDeep : P.ink, border: primary ? "none" : `1px solid ${P.panelBorder}`,
    borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: 14.5, cursor: "pointer", fontFamily: "Manrope, system-ui, sans-serif",
  });

  const load = async () => {
    setLoading(true);
    const { ok, data } = await adminActionFetch({ action: "accList" }, "/api/chat");
    if (ok && data?.rows) {
      const st = data.rows.find((r) => r.id === "settings");
      if (st?.data) setSettings({ ...defaults, ...st.data });
      setDocs(data.rows.filter((r) => r.id !== "settings").map((r) => ({ ...r.data, id: r.id })));
    } else if (!ok) {
      setMsg("Не успях да заредя данните. Пусна ли sql-accounting.sql в Supabase?");
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async (id, doc) => {
    const { id: _omit, ...rest } = doc;
    const { ok, data } = await adminActionFetch({ action: "accSave", id, doc: rest }, "/api/chat");
    if (!ok) throw new Error(data?.error || "Неуспешен запис.");
  };

  const nextProtocolNo = (year, list = docs) => {
    const nums = list.filter((d) => d.kind === "expense" && (d.protocolDate || "").startsWith(String(year))).map((d) => parseInt(d.protocolNo, 10)).filter((n) => !isNaN(n));
    return String((nums.length ? Math.max(...nums) : 0) + 1);
  };

  const normalize = (raw, list) => {
    const cpIn = raw.counterparty || {};
    const kind = raw.kind === "income" ? "income" : "expense";
    const d = {
      kind,
      counterparty: {
        name: String(cpIn.name || raw.name || "").trim().slice(0, 50), vatId: String(cpIn.vatId || raw.vatId || "").replace(/\s+/g, "").toUpperCase(),
        country: String(cpIn.country || raw.country || "").trim().toUpperCase().slice(0, 2), address: String(cpIn.address || raw.address || "").trim().slice(0, 120),
        city: String(cpIn.city || "").slice(0, 50), regNo: String(cpIn.regNo || "").slice(0, 30),
      },
      invoiceNo: String(raw.invoiceNo || "").trim().slice(0, 20),
      invoiceDate: String(raw.invoiceDate || "").slice(0, 10),
      currency: String(raw.currency || "EUR").toUpperCase().slice(0, 3),
      amount: Number(String(raw.amount).replace(",", ".")),
      rate: raw.rate === "" || raw.rate == null ? 0 : Number(String(raw.rate).replace(",", ".")),
      description: String(raw.description || "").trim().slice(0, 30),
    };
    if (d.currency === "EUR") d.rate = 1;
    else if (!(d.rate > 0)) throw new Error(`Фактура ${raw.invoiceNo || ""}: за валута ${d.currency} е нужен курс към EUR (rate).`);
    if (!d.counterparty.name) throw new Error("Липсва име на контрагента.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.invoiceDate)) throw new Error("Датата на фактурата трябва да е във вид гггг-мм-дд.");
    if (!d.invoiceNo) throw new Error("Липсва номер на фактурата.");
    if (!isFinite(d.amount)) throw new Error("Невалидна сума.");
    if (kind === "expense") {
      d.protocolDate = String(raw.protocolDate || d.invoiceDate).slice(0, 10);
      d.protocolNo = String(raw.protocolNo || "").trim().slice(0, 20) || nextProtocolNo(d.protocolDate.slice(0, 4), list);
      d.eventDate = String(raw.eventDate || d.invoiceDate).slice(0, 10);
    } else {
      d.docType = ["01", "02", "03"].includes(raw.docType) ? raw.docType : "01";
    }
    return d;
  };

  const submitForm = async () => {
    setMsg("");
    try {
      const raw = {
        kind: form.kind, counterparty: { name: form.name, vatId: form.vatId, country: form.country, address: form.address },
        invoiceNo: form.invoiceNo, invoiceDate: form.invoiceDate, currency: form.currency, amount: form.amount, rate: form.rate,
        description: form.description, protocolNo: form.protocolNo, protocolDate: form.protocolDate, docType: form.docType,
      };
      const d = normalize(raw, docs.filter((x) => x.id !== editId));
      const id = editId || `acc-${Date.now()}`;
      await save(id, d);
      setForm(EMPTY_FORM); setEditId(null);
      await load();
      setMsg("Записано ✓");
    } catch (e) { setMsg(e.message); }
  };

  const doImport = async () => {
    setMsg("");
    try {
      const parsed = JSON.parse(importText);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      let list = [...docs];
      const toSave = [];
      arr.forEach((raw, i) => {
        const d = normalize(raw, list);
        const id = `acc-${Date.now()}-${i}`;
        list = [...list, { ...d, id }];
        toSave.push([id, d]);
      });
      for (const [id, d] of toSave) await save(id, d);
      setImportText("");
      await load();
      setMsg(`Импортирани: ${toSave.length} ✓`);
    } catch (e) { setMsg("Импортът не успя: " + e.message); }
  };

  const edit = (d) => {
    setEditId(d.id);
    setForm({
      kind: d.kind, name: d.counterparty?.name || "", vatId: d.counterparty?.vatId || "", country: d.counterparty?.country || "", address: d.counterparty?.address || "",
      invoiceNo: d.invoiceNo || "", invoiceDate: d.invoiceDate || "", currency: d.currency || "EUR", amount: String(d.amount ?? ""), rate: d.currency === "EUR" ? "" : String(d.rate ?? ""),
      description: d.description || "", protocolNo: d.protocolNo || "", protocolDate: d.protocolDate || "", docType: d.docType || "01",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const del = async (d) => {
    if (!window.confirm(`Изтриване на документ ${d.invoiceNo}?`)) return;
    const { ok } = await adminActionFetch({ action: "accDelete", id: d.id }, "/api/chat");
    if (ok) load();
  };

  const saveSettings = async () => {
    try { await save("settings", settings); setMsg("Настройките са записани ✓"); } catch (e) { setMsg(e.message); }
  };

  const openProtocol = (d) => {
    const w = window.open("", "_blank");
    if (!w) { setMsg("Разреши изскачащите прозорци, за да отвориш протокола."); return; }
    w.document.write(protocolHtml(settings, d, { eik: company.eik, address: company.address, city: "гр. Асеновград" }));
    w.document.close();
  };

  /* ── експорт ── */
  const [from, to] = range;
  const sameMonth = from && to && from.slice(0, 7) === to.slice(0, 7) && from <= to;
  const period = sameMonth ? from.slice(0, 4) + from.slice(5, 7) : "";
  const inRange = useMemo(() => docs.filter((d) => {
    if (!sameMonth) return false;
    const dt = d.kind === "expense" ? d.protocolDate || d.invoiceDate : d.invoiceDate;
    return dt >= from && dt <= to;
  }), [docs, from, to, sameMonth]);
  const result = useMemo(() => (sameMonth ? buildFiles(settings, inRange, period) : null), [settings, inRange, period, sameMonth]);

  const vies = useMemo(() => (sameMonth ? buildVies(settings, inRange, period) : null), [settings, inRange, period, sameMonth]);

  const monthDocs = useMemo(() => [...docs].sort((a, b) => (docPeriod(b) + b.invoiceDate).localeCompare(docPeriod(a) + a.invoiceDate)), [docs]);

  const dlAll = () => {
    downloadTxt("DEKLAR.TXT", result.deklar);
    setTimeout(() => downloadTxt("PRODAGBI.TXT", result.prodagbi), 400);
    setTimeout(() => downloadTxt("POKUPKI.TXT", result.pokupki), 800);
  };
  const dlCsv = () => {
    const blob = new Blob([buildCsv(inRange)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `schetovodstvo-${period}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  const F = (label, el, style) => <label style={{ ...lbl, ...style }}>{label}{el}</label>;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div>
      <div style={card}>
        <h3 style={h}>Счетоводство — ДДС по чл. 97а (самоначисляване)</h3>
        <p style={{ margin: 0, fontSize: 14.5, color: P.inkMuted, lineHeight: 1.6 }}>
          Фактурите от чужди доставчици (Meta, Google…) се вписват като <b>протокол по чл. 117</b> в дневника за продажби (код 09, полета 02-26 и 02-22). Издадени фактури към фирми от ЕС (напр. комисионна от GetYourGuide) са код 01 и поле 02-17. Дневникът за покупки е нулев запис.
          Срок за подаване: до 14-о число на следващия месец. Преди първо подаване провери с счетоводител.
        </p>
        {msg && <p style={{ margin: "12px 0 0", fontSize: 14.5, fontWeight: 600, color: msg.includes("✓") ? P.jungle : P.coralDark }}>{msg}</p>}
      </div>

      <div style={card}>
        <h3 style={h}>{editId ? "Редакция на документ" : "Нов документ"}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
          {F("Вид", <select value={form.kind} onChange={set("kind")} style={inp}><option value="expense">Разход — получена фактура (протокол)</option><option value="income">Приход — фактура към фирма от ЕС</option></select>)}
          {F("Контрагент (име)", <input value={form.name} onChange={set("name")} style={inp} maxLength={50} />)}
          {F("ДДС номер на контрагента", <input value={form.vatId} onChange={set("vatId")} style={inp} placeholder="напр. IE9692928F" />)}
          {F("Държава (2 букви)", <input value={form.country} onChange={set("country")} style={inp} maxLength={2} placeholder="IE" />)}
          {F("Номер на фактурата", <input value={form.invoiceNo} onChange={set("invoiceNo")} style={inp} maxLength={20} />)}
          {F("Дата на фактурата", <input type="date" value={form.invoiceDate} onChange={set("invoiceDate")} style={inp} />)}
          {F("Валута", <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })} style={inp} />)}
          {F("Сума без ДДС", <input value={form.amount} onChange={set("amount")} style={inp} inputMode="decimal" />)}
          {form.currency !== "EUR" && F("Курс към EUR (1 " + (form.currency || "…") + " = ? EUR)", <input value={form.rate} onChange={set("rate")} style={inp} inputMode="decimal" />)}
          {F("Описание (до 30 знака)", <input value={form.description} onChange={set("description")} style={inp} maxLength={30} placeholder="напр. Реклама Meta Ads" />)}
          {form.kind === "expense" && F("Протокол № (празно = автоматично)", <input value={form.protocolNo} onChange={set("protocolNo")} style={inp} maxLength={20} />)}
          {form.kind === "expense" && F("Дата на протокола (празно = дата на фактурата)", <input type="date" value={form.protocolDate} onChange={set("protocolDate")} style={inp} />)}
          {form.kind === "income" && F("Вид документ", <select value={form.docType} onChange={set("docType")} style={inp}><option value="01">01 Фактура</option><option value="02">02 Дебитно известие</option><option value="03">03 Кредитно известие</option></select>)}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={submitForm} style={btn(true)}>{editId ? "Запази промените" : "Запиши документа"}</button>
          {editId && <button onClick={() => { setEditId(null); setForm(EMPTY_FORM); }} style={btn(false)}>Отказ</button>}
        </div>

        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, color: P.goldText, fontSize: 15 }}>Импорт от Claude (поставяш готовите данни)</summary>
          <p style={{ fontSize: 14, color: P.inkMuted, margin: "10px 0" }}>Пращаш фактурата на Claude, получаваш готов текст и го поставяш тук. Приема един документ или списък.</p>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={9} placeholder={IMPORT_EXAMPLE} style={{ ...inp, fontFamily: "monospace", fontSize: 13 }} />
          <button onClick={doImport} disabled={!importText.trim()} style={{ ...btn(true), marginTop: 10, opacity: importText.trim() ? 1 : 0.5 }}>Импортирай</button>
        </details>
      </div>

      <div style={card}>
        <h3 style={h}>Документи {loading && <span style={{ fontSize: 13, color: P.inkFaint }}>зареждане…</span>}</h3>
        {monthDocs.length === 0 && !loading && <p style={{ margin: 0, color: P.inkMuted }}>Още няма въведени документи.</p>}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead><tr style={{ textAlign: "left", color: P.inkMuted }}>
              {["Период", "Вид", "Контрагент", "Фактура", "Основа", "ДДС 20%", "Протокол", ""].map((x) => <th key={x} style={{ padding: "6px 8px", borderBottom: `1px solid ${P.panelBorder}`, whiteSpace: "nowrap" }}>{x}</th>)}
            </tr></thead>
            <tbody>{monthDocs.map((d) => {
              const base = baseCents(d);
              return (
                <tr key={d.id} style={{ borderBottom: `1px solid ${P.panelBorder}` }}>
                  <td style={{ padding: "7px 8px" }}>{docPeriod(d)}</td>
                  <td style={{ padding: "7px 8px" }}>{d.kind === "expense" ? "Разход" : "Приход"}</td>
                  <td style={{ padding: "7px 8px" }}>{d.counterparty?.name}<div style={{ fontSize: 12, color: P.inkFaint }}>{d.counterparty?.vatId}</div></td>
                  <td style={{ padding: "7px 8px" }}>{d.invoiceNo}<div style={{ fontSize: 12, color: P.inkFaint }}>{d.invoiceDate} · {d.amount} {d.currency}</div></td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{eur(base)}</td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{d.kind === "expense" ? eur(vatCents(base)) : "—"}</td>
                  <td style={{ padding: "7px 8px" }}>{d.kind === "expense" ? `№ ${d.protocolNo}` : "—"}</td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>
                    {d.kind === "expense" && <button onClick={() => openProtocol(d)} style={{ ...btn(false), padding: "5px 10px", fontSize: 13 }}>Протокол</button>}{" "}
                    <button onClick={() => edit(d)} style={{ ...btn(false), padding: "5px 10px", fontSize: 13 }}>Редакция</button>{" "}
                    <button onClick={() => del(d)} style={{ ...btn(false), padding: "5px 10px", fontSize: 13, color: P.coralDark }}>Изтрий</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <h3 style={h}>Експорт за НАП</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          {F("От дата", <input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} style={inp} />, { width: 180 })}
          {F("До дата", <input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} style={inp} />, { width: 180 })}
          <button onClick={() => setRange(prevMonthRange())} style={btn(false)}>Предишен месец</button>
        </div>
        {!sameMonth && <p style={{ color: P.coralDark, fontWeight: 600, fontSize: 14.5, margin: "12px 0 0" }}>НАП приема файловете за един данъчен период (един календарен месец). Избери „От“ и „До“ в един и същ месец.</p>}
        {result && (
          <>
            <div style={{ background: "rgba(15,23,42,0.03)", border: `1px solid ${P.panelBorder}`, borderRadius: 12, padding: "14px 16px", margin: "14px 0", fontSize: 15, lineHeight: 1.7, color: P.ink }}>
              <div>Период: <b>{period.slice(4)}/{period.slice(0, 4)}</b> · срок за подаване: <b>{deadlineOf(period)}</b></div>
              <div>Документи в дневника за продажби: <b>{result.summary.salesCount}</b></div>
              <div>Самоначислена основа (протоколи): <b>{result.summary.baseSelfCharged.toFixed(2)} €</b> · самоначислен ДДС: <b>{result.summary.vatSelfCharged.toFixed(2)} €</b></div>
              <div>Услуги по чл. 21, ал. 2 към ЕС (кл. 17): <b>{result.summary.baseServicesEU.toFixed(2)} €</b></div>
              <div style={{ fontSize: 17, marginTop: 4 }}>ДДС за внасяне (кл. 50): <b>{result.summary.vatDue.toFixed(2)} €</b></div>
            </div>
            {result.warnings.length > 0 && <ul style={{ color: P.coralDark, fontSize: 14.5, margin: "0 0 12px", paddingLeft: 20 }}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            {result.checks.length > 0 && <ul style={{ color: P.coralDark, fontSize: 14.5, margin: "0 0 12px", paddingLeft: 20 }}>{result.checks.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={dlAll} style={btn(true)}>Изтегли трите файла</button>
              <button onClick={() => downloadTxt("DEKLAR.TXT", result.deklar)} style={btn(false)}>DEKLAR.TXT</button>
              <button onClick={() => downloadTxt("PRODAGBI.TXT", result.prodagbi)} style={btn(false)}>PRODAGBI.TXT</button>
              <button onClick={() => downloadTxt("POKUPKI.TXT", result.pokupki)} style={btn(false)}>POKUPKI.TXT</button>
              <button onClick={dlCsv} style={btn(false)}>Таблица за проверка (CSV)</button>
            </div>
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, border: `1px solid ${P.panelBorder}`, background: "rgba(15,23,42,0.03)" }}>
              <div style={{ fontWeight: 700, color: P.ink, marginBottom: 4 }}>VIES декларация</div>
              {vies?.needed ? (
                <>
                  <div style={{ fontSize: 14.5, color: P.inkMuted, lineHeight: 1.6 }}>За този месец е нужна: {vies.rows} контрагент(а), услуги по чл. 21, ал. 2 за {vies.total.toFixed(2)} €. Подава се заедно със справката-декларация, до {deadlineOf(period)}.</div>
                  {vies.warnings.length > 0 && <ul style={{ color: P.coralDark, fontSize: 14.5, margin: "8px 0", paddingLeft: 20 }}>{vies.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                  <button onClick={() => downloadTxt("VIES.TXT", vies.text)} style={{ ...btn(true), marginTop: 8 }}>Изтегли VIES.TXT</button>
                </>
              ) : (
                <div style={{ fontSize: 14.5, color: P.inkMuted }}>Не е нужна за този период — няма издадени фактури към фирми от ЕС (чл. 117, ал. 5 от ППЗДДС).</div>
              )}
            </div>
            <p style={{ fontSize: 13.5, color: P.inkFaint, margin: "12px 0 0", lineHeight: 1.6 }}>
              Файловете са във формат windows-1251, с точните имена и структура по Приложение № 12 към ППЗДДС. Стойностите са в евро (за периоди от 01.01.2026 г.). Качват се в портала на НАП (Справка-декларация по ЗДДС → подаване с файлове).
            </p>
          </>
        )}
      </div>

      <div style={card}>
        <button onClick={() => setShowSettings(!showSettings)} style={{ ...btn(false), marginBottom: showSettings ? 14 : 0 }}>{showSettings ? "Скрий" : "Данни за декларацията"}</button>
        {showSettings && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            {F("ДДС номер на лицето", <input value={settings.vatId} onChange={(e) => setSettings({ ...settings, vatId: e.target.value.toUpperCase() })} style={inp} maxLength={15} />)}
            {F("Наименование (до 50 знака)", <input value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} style={inp} maxLength={50} />)}
            {F("Лице, подаващо данните", <input value={settings.submitter} onChange={(e) => setSettings({ ...settings, submitter: e.target.value })} style={inp} maxLength={50} />)}
            {F("Пореден № в нулевия дневник за покупки", <select value={settings.zeroSeq} onChange={(e) => setSettings({ ...settings, zeroSeq: e.target.value })} style={inp}><option value="0">0 (по ППЗДДС, чл. 113, ал. 3)</option><option value="1">1 (ако порталът откаже 0)</option></select>)}
            {F("ЕГН/ЛНЧ на подаващия (за VIES)", <input value={settings.submitterEgn} onChange={(e) => setSettings({ ...settings, submitterEgn: e.target.value })} style={inp} maxLength={15} />)}
            {F("Три имена на подаващия (VIES)", <input value={settings.submitterName} onChange={(e) => setSettings({ ...settings, submitterName: e.target.value })} style={inp} maxLength={150} />)}
            {F("Град (VIES)", <input value={settings.submitterCity} onChange={(e) => setSettings({ ...settings, submitterCity: e.target.value })} style={inp} maxLength={50} />)}
            {F("Пощенски код (VIES)", <input value={settings.submitterPostal} onChange={(e) => setSettings({ ...settings, submitterPostal: e.target.value })} style={inp} maxLength={4} />)}
            {F("Адрес за кореспонденция (VIES)", <input value={settings.submitterAddress} onChange={(e) => setSettings({ ...settings, submitterAddress: e.target.value })} style={inp} maxLength={150} />)}
            {F("Адрес на фирмата (VIES)", <input value={settings.companyAddress} onChange={(e) => setSettings({ ...settings, companyAddress: e.target.value })} style={inp} maxLength={200} />)}
            {F("Качество на подаващия", <select value={settings.quality} onChange={(e) => setSettings({ ...settings, quality: e.target.value })} style={inp}><option value="R">Представляващ</option><option value="A">Пълномощник</option></select>)}
            <div style={{ alignSelf: "end" }}><button onClick={saveSettings} style={btn(true)}>Запази</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
