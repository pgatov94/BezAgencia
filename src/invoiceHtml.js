/* Фактура към клиент (без ДДС) — печат/PDF и имейл */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = (n) => (Number(n) || 0).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const bgDateStr = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");

export const DEFAULT_INVOICE_NOTE = "Доставчикът не е регистриран по чл. 96 от ЗДДС. Не е начислен данък върху добавената стойност.";

/** seller: { name, eik, address, mol, note }, inv: sale документ */
export function invoiceHtml(seller, inv, opts = {}) {
  const b = inv.buyer || {};
  const row = (k, v) => (v ? `<tr><td style="padding:2px 10px 2px 0;color:#566074;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:2px 0;">${esc(v)}</td></tr>` : "");
  const buyerAddr = [b.address, b.city].filter(Boolean).join(", ");
  return `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Фактура № ${esc(inv.number)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#0F172A;margin:0;padding:32px;font-size:14px;line-height:1.5;}
  .wrap{max-width:780px;margin:0 auto;}
  h1{font-size:24px;margin:0 0 4px;}
  .box{border:1px solid #CFC8B6;border-radius:8px;padding:14px 16px;}
  table.items{width:100%;border-collapse:collapse;margin:20px 0 10px;}
  table.items th{background:#f4efe2;text-align:left;padding:8px 10px;font-size:13px;border-bottom:1px solid #CFC8B6;}
  table.items td{padding:10px;border-bottom:1px solid #e5dfcf;vertical-align:top;}
  .r{text-align:right;white-space:nowrap;}
  @media print{body{padding:0;} .noprint{display:none;}}
</style></head><body><div class="wrap">
${opts.email ? "" : `<div class="noprint" style="margin-bottom:16px;"><button onclick="window.print()" style="padding:10px 18px;font-size:15px;cursor:pointer;">Печат / Запази като PDF</button></div>`}
<h1>ФАКТУРА</h1>
<table style="margin:0 0 18px;"><tr><td style="padding-right:24px;">№ <b>${esc(inv.number)}</b></td><td style="padding-right:24px;">Дата на издаване: <b>${esc(bgDateStr(inv.issueDate))}</b></td><td>Дата на данъчното събитие: <b>${esc(bgDateStr(inv.supplyDate))}</b></td></tr></table>
<table style="width:100%;border-collapse:separate;border-spacing:12px 0;margin:0 -12px 8px;"><tr>
<td style="width:50%;vertical-align:top;border:1px solid #CFC8B6;padding:14px 16px;"><div style="font-weight:700;margin-bottom:6px;">ДОСТАВЧИК</div><table>
${row("Име", seller.name)}${row("ЕИК", seller.eik)}${row("Адрес", seller.address)}${row("МОЛ", seller.mol)}</table></td>
<td style="width:50%;vertical-align:top;border:1px solid #CFC8B6;padding:14px 16px;"><div style="font-weight:700;margin-bottom:6px;">ПОЛУЧАТЕЛ</div><table>
${row("Име", b.name)}${row(b.type === "company" ? "ЕИК" : "", b.type === "company" ? b.eik : "")}${row("ДДС №", b.vat)}${row("Адрес", buyerAddr)}${row("МОЛ", b.mol)}</table></td>
</tr></table>
<table style="width:100%;border-collapse:collapse;margin:20px 0 10px;"><thead><tr><th style="background:#f4efe2;text-align:left;padding:8px 10px;font-size:13px;border-bottom:1px solid #CFC8B6;">Описание</th><th style="background:#f4efe2;text-align:left;padding:8px 10px;font-size:13px;border-bottom:1px solid #CFC8B6;text-align:right;">Кол.</th><th style="background:#f4efe2;text-align:left;padding:8px 10px;font-size:13px;border-bottom:1px solid #CFC8B6;text-align:right;">Ед. цена (EUR)</th><th style="background:#f4efe2;text-align:left;padding:8px 10px;font-size:13px;border-bottom:1px solid #CFC8B6;text-align:right;">Стойност (EUR)</th></tr></thead>
<tbody><tr><td style="padding:10px;border-bottom:1px solid #e5dfcf;vertical-align:top;">${esc(inv.description)}</td><td style="padding:10px;border-bottom:1px solid #e5dfcf;vertical-align:top;text-align:right;">1</td><td style="padding:10px;border-bottom:1px solid #e5dfcf;vertical-align:top;text-align:right;white-space:nowrap;">${money(inv.amount)}</td><td style="padding:10px;border-bottom:1px solid #e5dfcf;vertical-align:top;text-align:right;white-space:nowrap;">${money(inv.amount)}</td></tr></tbody></table>
<table style="width:300px;margin-left:auto;border-collapse:collapse;">
<tr><td style="padding:3px 0;">Данъчна основа:</td><td style="padding:3px 0;text-align:right;white-space:nowrap;">${money(inv.amount)} EUR</td></tr>
<tr><td style="padding:3px 0;">ДДС:</td><td style="padding:3px 0;text-align:right;white-space:nowrap;">0,00 EUR</td></tr>
<tr><td style="padding:6px 0;border-top:1px solid #0F172A;font-weight:700;font-size:16px;">Сума за плащане:</td><td style="padding:6px 0;border-top:1px solid #0F172A;font-weight:700;font-size:16px;text-align:right;white-space:nowrap;">${money(inv.amount)} EUR</td></tr>
</table>
<p style="margin:14px 0 4px;"><b>Основание за неначисляване на ДДС:</b> ${esc(seller.note || DEFAULT_INVOICE_NOTE)}</p>
<p style="margin:4px 0;"><b>Начин на плащане:</b> ${esc(inv.payment || "Платено с карта онлайн")}${inv.paidDate ? `, на ${esc(bgDateStr(inv.paidDate))}` : ""}.</p>
<p style="margin:4px 0;color:#566074;font-size:12.5px;">Поръчка № ${esc(inv.orderId || "")}. Фактурата е издадена в електронен вид със съгласието на получателя.</p>
</div></body></html>`;
}
