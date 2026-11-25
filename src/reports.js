import { declTable, bgDate, deadlineOf } from "./napExport";
import { buildXlsx, downloadBlob, xlDate } from "./xlsxLite";

/* Четими копии на документите за НАП: Excel (.xlsx) и Word (.doc). */

const H = (v) => ({ v, bold: true });
const c = (cents) => Math.round(cents) / 100;
const VALUE_COLS = [["02-10", "Общо данъчни основи"], ["02-20", "Всичко начислен ДДС"], ["02-11", "ДО 20%"], ["02-21", "ДДС 20%"], ["02-12", "ДО ВОП"], ["02-26", "ДО чл. 82, ал. 2–5"], ["02-22", "ДДС ВОП / чл. 82"], ["02-23", "ДДС лични нужди"], ["02-13", "ДО 9%"], ["02-24", "ДДС 9%"], ["02-14", "ДО 0% гл.3"], ["02-15", "ДО 0% ВОД"], ["02-16", "ДО 0% чл.140/146/173"], ["02-17", "ДО услуги чл. 21, ал. 2"], ["02-18", "ДО чл. 69, ал. 2"], ["02-19", "ДО освободени"], ["02-25", "ДО посредник тристранни"]];

export function buildReportSheets(settings, result, vies, period) {
  const mm = `${period.slice(4)}/${period.slice(0, 4)}`;
  const head = [[H("Справка-декларация по ЗДДС (четима копия)")], ["Данъчен период", mm], ["Лице", settings.name], ["ИН по ДДС", settings.vatId], ["Срок за подаване", deadlineOf(period)], []];
  const decl = [...head, [H("Кл."), H("Описание"), H("Стойност (EUR)")], ...declTable(result.sums).map(([k, d, v]) => [k, d, typeof v === "number" ? v : v])];

  const sales = [
    [H("Дневник за продажбите (Приложение № 10)")], ["Период", mm], [],
    [H("№"), H("Вид документ"), H("Номер"), H("Дата"), H("ИН контрагент"), H("Име контрагент"), H("Описание"), ...VALUE_COLS.map(([k, n]) => H(`${k} ${n}`))],
    ...result.rows.map((r) => [r.seq, r.docType, r.docNo, bgDate(r.docDate), r.cpId, r.cpName, r.desc, ...VALUE_COLS.map(([k]) => c(r.v[k]))]),
  ];
  const purch = [[H("Дневник за покупките (Приложение № 11)")], ["Период", mm], [], ["Няма документи — лице по чл. 97а (чл. 113, ал. 3 ППЗДДС). Подава се нулев запис."]];

  const sheets = [
    { name: "Справка-декларация", widths: [8, 80, 16], rows: decl },
  ];
  if (vies?.needed) {
    sheets.push({
      name: "VIES", widths: [8, 22, 20],
      rows: [[H("VIES декларация")], ["Данъчен период", mm], [], [H("№"), H("ДДС номер на контрагента"), H("Услуги по чл. 21, ал. 2 (EUR)")], ...vies.list.map((r, i) => [i + 1, r.vin, r.amount]), [], ["", H("Общо"), vies.total]],
    });
  }
  return sheets;
}

/* ── Отделни Excel файлове: Продажби и Покупки (всеки със втори лист „Кодове“) ── */
const XH = (v) => ({ v, s: "hdr" });
const XT = (v) => ({ v: v ?? "", s: "txt" });
const XN = (v) => ({ v, s: "num" });
const XCODE_NOTE = "Кодовете са по Приложение № 12 към ППЗДДС (структура на файловете за дневниците).";

