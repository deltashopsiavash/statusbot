function bytesToHuman(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return 'نامشخص';
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  const units = ['KB','MB','GB','TB','PB'];
  let v = b;
  let i = -1;
  while (v >= 1024 && i < units.length-1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}

function msToDate(ms) {
  if (!ms || Number(ms) <= 0) return null;
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return null; 
  return d;
}

function remainingTimeText(ms) {
  if (!ms || Number(ms) <= 0) return 'نامشخص';
  const now = Date.now();
  const diff = Number(ms) - now;
  if (diff <= 0) return 'منقضی شده';
  const days = Math.floor(diff / (24*3600*1000));
  const hours = Math.floor((diff % (24*3600*1000)) / (3600*1000));
  const mins = Math.floor((diff % (3600*1000)) / (60*1000));
  if (days > 0) return `${days} روز و ${hours} ساعت`;
  if (hours > 0) return `${hours} ساعت و ${mins} دقیقه`;
  return `${mins} دقیقه`;
}

function safe(val) {
  if (val === null || val === undefined || val === '') return 'نامشخص';
  return String(val);
}

module.exports = { bytesToHuman, msToDate, remainingTimeText, safe };
