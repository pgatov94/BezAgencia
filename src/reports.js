import { declTable, bgDate, deadlineOf } from "./napExport";
import { buildXlsx, downloadBlob } from "./xlsxLite";

/* Четими копии на документите за НАП: Excel (.xlsx) и Word (.doc). За подаване се ползват само TXT файловете. */

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
    { name: "Дневник продажби", widths: [5, 10, 18, 12, 18, 34, 30, ...VALUE_COLS.map(() => 16)], rows: sales },
    { name: "Дневник покупки", widths: [90], rows: purch },
  ];
  if (vies?.needed) {
    sheets.push({
      name: "VIES", widths: [8, 22, 20],
      rows: [[H("VIES декларация")], ["Данъчен период", mm], [], [H("№"), H("ДДС номер на контрагента"), H("Услуги по чл. 21, ал. 2 (EUR)")], ...vies.list.map((r, i) => [i + 1, r.vin, r.amount]), [], ["", H("Общо"), vies.total]],
    });
  }
  return sheets;
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
<p style="margin-top:24pt;font-size:9pt;color:#555">Четима копия. За подаване в НАП се ползват файловете DEKLAR.TXT, PRODAGBI.TXT, POKUPKI.TXT${vies?.needed ? " и VIES.TXT" : ""}.</p>
</body></html>`;
  downloadBlob(`ZDDS-${period}.doc`, "﻿" + html, "application/msword");
}
