import { buildXlsx, downloadBlob, xlDate } from "./xlsxLite";

/* Справки по искане на НАП (чл. 53 ДОПК): Приложение № 1, 2, 3 и таблица „Закупени активи“ — в Excel. */

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const H = (v) => ({ v, s: "hdr" });
const T = (v) => ({ v: v ?? "", s: "txt" });
const N = (v) => ({ v: r2(v), s: "num" });
const D = (iso) => (xlDate(iso) === "" ? T("") : { v: xlDate(iso), s: "date" });
const MONTHS = ["Януари", "Февруари", "Март", "Април", "Май", "Юни", "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември"];
const bgDay = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const inR = (iso, from, to) => !!iso && iso >= from && iso <= to;
const pad = (n) => String(n).padStart(2, "0");
const eurOf = (d) => r2((Number(d.amount) || 0) * (d.currency === "EUR" || !d.rate ? 1 : Number(d.rate)));
const sumF = (col, a, b) => `SUM(${col}${a}:${col}${b})`;

function head(title, sub, ncols) {
  return [[{ v: title, s: "title" }], [{ v: sub, s: "note" }], new Array(ncols).fill("")];
}

export function buildNapSheets({ settings, saleDocs = [], docs = [], assetDocs = [], from, to }) {
  const firm = `${settings.name || "БезАгенция ЕООД"}, ЕИК ${String(settings.vatId || "").replace(/^BG/i, "")}`;
  const period = `Период: ${bgDay(from)} – ${bgDay(to)}. Суми в евро.`;
  const sales = saleDocs.filter((d) => inR(d.issueDate, from, to)).sort((a, b) => String(a.issueDate).localeCompare(b.issueDate));
  const income = docs.filter((d) => d.kind === "income" && inR(d.invoiceDate, from, to));
  const expense = docs.filter((d) => d.kind === "expense" && inR(d.invoiceDate, from, to));
  const assets = assetDocs.filter((d) => inR(d.invoiceDate, from, to));

  /* ── Приложение № 1 ── */
  const a1 = head(`Приложение № 1 — Реализиран оборот (${firm})`, `${period} Източник: издадени фактури към клиенти.`, 3);
  const h1 = a1.length;
  a1.push([H("Период"), H("Оборот от освободени доставки по ЗДДС (евро)"), H("Годишен оборот в страната, определен по реда на чл. 168в от ЗДДС (евро)")]);
  const fy = Number(from.slice(0, 4)), fm = Number(from.slice(5, 7)) - 1, ty = Number(to.slice(0, 4)), tm = Number(to.slice(5, 7)) - 1;
  const turn = (a, b) => r2(sales.filter((d) => d.issueDate >= a && d.issueDate <= b).reduce((s, d) => s + (Number(d.amount) || 0), 0));
  const mStart = a1.length + 1;
  for (let k = fy * 12 + fm; k <= ty * 12 + tm; k++) {
    const y = Math.floor(k / 12), m = k % 12;
    a1.push([T(`${MONTHS[m]} ${y} г.`), N(0), N(turn(`${y}-${pad(m + 1)}-01`, `${y}-${pad(m + 1)}-31`))]);
  }
  const mEnd = a1.length;
  a1.push([{ v: "Общо", s: "tot" }, { f: sumF("B", mStart, mEnd), v: 0, s: "totNum" }, { f: sumF("C", mStart, mEnd), v: turn(from, to), s: "totNum" }]);
  a1.push([], [{ v: `По дни за ${MONTHS[tm].toLowerCase()} ${ty} г. (до ${bgDay(to)})`, s: "title" }]);
  a1.push([H("Ден"), H("Оборот от освободени доставки по ЗДДС (евро)"), H("Годишен оборот в страната по чл. 168в от ЗДДС (евро)")]);
  for (let day = 1; day <= Number(to.slice(8, 10)); day++) { const iso = `${ty}-${pad(tm + 1)}-${pad(day)}`; a1.push([D(iso), N(0), N(turn(iso, iso))]); }

  /* ── Приложение № 2 ── */
  const a2 = head(`Приложение № 2 — Издадени фактури и получени плащания (${firm})`, `${period} Свързани лица по § 1, т. 3 от ДР на ДОПК се отбелязват в последната колона.`, 9);
  a2.push([H("Фактура — номер"), H("Фактура — дата"), H("Получател"), H("БУЛСТАТ / ЕИК"), H("Предмет"), H("Стойност (евро)"), H("Дата на плащане"), H("Начин на плащане"), H("Свързано лице")]);
  const s2 = a2.length + 1;
  sales.forEach((d) => a2.push([T(d.number), D(d.issueDate), T(d.buyer?.name), T(d.buyer?.type === "company" ? d.buyer?.eik : ""), T(d.description), N(d.amount), D(d.paidDate), T(d.payment || ""), T("не")]));
  income.forEach((d) => a2.push([T(d.invoiceNo), D(d.invoiceDate), T(d.counterparty?.name), T(d.counterparty?.vatId), T(d.description), N(eurOf(d)), D(d.payDate), T(d.payMethod || ""), T("не")]));
  const e2 = a2.length;
  if (e2 < s2) a2.push([T("Няма издадени фактури"), T(""), T(""), T(""), T(""), N(0), T(""), T(""), T("")]);
  const e2b = a2.length;
  a2.push([{ v: "Общо", s: "tot" }, "", "", "", "", { f: sumF("F", s2, e2b), v: sales.reduce((s, d) => s + (Number(d.amount) || 0), 0) + income.reduce((s, d) => s + eurOf(d), 0), s: "totNum" }]);

  /* ── Приложение № 3 ── */
  const a3 = head(`Приложение № 3 — Получени фактури и извършени плащания към чуждестранни контрагенти (${firm})`, period, 8);
  a3.push([H("Фактура — номер"), H("Фактура — дата"), H("Издател"), H("VAT №"), H("Предмет"), H("Стойност (евро)"), H("Дата на плащане"), H("Начин на плащане")]);
  const s3 = a3.length + 1;
  expense.forEach((d) => a3.push([T(d.invoiceNo), D(d.invoiceDate), T(d.counterparty?.name), T(d.counterparty?.vatId), T(d.description), N(eurOf(d)), D(d.payDate), T(d.payMethod || "")]));
  if (a3.length < s3) a3.push([T("Няма получени фактури от чуждестранни контрагенти"), T(""), T(""), T(""), T(""), N(0), T(""), T("")]);
  const e3 = a3.length;
  a3.push([{ v: "Общо", s: "tot" }, "", "", "", "", { f: sumF("F", s3, e3), v: expense.reduce((s, d) => s + eurOf(d), 0), s: "totNum" }]);

  /* ── Закупени активи ── */
  const ah = head(`Закупени активи — ${firm}`, `${period} Получени фактури от български доставчици (стоки и оборудване).`, 16);
  ah.push(["№", "Артикулен код", "Описание на актива", "Доставчик", "ЕИК на доставчика", "ДДС № на доставчика", "Документ (фактура №)", "Дата на документа", "Количество", "Ед. цена с ДДС (евро)", "Сума с ДДС (евро)", "Данъчна основа (евро)", "ДДС 20% (евро)", "Начин на плащане", "Дата на плащане", "Купувач"].map(H));
  const hAssets = ah.length - 1;
  const s4 = ah.length + 1;
  let n = 0, totQty = 0, totSum = 0, totBase = 0, totVat = 0;
  assets.sort((a, b) => String(a.invoiceDate).localeCompare(b.invoiceDate)).forEach((d) => (d.lines || []).forEach((l) => {
    n++; const row = ah.length + 1;
    const qty = Number(l.qty) || 0, price = Number(l.price) || 0, sum = r2(qty * price), base = r2(sum / 1.2), vat = r2(sum - base);
    totQty += qty; totSum += sum; totBase += base; totVat += vat;
    ah.push([{ v: n, s: "int" }, T(l.code), T(l.desc), T(d.supplier?.name), T(d.supplier?.eik), T(d.supplier?.vat), T(d.invoiceNo), D(d.invoiceDate), { v: qty, s: "int" }, N(price),
      { f: `I${row}*J${row}`, v: sum, s: "num" }, { f: `ROUND(K${row}/1.2,2)`, v: base, s: "num" }, { f: `K${row}-L${row}`, v: vat, s: "num" }, T(d.payMethod), D(d.payDate), T(d.buyer || firm)]);
  }));
  const e4 = ah.length;
  if (e4 < s4) ah.push([T("Няма закупени активи за периода")].concat(new Array(15).fill(T(""))));
  const e4b = ah.length;
  ah.push(["", "", { v: "Общо", s: "tot" }, "", "", "", "", "", { f: sumF("I", s4, e4b), v: totQty, s: "totInt" }, "", { f: sumF("K", s4, e4b), v: totSum, s: "totNum" }, { f: sumF("L", s4, e4b), v: totBase, s: "totNum" }, { f: sumF("M", s4, e4b), v: totVat, s: "totNum" }]);
  ah.push([], [{ v: "Данъчната основа и ДДС по редове са изчислени (сума с ДДС ÷ 1,2, закръглено до цент); в документа може да са посочени само общите суми.", s: "note" }]);

  const cols = [
    ["№", "Пореден номер на реда."], ["Артикулен код", "Код на артикула по документа на търговеца."], ["Описание на актива", "Наименование на закупения артикул, както е на документа."],
    ["Доставчик", "Търговец, от когото е закупен активът."], ["ЕИК на доставчика", "ЕИК на доставчика по ТР."], ["ДДС № на доставчика", "Идентификационен номер по ЗДДС на доставчика."],
    ["Документ (фактура №)", "Номер на фактурата, издадена на дружеството."], ["Дата на документа", "Дата на данъчното събитие и на документа."], ["Количество", "Закупени бройки."],
    ["Ед. цена с ДДС (евро)", "Единична цена с включен ДДС."], ["Сума с ДДС (евро)", "Количество × единична цена."], ["Данъчна основа (евро)", "Сума с ДДС ÷ 1,2, закръглена до цент."],
    ["ДДС 20% (евро)", "Сума с ДДС минус данъчната основа."], ["Начин на плащане", "Как е платена покупката."], ["Дата на плащане", "Дата на плащането."], ["Купувач", "Лицето, на което е издаден документът."],
  ];
  const desc = [[{ v: "Описание на съдържанието на колоните — лист „Закупени активи“", s: "title" }], [], [H("Колона"), H("Съдържание")], ...cols.map(([a, b]) => [T(a), T(b)])];

  const w3 = [16, 14, 30, 18, 30, 16, 16, 20, 14];
  return [
    { name: "Приложение 1", widths: [34, 26, 34], freeze: h1 + 1, heights: { [h1]: 48 }, rows: a1 },
    { name: "Приложение 2", widths: [18, 14, 30, 16, 36, 16, 16, 24, 13], freeze: 4, heights: { 3: 36 }, rows: a2 },
    { name: "Приложение 3", widths: w3.slice(0, 8), freeze: 4, heights: { 3: 36 }, rows: a3 },
    { name: "Закупени активи", widths: [5, 12, 34, 24, 14, 16, 16, 13, 10, 14, 14, 14, 12, 22, 13, 28], freeze: hAssets + 1, heights: { [hAssets]: 42 }, rows: ah },
    { name: "Описание на колоните", widths: [26, 70], rows: desc },
  ];
}

export function downloadNapExcel(args) {
  const bytes = buildXlsx(buildNapSheets(args));
  downloadBlob(`Spravki-NAP-${args.from}_${args.to}.xlsx`, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
