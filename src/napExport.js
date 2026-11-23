/*
 * Генератор на файловете за НАП по ЗДДС: DEKLAR.TXT, PRODAGBI.TXT, POKUPKI.TXT.
 * Структурата е по Приложение № 12 към Правилника за прилагане на ЗДДС (ДВ бр. 54/2024).
 * Файловете са windows-1251, полета с фиксирана дължина, без разделители, редовете завършват с CRLF.
 *
 * Режим: лице, регистрирано по чл. 97а ЗДДС (чл. 113, ал. 2 и 3 от ППЗДДС):
 *  - в дневника за продажби се отразяват САМО:
 *      а) издадени документи за услуги по чл. 21, ал. 2 ЗДДС към лица от друга държава членка (поле 02-17)
 *      б) протоколи по чл. 117 за получени услуги, за които данък дължи получателят по чл. 82, ал. 2, т. 3 (полета 02-26 и 02-22)
 *  - дневникът за покупки може да е един нулев запис.
 */

export const VAT_RATE = 0.2;

/* ─────────── помощни функции ─────────── */

const CP1251_EXTRA = {
  0x0401: 0xa8, 0x0451: 0xb8, 0x2116: 0xb9, 0x201e: 0x84, 0x201c: 0x93, 0x201d: 0x94,
  0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x20ac: 0x88, 0x00a0: 0xa0,
};

export function toCp1251(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) out[i] = c;
    else if (c >= 0x0410 && c <= 0x044f) out[i] = c - 0x0410 + 0xc0;
    else if (CP1251_EXTRA[c] != null) out[i] = CP1251_EXTRA[c];
    else out[i] = 0x3f; // '?'
  }
  return out;
}

const cents = (x) => Math.round((Number(x) || 0) * 100 + (Number(x) < 0 ? -1e-9 : 1e-9));
const fromCents = (c) => c / 100;

/** символно поле: ляво изравнено, допълнено с интервали, отрязано до дължината */
const sym = (s, n) => String(s ?? "").replace(/[\r\n\t]+/g, " ").slice(0, n).padEnd(n, " ");
/** цифрово поле: дясно изравнено; стойности с точка за стотинките (напр. "100.00") */
const numField = (c, n) => (c / 100).toFixed(2).padStart(n, " ");
const intField = (v, n) => String(Math.trunc(Number(v) || 0)).padStart(n, " ");

/** ISO дата (гггг-мм-дд) → "дд/мм/гггг" */
export function bgDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "          ";
}
export const periodOf = (iso) => (/^(\d{4})-(\d{2})/.test(iso || "") ? iso.slice(0, 4) + iso.slice(5, 7) : "");

/* ─────────── изчисления за документ ─────────── */

/** данъчна основа в евро (в цент) от сума и курс */
export function baseCents(doc) {
  const amount = Number(doc.amount) || 0;
  const rate = doc.currency === "EUR" || !doc.currency ? 1 : Number(doc.rate) || 0;
  return cents(amount * rate);
}
export const vatCents = (base) => Math.round(base * VAT_RATE);

/** Кой период (гггггмм) попада документът. Разход → дата на протокола, приход → дата на фактурата. */
export function docPeriod(doc) {
  return periodOf(doc.kind === "expense" ? doc.protocolDate || doc.invoiceDate : doc.invoiceDate);
}

/* ─────────── редове на PRODAGBI.TXT ─────────── */

const SALES_VALUE_ORDER = ["02-10", "02-20", "02-11", "02-21", "02-12", "02-26", "02-22", "02-23", "02-13", "02-24", "02-14", "02-15", "02-16", "02-17", "02-18", "02-19", "02-25"];