const SALES_DOC_TYPES = [["01", "Фактура"], ["02", "Дебитно известие"], ["03", "Кредитно известие"], ["09", "Протокол по чл. 117 от ППЗДДС (самоначисляване за получена услуга)"]];
const SALES_COL_INFO = {
  "02-10": ["Общ размер на данъчните основи", "кл. 01 от справката-декларация"], "02-20": ["Всичко начислен ДДС", "кл. 20"],
  "02-11": ["ДО на доставки със ставка 20 %", "кл. 11"], "02-21": ["Начислен ДДС 20 %", "кл. 21"],
  "02-12": ["ДО на ВОП", "кл. 12"], "02-26": ["ДО на получени доставки по чл. 82, ал. 2–5 ЗДДС (самоначисляване)", "кл. 12"],
  "02-22": ["Начислен ДДС за ВОП и по чл. 82, ал. 2–5", "кл. 22"], "02-23": ["Начислен ДДС за лични нужди", "кл. 23"],
  "02-13": ["ДО на доставки със ставка 9 %", "кл. 13"], "02-24": ["Начислен ДДС 9 %", "кл. 24"],
  "02-14": ["ДО със ставка 0 % по глава трета ЗДДС", "кл. 14"], "02-15": ["ДО със ставка 0 % — ВОД", "кл. 15"],
  "02-16": ["ДО по чл. 140, 146 и 173 ЗДДС", "кл. 16"], "02-17": ["ДО на услуги по чл. 21, ал. 2 с място на изпълнение в друга държава членка", "кл. 17"],
  "02-18": ["ДО на доставки по чл. 69, ал. 2 ЗДДС", "кл. 18"], "02-19": ["ДО на освободени доставки", "кл. 19"], "02-25": ["ДО на доставки като посредник при тристранни операции", "кл. 18"],
};
const PURCH_COLS = [
  ["03-30", "Получени доставки, ВОП и вноски без право на данъчен кредит или без данък", "кл. 30"], ["03-31", "Данъчна основа — с право на пълен данъчен кредит", "кл. 31"],
  ["03-41", "ДДС с право на пълен данъчен кредит", "кл. 41"], ["03-32", "Данъчна основа — с право на частичен данъчен кредит", "кл. 32"],
  ["03-42", "ДДС с право на частичен данъчен кредит", "кл. 42"], ["03-43", "Коефициент по чл. 73, ал. 5 ЗДДС", "кл. 33"], ["03-44", "Годишна корекция по чл. 73, ал. 8 ЗДДС (+/−)", "кл. 43"],
];

function codesSheet(title, blocks) {
  const rows = [[{ v: title, s: "title" }], [{ v: XCODE_NOTE, s: "note" }], []];
  blocks.forEach((b) => {
    rows.push([{ v: b.name, s: "title" }], b.head.map(XH), ...b.rows.map((r) => r.map(XT)), []);
  });
  return { name: "Кодове", widths: [14, 70, 36], rows };
}

export function buildSalesWorkbook(settings, result, period) {
  const mm = `${period.slice(4)}/${period.slice(0, 4)}`;
  const rows = [[{ v: "Дневник за продажбите (Приложение № 10 към ППЗДДС)", s: "title" }], [{ v: `Данъчен период: ${mm} · ${settings.name} · ИН по ДДС ${settings.vatId}. Суми в евро. Кодовете на колоните са в лист „Кодове“.`, s: "note" }], []];
  const hdr = ["№", "Вид документ", "Номер", "Дата", "ИН контрагент", "Име контрагент", "Описание", ...VALUE_COLS.map(([k, n]) => `${n} (${k})`)];
  rows.push(hdr.map(XH));
  const first = rows.length + 1;
  result.rows.forEach((r) => rows.push([{ v: r.seq, s: "int" }, XT(r.docType), XT(r.docNo), xlDate(r.docDate) ? { v: xlDate(r.docDate), s: "date" } : XT(""), XT(r.cpId), XT(r.cpName), XT(r.desc), ...VALUE_COLS.map(([k]) => XN(c(r.v[k])))]));
  if (!result.rows.length) rows.push([XT(""), XT(""), XT("Няма документи за периода")].concat(new Array(hdr.length - 3).fill(XT(""))));
  const last = rows.length;
  rows.push(["", "", "", "", "", "", { v: "Общо", s: "tot" }, ...VALUE_COLS.map(([k], i) => ({ f: `SUM(${colLetter(7 + i)}${first}:${colLetter(7 + i)}${last})`, v: c(result.rows.reduce((a, r) => a + r.v[k], 0)), s: "totNum" }))]);
  const codes = codesSheet("Кодове — Дневник за продажбите", [
    { name: "Вид документ (колона „Вид документ“)", head: ["Код", "Значение", ""], rows: SALES_DOC_TYPES.map(([a, b]) => [a, b, ""]) },
    { name: "Колони със стойности", head: ["Код", "Значение", "Отива в справката-декларация"], rows: VALUE_COLS.map(([k]) => [k, ...SALES_COL_INFO[k]]) },
  ]);
  return [{ name: "Дневник продажби", widths: [5, 10, 18, 12, 18, 34, 30, ...VALUE_COLS.map(() => 16)], freeze: 4, heights: { 3: 52 }, rows }, codes];
}

