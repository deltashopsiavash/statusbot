function toGB(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return null;
  return Number(bytes) / (1024 ** 3);
}

function fmtGB(bytes) {
  const gb = toGB(bytes);
  if (gb === null) return 'نامشخص';
  return `${gb.toFixed(2)} گیگابایت`;
}

function fmtDateTime(ms) {
  if (!ms || Number(ms) <= 0) return 'نامشخص';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return 'نامشخص';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function daysLeft(ms) {
  if (!ms || Number(ms) <= 0) return null;
  const diff = Number(ms) - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 3600 * 1000));
}

function shortText(s, max = 18) {
  if (!s) return '—';
  const t = String(s);
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

function buildStatusMessage(view) {
  // Markdown message
  return (
`📌 *مشخصات حساب:*

${view.activeText}

👤 *نام اکانت:* \`${view.emailFull}\`
🟢 *Inbound:* \`${view.inboundText}\`

✅ *مصرف شده:* *${view.usedText}*
➕ *حجم کلی:* *${view.totalText}*
〰️ *حجم باقی‌مانده:* *${view.leftText}*

📅 *تاریخ اتمام:* \`${view.expireText}\`
⏳ *تعداد روز باقی‌مانده:* *${view.daysLeftText}*
`
  );
}

module.exports = {
  fmtGB,
  fmtDateTime,
  daysLeft,
  shortText,
  buildStatusMessage,
};