function salesLine(settings, period, seq, doc) {
  const base = baseCents(doc);
  const v = Object.fromEntries(SALES_VALUE_ORDER.map((k) => [k, 0]));
  let docType, docNo, docDate, cp, desc;

  if (doc.kind === "expense") {
    // Протокол по чл. 117 за получена услуга от доставчик от ЕС (чл. 82, ал. 2, т. 3 ЗДДС)
    const vat = vatCents(base);
    docType = "09";
    docNo = doc.protocolNo;
    docDate = doc.protocolDate;
    cp = doc.counterparty || {};
    desc = doc.description || "Услуга от доставчик от ЕС";
    v["02-26"] = base;
    v["02-22"] = vat;
    v["02-10"] = base; // сума на 02-11,12,13,14,15,16,26
    v["02-20"] = vat; // сума на 02-21,22,23,24
  } else {
    // Издаден документ за услуга по чл. 21, ал. 2 към данъчно задължено лице от друга държава членка
    docType = doc.docType || "01";
    docNo = doc.invoiceNo;
    docDate = doc.invoiceDate;
    cp = doc.counterparty || {};
    desc = doc.description || "Консултантски услуги";
    v["02-17"] = base;
  }

  const cpId = (cp.vatId || "").replace(/\s+/g, "").toUpperCase() || "999999999999999";
  let line =
    sym(settings.vatId, 15) + sym(period, 6) + intField(0, 4) + intField(seq, 15) +
    sym(docType, 2) + sym(docNo, 20) + sym(bgDate(docDate), 10) +
    sym(cpId, 15) + sym(cp.name, 50) + sym(desc, 30);
  for (const k of SALES_VALUE_ORDER) line += numField(v[k], 15);
  line += sym("", 2); // 02-27 (не се попълва)
  return { line, values: v, docType, meta: { docNo, docDate, cpId, cpName: cp.name || "", desc } };
}

/* ─────────── POKUPKI.TXT (нулев запис за 97а) ─────────── */

const PURCH_VALUE_ORDER = ["03-30", "03-31", "03-41", "03-32", "03-42", "03-43", "03-44"];

function zeroPurchasesLine(settings, period, seq) {
  let line =
    sym(settings.vatId, 15) + sym(period, 6) + intField(0, 4) + intField(seq, 15) +
    sym("", 2) + sym("", 20) + sym("", 10) + sym("", 15) + sym("", 50) + sym("", 30);
  for (const _ of PURCH_VALUE_ORDER) line += numField(0, 15);
  line += sym("", 2); // 03-45
  return line;
}

/* ─────────── DEKLAR.TXT ─────────── */

function deklarLine(settings, period, salesCount, purchasesCount, sums) {
  const f = (c) => numField(c, 15);
  const base = sums.base; // 02-10
  const vat = sums.vat; // 02-20
  const due = Math.max(vat, 0); // право на данъчен кредит няма → кл. 40 = 0
  const refund = 0;
  let line =
    sym(settings.vatId, 15) + sym(settings.name, 50) + sym(period, 6) + sym(settings.submitter, 50) +
    intField(salesCount, 15) + intField(purchasesCount, 15) +
    f(base) /*01-01*/ + f(vat) /*01-20*/ +
    f(sums.v11) /*01-11*/ + f(sums.v21) /*01-21*/ +
    f(sums.v12 + sums.v26) /*01-12*/ + f(sums.v22) /*01-22*/ + f(sums.v23) /*01-23*/ +
    f(sums.v13) /*01-13*/ + f(sums.v24) /*01-24*/ +
    f(sums.v14) /*01-14*/ + f(sums.v15) /*01-15*/ + f(sums.v16) /*01-16*/ +
    f(sums.v17) /*01-17*/ + f(sums.v18 + sums.v25) /*01-18*/ + f(sums.v19) /*01-19*/ +
    f(0) /*01-30*/ + f(0) /*01-31*/ + f(0) /*01-41*/ + f(0) /*01-32*/ + f(0) /*01-42*/ + f(0) /*01-43*/ +
    "0.00".padStart(4, " ") /*01-33*/ +
    f(0) /*01-40*/ + f(due) /*01-50*/ + f(refund) /*01-60*/ +
    f(0) /*01-70*/ + f(0) /*01-71*/ + f(0) /*01-80*/ + f(0) /*01-81*/ + f(0) /*01-82*/;
  return line;
}