export function buildPurchasesWorkbook(settings, period) {
  const mm = `${period.slice(4)}/${period.slice(0, 4)}`;
  const rows = [[{ v: "Дневник за покупките (Приложение № 11 към ППЗДДС)", s: "title" }], [{ v: `Данъчен период: ${mm} · ${settings.name} · ИН по ДДС ${settings.vatId}. Суми в евро. Кодовете на колоните са в лист „Кодове“.`, s: "note" }], []];
  rows.push(["№ на запис", "Вид документ", "Номер", "Дата", "ИН контрагент", "Име контрагент", "Описание", ...PURCH_COLS.map(([k, n]) => `${n} (${k})`)].map(XH));
  rows.push([{ v: Number(settings.zeroSeq) || 0, s: "int" }, XT(""), XT(""), XT(""), XT(""), XT(""), XT("Няма получени доставки с право на данъчен кредит"), ...PURCH_COLS.map(() => XN(0))]);
  rows.push([], [{ v: "Лице по чл. 97а ЗДДС — няма право на данъчен кредит; подава се нулев запис (чл. 113, ал. 3 от ППЗДДС).", s: "note" }]);
  const codes = codesSheet("Кодове — Дневник за покупките", [
    { name: "Колони със стойности", head: ["Код", "Значение", "Отива в справката-декларация"], rows: PURCH_COLS },
  ]);
  return [{ name: "Дневник покупки", widths: [10, 10, 14, 12, 16, 24, 40, ...PURCH_COLS.map(() => 18)], freeze: 4, heights: { 3: 66 }, rows }, codes];
}

const colLetter = (i) => { let s2 = ""; i++; while (i > 0) { const m = (i - 1) % 26; s2 = String.fromCharCode(65 + m) + s2; i = Math.floor((i - 1) / 26); } return s2; };
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export function downloadSalesExcel(settings, result, period) {
  downloadBlob(`Prodazhbi-${period}.xlsx`, buildXlsx(buildSalesWorkbook(settings, result, period)), XLSX_MIME);
}
export function downloadPurchasesExcel(settings, period) {
  downloadBlob(`Pokupki-${period}.xlsx`, buildXlsx(buildPurchasesWorkbook(settings, period)), XLSX_MIME);
}

export function downloadExcel(settings, result, vies, period) {
  const bytes = buildXlsx(buildReportSheets(settings, result, vies, period));
  downloadBlob(`ZDDS-${period}.xlsx`, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

export function downloadWord(settings, result, vies, period) {
  const e = (s) => String(s ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
  const f = (n) => (typeof n === "number" ? n.toFixed(2) : e(n));
  const mm = `${period.slice(4)}/${period.slice(0, 4)}`;
  const tbl = (head, rows) => `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%;font-size:10pt"><tr>${head.map((x) => `<th style="background:#eee;text-align:left">${e(x)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((x) => `<td>${f(x)}</td>`).join("")}</tr>`).join("")}</table>`;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>ЗДДС ${mm}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}h1{font-size:18pt}h2{font-size:14pt;margin-top:22pt}</style></head><body>
<h1>СПРАВКА-ДЕКЛАРАЦИЯ ПО ЗДДС</h1>
<p>Данъчен период: <b>${mm}</b><br>Регистрирано лице: <b>${e(settings.name)}</b>, ИН по ДДС <b>${e(settings.vatId)}</b><br>Срок за подаване: <b>${deadlineOf(period)}</b></p>
${tbl(["Кл.", "Описание", "Стойност (EUR)"], declTable(result.sums).filter(([, , v]) => v !== 0).map(([k, d, v]) => [k, d, v]))}
<h2>Дневник за продажбите</h2>
${result.rows.length ? tbl(["№", "Вид", "Номер", "Дата", "ИН контрагент", "Контрагент", "Описание", "Основа (02-10)", "ДДС (02-20)", "ДО услуги ЕС (02-17)"], result.rows.map((r) => [String(r.seq), r.docType, r.docNo, bgDate(r.docDate), r.cpId, r.cpName, r.desc, c(r.v["02-10"]), c(r.v["02-20"]), c(r.v["02-17"])])) : "<p>Няма документи.</p>"}
<h2>Дневник за покупките</h2><p>Лице по чл. 97а — подава се нулев запис (чл. 113, ал. 3 от ППЗДДС).</p>
${vies?.needed ? `<h2>VIES декларация</h2>${tbl(["№", "ДДС номер на контрагента", "Услуги по чл. 21, ал. 2 (EUR)"], vies.list.map((r, i) => [String(i + 1), r.vin, r.amount]))}` : ""}
<p style="margin-top:24pt;font-size:9pt;color:#555">Копие от данните в таб „Счетоводство“ на bezagencia.com.</p>
</body></html>`;
  downloadBlob(`ZDDS-${period}.doc`, "﻿" + html, "application/msword");
}