/* ─────────── основна функция ─────────── */

/**
 * @param settings {vatId, name, submitter, zeroSeq}
 * @param docs      документи (expense / income), вече филтрирани по период
 * @param period    "гггггмм"
 */
export function buildFiles(settings, docs, period) {
  const warnings = [];
  const sorted = [...docs].sort((a, b) => {
    const da = (a.kind === "expense" ? a.protocolDate : a.invoiceDate) || "";
    const db = (b.kind === "expense" ? b.protocolDate : b.invoiceDate) || "";
    return da.localeCompare(db) || String(a.id).localeCompare(String(b.id));
  });

  if (!/^[A-Z]{2}[A-Z0-9]{2,13}$/.test((settings.vatId || "").toUpperCase())) warnings.push("Провери ДДС номера на лицето (напр. BG208991291).");
  if (!settings.submitter) warnings.push("Липсва лице, подаващо данните.");

  const sums = { base: 0, vat: 0, v11: 0, v21: 0, v12: 0, v26: 0, v22: 0, v23: 0, v13: 0, v24: 0, v14: 0, v15: 0, v16: 0, v17: 0, v18: 0, v25: 0, v19: 0 };
  const lines = [];
  const rowsOut = [];
  sorted.forEach((doc, i) => {
    if (doc.kind === "expense" && (!doc.protocolNo || !doc.protocolDate)) warnings.push(`Документ ${doc.invoiceNo || doc.id}: липсва номер или дата на протокола.`);
    if (doc.currency && doc.currency !== "EUR" && !(Number(doc.rate) > 0)) warnings.push(`Документ ${doc.invoiceNo || doc.id}: липсва курс към EUR.`);
    if (doc.kind === "expense" && !(doc.counterparty?.vatId || "").trim()) warnings.push(`Документ ${doc.invoiceNo || doc.id}: липсва ДДС номер на доставчика.`);
    if (doc.kind !== "expense" && !(doc.counterparty?.vatId || "").trim()) warnings.push(`Документ ${doc.invoiceNo || doc.id}: липсва ДДС номер на клиента (нужен за чл. 21, ал. 2).`);
    const { line, values: v, docType, meta } = salesLine(settings, period, i + 1, doc);
    lines.push(line);
    rowsOut.push({ seq: i + 1, docType, ...meta, v });
    sums.base += v["02-10"]; sums.vat += v["02-20"];
    sums.v11 += v["02-11"]; sums.v21 += v["02-21"]; sums.v12 += v["02-12"]; sums.v26 += v["02-26"]; sums.v22 += v["02-22"];
    sums.v23 += v["02-23"]; sums.v13 += v["02-13"]; sums.v24 += v["02-24"]; sums.v14 += v["02-14"]; sums.v15 += v["02-15"];
    sums.v16 += v["02-16"]; sums.v17 += v["02-17"]; sums.v18 += v["02-18"]; sums.v25 += v["02-25"]; sums.v19 += v["02-19"];
  });

  const zeroSeq = settings.zeroSeq === "1" ? 1 : 0;
  const prodagbi = lines.map((l) => l + "\r\n").join("");
  const pokupki = zeroPurchasesLine(settings, period, zeroSeq) + "\r\n";
  const deklar = deklarLine(settings, period, lines.length, 0, sums) + "\r\n";

  // вътрешни проверки (същите като на НАП)
  const checks = [];
  if (sums.base !== sums.v11 + sums.v12 + sums.v13 + sums.v14 + sums.v15 + sums.v16 + sums.v26) checks.push("01-01 ≠ сума от основите");
  if (sums.vat !== sums.v21 + sums.v22 + sums.v23 + sums.v24) checks.push("01-20 ≠ сума от данъците");

  return {
    deklar, prodagbi, pokupki, warnings, checks, rows: rowsOut, sums,
    summary: {
      period, salesCount: lines.length,
      baseSelfCharged: fromCents(sums.v26), vatSelfCharged: fromCents(sums.v22),
      baseServicesEU: fromCents(sums.v17),
      vatDue: fromCents(Math.max(sums.vat, 0)),
    },
  };
}


/* ─────────── VIES.TXT (Приложение № 15 към ППЗДДС) ─────────── */

const EU_PREFIXES = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"];
const mmYYYY = (period) => `${period.slice(4, 6)}/${period.slice(0, 4)}`;
const num12 = (c) => (c / 100).toFixed(2).padStart(12, " ");

/**
 * VIES декларация за услуги по чл. 21, ал. 2 към данъчно задължени лица от друга държава членка.
 * Подава се само ако за периода има такива доставки (чл. 117, ал. 5 ППЗДДС).
 * settings: vatId, name, submitterEgn, submitterName, submitterCity, submitterPostal, submitterAddress, companyAddress, quality ("R"|"A")
 */
export function buildVies(settings, docs, period) {
  const warnings = [];
  const byVin = new Map();
  for (const d of docs) {
    if (d.kind !== "income") continue;
    const vin = (d.counterparty?.vatId || "").replace(/\s+/g, "").toUpperCase();
    if (!vin) continue; // липсващ номер е отчетен като предупреждение в buildFiles
    const pref = vin.slice(0, 2);
    if (!EU_PREFIXES.includes(pref) || pref === "BG") warnings.push(`VIES: ${vin} няма валиден знак на друга държава членка (за Гърция се ползва EL).`);
    byVin.set(vin, (byVin.get(vin) || 0) + baseCents(d));
  }
  const rows = [...byVin.entries()];
  if (rows.length === 0) return { needed: false, text: "", rows: 0, warnings };

  if (!settings.submitterEgn) warnings.push("VIES: липсва ЕГН/ЛНЧ на лицето, подаващо декларацията (Данни за декларацията).");
  if (!/^\d{4}$/.test(String(settings.submitterPostal || ""))) warnings.push("VIES: пощенският код трябва да е 4 цифри.");

  const total = rows.reduce((a, [, c]) => a + c, 0);
  const lines = [];
  lines.push("VHR" + sym(mmYYYY(period), 7) + String(rows.length).padStart(5, " "));
  lines.push(
    "VDR" + sym(settings.submitterEgn, 15) + sym(settings.submitterName || settings.submitter, 150) + sym(settings.submitterCity, 50) +
    String(settings.submitterPostal || "").padStart(4, " ").slice(0, 4) + sym(settings.submitterAddress, 150) + sym(settings.quality === "A" ? "A" : "R", 1)
  );
  lines.push("VTR" + sym(settings.vatId, 15) + sym(settings.name, 150) + sym(settings.companyAddress, 200));
  lines.push("TTR" + num12(total) + num12(0));
  rows.forEach(([vin, c], i) => {
    lines.push("VIR" + String(i + 1).padStart(5, " ") + sym(vin, 15) + num12(0) + num12(0) + num12(c) + sym("", 7));
  });
  return { needed: true, text: lines.map((l) => l + "\r\n").join(""), rows: rows.length, total: total / 100, warnings, list: rows.map(([vin, c]) => ({ vin, amount: c / 100 })) };
}

/** срок: 14-о число на следващия месец */
export function deadlineOf(period) {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(4, 6));
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `14/${String(nm).padStart(2, "0")}/${ny}`;
}

/** сваля файл с точното име (windows-1251) */
export function downloadTxt(name, text) {
  const blob = new Blob([toCp1251(text)], { type: "text/plain;charset=windows-1251" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** CSV за проверка (UTF-8 с BOM, отваря се в Excel) */
export function buildCsv(docs) {
  const head = ["Тип", "Период", "Дата на фактура", "Номер на фактура", "Контрагент", "ДДС номер", "Държава", "Валута", "Сума", "Курс към EUR", "Данъчна основа EUR", "ДДС 20% EUR", "Протокол №", "Дата на протокол", "Код вид документ", "Поле в дневник продажби"];
  const rows = docs.map((d) => {
    const base = baseCents(d);
    const exp = d.kind === "expense";
    return [
      exp ? "Разход (протокол чл.117)" : "Приход (чл.21, ал.2)", docPeriod(d), d.invoiceDate, d.invoiceNo,
      d.counterparty?.name, d.counterparty?.vatId, d.counterparty?.country, d.currency || "EUR", d.amount, d.currency === "EUR" || !d.currency ? 1 : d.rate,
      (base / 100).toFixed(2), exp ? (vatCents(base) / 100).toFixed(2) : "0.00", exp ? d.protocolNo : "", exp ? d.protocolDate : "",
      exp ? "09" : d.docType || "01", exp ? "02-26 / 02-22" : "02-17",
    ];
  });
  const esc = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [head, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
}

/** Печатна форма на протокол по чл. 117 ЗДДС (HTML → Печат / Запази като PDF) */
export function protocolHtml(settings, doc, company) {
  const base = baseCents(doc), vat = vatCents(base);
  const e = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const m = (c) => (c / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR";
  const cp = doc.counterparty || {};
  return `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Протокол ${e(doc.protocolNo)}</title>
<style>body{font-family:Arial,sans-serif;color:#111;max-width:780px;margin:30px auto;padding:0 20px;font-size:14px}
h1{text-align:center;font-size:22px;margin:0}h2{text-align:center;font-size:14px;font-weight:normal;margin:4px 0 22px}
.meta{margin-left:auto;width:300px;line-height:1.7}.cols{display:flex;gap:30px;margin:18px 0}.cols>div{flex:1;border:1px solid #999;padding:10px 12px;line-height:1.6}
table{width:100%;border-collapse:collapse;margin:14px 0}th,td{border:1px solid #999;padding:6px 8px;text-align:left}td.r{text-align:right}
.tot{margin-left:auto;width:340px;line-height:1.8}.sign{display:flex;justify-content:space-between;margin-top:46px}.sign div{width:42%;border-top:1px solid #333;padding-top:4px}
@media print{body{margin:0}}</style></head><body>
<h1>ПРОТОКОЛ</h1><h2>по чл. 117 от Закона за данък върху добавената стойност</h2>
<div class="meta"><div>Номер: <b>${e(doc.protocolNo)}</b></div><div>Дата: <b>${e(bgDate(doc.protocolDate))}</b></div>
<div>Към фактура №: <b>${e(doc.invoiceNo)}</b></div><div>От дата: <b>${e(bgDate(doc.invoiceDate))}</b></div></div>
<div class="cols">
<div><b>Издател на протокола</b><br>като: ☒ получател &nbsp; ☐ вносител &nbsp; ☐ доставчик<br>Име: ${e(settings.name)}<br>ДДС №: ${e(settings.vatId)}<br>Идент. №: ${e(company?.eik || "")}<br>Град: ${e(company?.city || "")}<br>Адрес: ${e(company?.address || "")}</div>
<div><b>Доставчик</b><br><br>Име: ${e(cp.name)}<br>ДДС №: ${e(cp.vatId)}<br>Идент. №: ${e(cp.regNo || "")}<br>Град: ${e(cp.city || "")}<br>Адрес: ${e(cp.address || cp.country || "")}</div></div>
<table><tr><th>№</th><th>Вид на стоката или услугата</th><th>Количество</th><th>Данъчна основа</th></tr>
<tr><td>1</td><td>${e(doc.description || "Услуга")} (фактура ${e(doc.invoiceNo)}; ${e(doc.amount)} ${e(doc.currency || "EUR")}${doc.currency && doc.currency !== "EUR" ? `, курс ${e(doc.rate)}` : ""})</td><td>1</td><td class="r">${m(base)}</td></tr></table>
<div class="tot"><div>Данъчна основа: <b>${m(base)}</b></div><div>Ставка на данъка (%): <b>20</b></div><div>Размер на данъка: <b>${m(vat)}</b></div></div>
<p>Дата на възникване на данъчното събитие: <b>${e(bgDate(doc.eventDate || doc.invoiceDate))}</b></p>
<p>Основание за начисляване на данъка: <b>чл. 82, ал. 2, т. 3 от ЗДДС</b> — услуга с място на изпълнение на територията на страната (чл. 21, ал. 2), получена от доставчик, установен в друга държава членка.</p>
<div class="sign"><div>Получил:</div><div>Съставил: ${e(settings.submitter)}</div></div></body></html>`;
}


/** Справка-декларация във вид за показване: [кл., описание, стойност] (по Приложение № 13) */
export function declTable(sums) {
  const m = (c) => c / 100;
  const due = Math.max(sums.vat, 0);
  return [
    ["01", "Общ размер на данъчните основи за облагане с ДДС", m(sums.base)],
    ["20", "Всичко начислен ДДС", m(sums.vat)],
    ["11", "Данъчна основа — доставки със ставка 20 % в страната", m(sums.v11)],
    ["21", "Начислен ДДС 20 %", m(sums.v21)],
    ["12", "Данъчна основа на ВОП и на получени доставки по чл. 82, ал. 2–6 ЗДДС", m(sums.v12 + sums.v26)],
    ["22", "Начислен ДДС за ВОП и за получени доставки по чл. 82, ал. 2–6 ЗДДС", m(sums.v22)],
    ["23", "Начислен данък за доставки на стоки и услуги за лични нужди", m(sums.v23)],
    ["13", "Данъчна основа — доставки със ставка 9 %", m(sums.v13)],
    ["24", "Начислен ДДС 9 %", m(sums.v24)],
    ["14", "Данъчна основа — ставка 0 % по глава трета ЗДДС", m(sums.v14)],
    ["15", "Данъчна основа — ставка 0 % за ВОД на стоки", m(sums.v15)],
    ["16", "Данъчна основа — 0 % по чл. 140, 146 и 173 ЗДДС", m(sums.v16)],
    ["17", "Данъчна основа на услуги по чл. 21, ал. 2 с място на изпълнение в друга държава членка", m(sums.v17)],
    ["18", "Данъчна основа на доставки по чл. 69, ал. 2 ЗДДС", m(sums.v18 + sums.v25)],
    ["19", "Данъчна основа на освободени доставки и освободени ВОП", m(sums.v19)],
    ["30", "Получени доставки без право на данъчен кредит или без данък", 0],
    ["31", "Данъчна основа — с право на пълен данъчен кредит", 0],
    ["41", "ДДС с право на пълен данъчен кредит", 0],
    ["32", "Данъчна основа — с право на частичен данъчен кредит", 0],
    ["42", "ДДС с право на частичен данъчен кредит", 0],
    ["43", "Годишна корекция по чл. 73, ал. 8 (+/-)", 0],
    ["33", "Коефициент по чл. 73, ал. 5 ЗДДС", 0],
    ["40", "Общо данъчен кредит", 0],
    ["50", "ДДС за внасяне (кл. 20 − кл. 40)", m(due)],
    ["60", "ДДС за възстановяване (кл. 20 − кл. 40 < 0)", 0],
    ["70", "Данък за внасяне, приспаднат по чл. 92, ал. 1 ЗДДС", 0],
    ["71", "Данък за внасяне, внесен ефективно", 0],
    ["80", "ДДС за възстановяване по чл. 92, ал. 1 ЗДДС", 0],
    ["81", "ДДС за възстановяване по чл. 92, ал. 3 ЗДДС", 0],
    ["82", "ДДС за възстановяване по чл. 92, ал. 4 ЗДДС", 0],
  ];
}
