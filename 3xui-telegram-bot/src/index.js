require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');

const { initDb } = require('./db');
const { XUI } = require('./xuiClient');
const { parseAnySubscriptionLink } = require('./parseLink');
const { safe, bytesToHuman } = require('./format');
const {
  statusKeyboard,
  panelSelectionKeyboard,
  panelManageKeyboard,
  panelDeleteConfirmKeyboard,
  adminManagementKeyboard,
  inboundSummaryKeyboard,
} = require('./ui/keyboards');
const { fmtGB, fmtDateTime, daysLeft, shortText, buildStatusMessage } = require('./ui/statusView');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is missing. Set it in .env');
  process.exit(1);
}
const ADMIN_TG_ID = String(process.env.ADMIN_TG_ID || '').trim();
if (!ADMIN_TG_ID) {
  console.error('ADMIN_TG_ID is missing. Set it in .env');
  process.exit(1);
}

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = initDb(dbPath);

const bot = new Telegraf(BOT_TOKEN);
const state = new Map();
const lastLookup = new Map();

function seedPrimaryAdmin() {
  db.prepare(`
    INSERT INTO admins (tg_id, created_at, created_by)
    VALUES (?, ?, ?)
    ON CONFLICT(tg_id) DO NOTHING
  `).run(ADMIN_TG_ID, Date.now(), 'env');
}

seedPrimaryAdmin();

function isAdmin(ctx) {
  const tgId = String(ctx.from?.id || '').trim();
  if (!tgId) return false;
  if (tgId === ADMIN_TG_ID) return true;
  const row = db.prepare('SELECT 1 FROM admins WHERE tg_id = ? LIMIT 1').get(tgId);
  return Boolean(row);
}

function adminRows() {
  return db.prepare('SELECT tg_id, created_at, created_by FROM admins ORDER BY id ASC').all();
}

function mainMenu(isAdminUser) {
  const buttons = [
    [Markup.button.callback('📊 وضعیت سرویس', 'SERVICE_STATUS')],
  ];
  if (isAdminUser) {
    buttons.push([Markup.button.callback('🛠 مدیریت', 'ADMIN_MENU')]);
  }
  return Markup.inlineKeyboard(buttons);
}

function adminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ افزودن پنل', 'ADD_PANEL')],
    [Markup.button.callback('📋 لیست پنل‌ها', 'LIST_PANELS')],
    [Markup.button.callback('📊 استعلام اینباند', 'INBOUND_INQUIRY')],
    [Markup.button.callback('👤 استعلام سهمیه کاربر', 'USER_QUOTA_LOOKUP')],
    [Markup.button.callback('👥 مدیریت ادمین‌ها', 'ADMINS_MENU')],
    [Markup.button.callback('⬅️ برگشت', 'BACK_MAIN')],
  ]);
}

function panelLabel(panel) {
  const raw = String(panel?.name || '').trim();
  return raw || String(panel?.base_url || 'پنل بدون نام');
}

function adminsListText() {
  const rows = adminRows();
  if (!rows.length) {
    return 'هیچ ادمینی ثبت نشده است.';
  }

  const lines = ['👥 لیست ادمین‌ها', ''];
  for (const [index, row] of rows.entries()) {
    const marker = row.tg_id === ADMIN_TG_ID ? ' (ادمین اصلی)' : '';
    lines.push(`${index + 1}. ${row.tg_id}${marker}`);
  }
  lines.push('');
  lines.push('برای افزودن ادمین جدید، گزینه «افزودن ادمین» را بزن.');
  return lines.join('\n');
}

function extractTelegramId(rawText) {
  const text = String(rawText || '').trim();
  const match = text.match(/\d{5,20}/);
  return match ? match[0] : '';
}

function panelDetailsText(panel) {
  const usage = getPanelQuotaStats(panel.id);
  return [
    '⚙️ مدیریت پنل',
    '',
    `📌 نام: ${panelLabel(panel)}`,
    `🌐 آدرس: ${safe(panel.base_url)}`,
    `👤 نام کاربری: ${safe(panel.username)}`,
    `🧩 WebBasePath: ${panel.web_base_path || '-'}`,
    `🆔 آیدی عددی کاربر: ${panel.owner_tg_id || '-'}`,
    `📦 سقف فروش/سهمیه: ${bytesToHuman(Number(panel.traffic_limit_bytes || 0))}`,
    `📉 مصرف ثبت‌شده دائمی: ${bytesToHuman(usage.usedBytes)}`,
    `📊 باقی‌مانده: ${bytesToHuman(usage.remainingBytes)}`,
    '',
    'یکی از گزینه‌های زیر را انتخاب کن:',
  ].join('\n');
}

function getAllPanels() {
  return db.prepare('SELECT * FROM panels ORDER BY id DESC').all();
}

function getPanelById(id) {
  return db.prepare('SELECT * FROM panels WHERE id = ?').get(id);
}

function normalizeTextInput(text) {
  return String(text || '').trim();
}

function gbToBytes(rawValue) {
  const n = Number(String(rawValue || '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1024 * 1024 * 1024);
}

function bytesToGBNumber(bytes) {
  return Math.round((Number(bytes || 0) / 1024 / 1024 / 1024) * 100) / 100;
}

function getClientKey(client, stat) {
  const c = client || {};
  const s = stat || {};
  const id = c.id || c.uuid || s.id || s.uuid || '';
  const pass = c.password || s.password || '';
  const email = c.email || s.email || '';
  return String(id || pass || email || '').trim().toLowerCase();
}

function getPanelQuotaStats(panelId) {
  const panel = getPanelById(panelId) || {};
  const row = db.prepare('SELECT COALESCE(SUM(max_used_bytes), 0) AS usedBytes, COUNT(1) AS totalClients, COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS activeClients FROM panel_client_usage WHERE panel_id = ?').get(panelId);
  const limitBytes = Number(panel.traffic_limit_bytes || 0);
  const usedBytes = Number(row?.usedBytes || 0);
  return {
    limitBytes,
    usedBytes,
    remainingBytes: Math.max(limitBytes - usedBytes, 0),
    totalClients: Number(row?.totalClients || 0),
    activeClients: Number(row?.activeClients || 0),
    archivedClients: Math.max(Number(row?.totalClients || 0) - Number(row?.activeClients || 0), 0),
  };
}

function syncPanelUsage(panelId, items) {
  const now = Date.now();
  const seen = new Set();
  const resetActive = db.prepare('UPDATE panel_client_usage SET active = 0 WHERE panel_id = ?');
  const existingStmt = db.prepare('SELECT * FROM panel_client_usage WHERE panel_id = ? AND client_key = ?');
  const insertStmt = db.prepare(`
    INSERT INTO panel_client_usage (panel_id, client_key, client_email, inbound_id, inbound_name, max_used_bytes, first_seen, last_seen, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const updateStmt = db.prepare(`
    UPDATE panel_client_usage
    SET client_email = ?, inbound_id = ?, inbound_name = ?, max_used_bytes = ?, last_seen = ?, active = 1
    WHERE panel_id = ? AND client_key = ?
  `);

  const tx = db.transaction(() => {
    resetActive.run(panelId);
    for (const item of items) {
      const clientKey = getClientKey(item.client, item.stat);
      if (!clientKey || seen.has(clientKey)) continue;
      seen.add(clientKey);
      const used = calcUsedBytes(item.stat);
      const inboundId = String(item.inbound?.id || item.inbound?.tag || '');
      const inboundName = safe(item.inbound?.remark || item.inbound?.tag || item.inbound?.protocol || `inbound-${inboundId || 'unknown'}`);
      const email = String(item.client?.email || item.stat?.email || '');
      const old = existingStmt.get(panelId, clientKey);
      if (old) {
        updateStmt.run(email, inboundId, inboundName, Math.max(Number(old.max_used_bytes || 0), used), now, panelId, clientKey);
      } else {
        insertStmt.run(panelId, clientKey, email, inboundId, inboundName, used, now, now);
      }
    }
  });
  tx();
  return getPanelQuotaStats(panelId);
}

function buildQuotaReportText(panel) {
  const usage = getPanelQuotaStats(panel.id);
  return [
    '📦 گزارش سهمیه کاربر',
    '',
    `📌 پنل: ${panelLabel(panel)}`,
    `🆔 آیدی عددی کاربر: ${panel.owner_tg_id || '-'}`,
    `📦 سهمیه کل: ${bytesToHuman(usage.limitBytes)} (${bytesToGBNumber(usage.limitBytes)} GB)`,
    `📉 مصرف/فروش ثبت‌شده: ${bytesToHuman(usage.usedBytes)} (${bytesToGBNumber(usage.usedBytes)} GB)`,
    `✅ باقی‌مانده: ${bytesToHuman(usage.remainingBytes)} (${bytesToGBNumber(usage.remainingBytes)} GB)`,
    `👥 کل کانفیگ‌های ثبت‌شده در تاریخچه: ${usage.totalClients}`,
    `🟢 کانفیگ‌های موجود در پنل: ${usage.activeClients}`,
    `🗑 حذف‌شده ولی مصرفش محفوظ است: ${usage.archivedClients}`,
    '',
    'نکته: برای به‌روز شدن مصرف، اول استعلام اینباند همان پنل را بزن تا ربات آخرین آمار را از 3x-ui بخواند.'
  ].join('\n');
}

function normalizeTotalBytes(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return 0;
  const n = Number(rawValue);
  if (Number.isNaN(n) || n <= 0) return 0;
  return n < 1e6 ? Math.round(n * 1024 * 1024 * 1024) : Math.round(n);
}

function calcUsedBytes(stat) {
  const up = Number(stat?.up ?? stat?.uplink ?? 0);
  const down = Number(stat?.down ?? stat?.downlink ?? 0);
  return (Number.isFinite(up) ? up : 0) + (Number.isFinite(down) ? down : 0);
}

function getClientTotalBytes(client, stat) {
  return normalizeTotalBytes(
    client?.totalGB ?? client?.total ?? stat?.total ?? stat?.totalGB ?? null
  );
}

function isClientEnabled(client) {
  const enabledField = client?.enable ?? client?.enabled ?? client?.isEnable;
  if (enabledField === undefined || enabledField === null || enabledField === '') return true;
  return enabledField === true
    || enabledField === 1
    || enabledField === '1'
    || String(enabledField).toLowerCase() === 'true';
}

function getClientExpiry(client, stat) {
  return client?.expiryTime ?? client?.expireTime ?? client?.expiry ?? stat?.expiryTime ?? stat?.expireTime ?? null;
}

function isExpired(client, stat) {
  const expiry = getClientExpiry(client, stat);
  return Boolean(expiry && Number(expiry) > 0 && Number(expiry) <= Date.now());
}

function isVolumeFinished(client, stat) {
  const total = getClientTotalBytes(client, stat);
  if (!total) return false;
  const used = calcUsedBytes(stat);
  return used >= total;
}

function isOnline(client, stat) {
  return isClientEnabled(client) && !isExpired(client, stat) && !isVolumeFinished(client, stat);
}

async function replyOrEdit(ctx, text, extra = {}) {
  try {
    if (ctx.callbackQuery?.message) {
      return await ctx.editMessageText(text, extra);
    }
  } catch (_) {}
  return ctx.reply(text, extra);
}

async function showPanelSelection(ctx, mode) {
  const rows = getAllPanels();
  if (!rows.length) {
    return replyOrEdit(ctx, 'هیچ پنلی ثبت نشده است.', adminMenu());
  }

  const keyboard = panelSelectionKeyboard(
    rows.map((panel) => ({ id: panel.id, label: panelLabel(panel) })),
    mode
  );

  const text = mode === 'inquiry'
    ? 'برای استعلام اینباند، روی نام پنل بزن:'
    : 'روی اسم پنل بزن تا منوی کامل مدیریت آن باز شود:';

  return replyOrEdit(ctx, text, keyboard);
}

async function testPanelLogin(panelLike) {
  const xui = new XUI({
    baseUrl: panelLike.base_url,
    webBasePath: panelLike.web_base_path,
    username: panelLike.username,
    password: panelLike.password,
  });
  await xui.login();
}

function buildInboundSummaryText(panel, summary) {
  const lines = [
    'لیست کانفیگ های پنل شما :',
    `📌 پنل فعال: ${panelLabel(panel)}`,
    '',
    ' وضعیت کلی :',
    ` ✅ آنلاین : ${summary.online}`,
    ` ⛔️ منقضی : ${summary.expired}`,
    ` 🚫 غیرفعال : ${summary.disabled}`,
    ` 📦 تموم‌شده (حجم) : ${summary.finished}`,
    '',
  ];

  for (const item of summary.inbounds) {
    lines.push(` 🟢 ${item.name} :`);
    lines.push(` Count : ${item.count}`);
    lines.push(` Total : ${bytesToHuman(item.totalBytes)}`);
    lines.push('');
  }

  lines.push(` Total Panel : ${bytesToHuman(summary.totalBytes)}  Total user : ${summary.totalUsers}`);
  if (summary.quota) {
    lines.push('');
    lines.push('📦 سهمیه دائمی این پنل:');
    lines.push(` کل سهمیه: ${bytesToHuman(summary.quota.limitBytes)} (${bytesToGBNumber(summary.quota.limitBytes)} GB)`);
    lines.push(` مصرف ثبت‌شده حتی حذف‌شده‌ها: ${bytesToHuman(summary.quota.usedBytes)} (${bytesToGBNumber(summary.quota.usedBytes)} GB)`);
    lines.push(` باقی‌مانده از سهمیه: ${bytesToHuman(summary.quota.remainingBytes)} (${bytesToGBNumber(summary.quota.remainingBytes)} GB)`);
    lines.push(` حذف‌شده‌های محفوظ در آمار: ${summary.quota.archivedClients}`);
  }
  return lines.join('\n');
}

async function fetchInboundSummary(panel) {
  const xui = new XUI({
    baseUrl: panel.base_url,
    webBasePath: panel.web_base_path,
    username: panel.username,
    password: panel.password,
  });

  await xui.login();
  const items = await xui.listClientsDetailed();
  const quota = syncPanelUsage(panel.id, items);
  const inboundMap = new Map();

  const summary = {
    online: 0,
    expired: 0,
    disabled: 0,
    finished: 0,
    totalUsers: 0,
    totalBytes: 0,
    quota,
    inbounds: [],
  };

  for (const item of items) {
    const inboundName = safe(
      item.inbound?.remark || item.inbound?.tag || item.inbound?.protocol || `inbound-${item.inbound?.id || 'unknown'}`
    );
    if (!inboundMap.has(inboundName)) {
      inboundMap.set(inboundName, { name: inboundName, count: 0, totalBytes: 0 });
    }

    const bucket = inboundMap.get(inboundName);
    const totalBytes = getClientTotalBytes(item.client, item.stat);

    bucket.count += 1;
    bucket.totalBytes += totalBytes;

    summary.totalUsers += 1;
    summary.totalBytes += totalBytes;
    if (isOnline(item.client, item.stat)) summary.online += 1;
    if (isExpired(item.client, item.stat)) summary.expired += 1;
    if (!isClientEnabled(item.client)) summary.disabled += 1;
    if (isVolumeFinished(item.client, item.stat)) summary.finished += 1;
  }

  summary.inbounds = Array.from(inboundMap.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return summary;
}

async function lookupAndBuildView(parsed) {
  const panels = getAllPanels();

  let found = null;
  let foundPanel = null;
  let lastErr = null;

  for (const p of panels) {
    try {
      const xui = new XUI({
        baseUrl: p.base_url,
        webBasePath: p.web_base_path,
        username: p.username,
        password: p.password,
      });
      await xui.login();
      const result = await xui.findClient(parsed);
      if (result) {
        found = result;
        foundPanel = p;
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!found) {
    const msg = lastErr ? `\n(آخرین خطا: ${lastErr.message})` : '';
    return { ok: false, errorMessage: '❌ این اشتراک در هیچ پنل ثبت‌شده‌ای پیدا نشد.' + msg };
  }

  const { inbound, client, stat } = found;
  const used = calcUsedBytes(stat);
  const totalBytes = getClientTotalBytes(client, stat) || null;
  const remainingBytes = totalBytes !== null ? Math.max(totalBytes - used, 0) : null;
  const expiry = getClientExpiry(client, stat);
  const dLeft = daysLeft(expiry);
  const active = isOnline(client, stat);

  const view = {
    activeText: active ? 'فعال ✅' : 'غیرفعال ⛔️',
    emailFull: safe(client?.email),
    inboundText: safe(inbound?.remark || inbound?.tag || inbound?.protocol),
    usedText: fmtGB(used),
    totalText: totalBytes !== null ? fmtGB(totalBytes) : 'نامشخص',
    leftText: remainingBytes !== null ? fmtGB(remainingBytes) : 'نامشخص',
    expireText: expiry ? fmtDateTime(expiry) : 'نامشخص',
    daysLeftText: dLeft === null ? 'نامشخص' : `${dLeft} روز`,
  };

  const msgText = buildStatusMessage(view);
  const keyboard = statusKeyboard({
    activeText: view.activeText,
    emailShort: shortText(view.emailFull, 18),
    usedText: view.usedText,
    totalText: view.totalText,
    leftText: view.leftText,
    expireText: view.expireText,
    daysLeftText: view.daysLeftText,
    refreshCb: 'REFRESH_STATUS',
  });

  return { ok: true, msgText, keyboard, meta: { foundPanel, inbound, client, parsed } };
}

bot.start(async (ctx) => {
  await ctx.reply('سلام! از منوی زیر انتخاب کنید:', mainMenu(isAdmin(ctx)));
});

bot.action('NOOP', async (ctx) => {
  await ctx.answerCbQuery();
});

bot.action('BACK_MAIN', async (ctx) => {
  await ctx.answerCbQuery();
  state.delete(ctx.chat.id);
  await replyOrEdit(ctx, 'منوی اصلی:', mainMenu(isAdmin(ctx)));
});

bot.action('ADMIN_MENU', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  state.delete(ctx.chat.id);
  await replyOrEdit(ctx, 'مدیریت:', adminMenu());
});

bot.action('ADMINS_MENU', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  state.delete(ctx.chat.id);
  await replyOrEdit(ctx, adminsListText(), adminManagementKeyboard());
});

bot.action('LIST_ADMINS', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  await replyOrEdit(ctx, adminsListText(), adminManagementKeyboard());
});

bot.action('ADD_ADMIN', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  state.set(ctx.chat.id, { step: 'ASK_ADMIN_ID', data: {} });
  await replyOrEdit(ctx, 'آیدی عددی تلگرام ادمین جدید را بفرست. می‌توانی از @userinfobot بگیری یا پیام او را فوروارد کنی تا عدد داخلش استخراج شود.', adminManagementKeyboard());
});

bot.action('LIST_PANELS', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  await showPanelSelection(ctx, 'manage');
});

bot.action('INBOUND_INQUIRY', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  await showPanelSelection(ctx, 'inquiry');
});

bot.action(/^PM:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  const panel = getPanelById(Number(ctx.match[1]));
  if (!panel) return replyOrEdit(ctx, 'این پنل پیدا نشد.', adminMenu());
  await replyOrEdit(ctx, panelDetailsText(panel), panelManageKeyboard(panel.id));
});

bot.action(/^PI:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery('در حال استعلام...');
  const panel = getPanelById(Number(ctx.match[1]));
  if (!panel) return replyOrEdit(ctx, 'این پنل پیدا نشد.', adminMenu());

  try {
    const summary = await fetchInboundSummary(panel);
    const text = buildInboundSummaryText(panel, summary);
    await replyOrEdit(ctx, text, inboundSummaryKeyboard(panel.id));
  } catch (e) {
    await replyOrEdit(ctx, `❌ استعلام پنل انجام نشد.\nخطا: ${e.message}`, panelManageKeyboard(panel.id));
  }
});

bot.action(/^PD:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  const panel = getPanelById(Number(ctx.match[1]));
  if (!panel) return replyOrEdit(ctx, 'این پنل پیدا نشد.', adminMenu());
  await replyOrEdit(ctx, `آیا از حذف پنل «${panelLabel(panel)}» مطمئنی؟`, panelDeleteConfirmKeyboard(panel.id));
});

bot.action(/^PDOK:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery('حذف شد');
  db.prepare('DELETE FROM panels WHERE id = ?').run(Number(ctx.match[1]));
  await showPanelSelection(ctx, 'manage');
});

bot.action('USER_QUOTA_LOOKUP', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  state.set(ctx.chat.id, { step: 'ASK_USER_QUOTA_ID', data: {} });
  await replyOrEdit(ctx, 'آیدی عددی کاربر را بفرست تا سهمیه و باقی‌مانده پنل‌هایش را ببینی.');
});

bot.action(/^PE:(name|user|pass|url|wbp|quota|owner):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  const field = ctx.match[1];
  const panelId = Number(ctx.match[2]);
  const panel = getPanelById(panelId);
  if (!panel) return replyOrEdit(ctx, 'این پنل پیدا نشد.', adminMenu());

  const prompts = {
    name: 'نام جدید پنل را بفرست.',
    user: 'نام کاربری جدید پنل را بفرست.',
    pass: 'رمز عبور جدید پنل را بفرست.',
    url: 'آدرس جدید پنل را کامل بفرست. مثال: http://IP:PORT یا https://domain:port',
    wbp: 'WebBasePath جدید را بفرست. اگر لازم نیست، فقط - بفرست.',
    quota: 'سهمیه جدید را به گیگ بفرست. مثال: برای ۱ ترا عدد 1000 را بفرست.',
    owner: 'آیدی عددی تلگرام کاربر مالک این پنل را بفرست. اگر نمی‌خوای ثبت شود، فقط - بفرست.',
  };

  state.set(ctx.chat.id, { step: `EDIT_${field.toUpperCase()}`, data: { panelId } });
  await replyOrEdit(ctx, `${panelDetailsText(panel)}\n\n${prompts[field]}`);
});

bot.action('ADD_PANEL', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  state.set(ctx.chat.id, { step: 'ASK_PANEL_NAME', data: {} });
  await replyOrEdit(ctx, 'اسم دلخواه برای این پنل بفرست (مثلاً: سرور آلمان).');
});

bot.action('SERVICE_STATUS', async (ctx) => {
  await ctx.answerCbQuery();
  const anyPanel = db.prepare('SELECT COUNT(1) as c FROM panels').get();
  if (!anyPanel || anyPanel.c < 1) {
    return ctx.reply('فعلاً هیچ پنلی به ربات اضافه نشده. به ادمین بگو پنل رو اضافه کنه.');
  }
  state.set(ctx.chat.id, { step: 'ASK_LINK', data: {} });
  await ctx.reply('لینک اشتراک/کانفیگ رو بفرست (VLESS / VMESS / Trojan یا لینکی که UUID داخلشه).');
});

bot.action('REFRESH_STATUS', async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = ctx.chat.id;
  const last = lastLookup.get(chatId);
  if (!last || !last.parsed) {
    return ctx.reply('برای بروزرسانی، اول از «وضعیت سرویس» لینک رو ارسال کن.');
  }

  const result = await lookupAndBuildView(last.parsed);
  if (!result.ok) {
    return ctx.reply(result.errorMessage);
  }

  try {
    await ctx.editMessageText(result.msgText, {
      parse_mode: 'Markdown',
      ...result.keyboard,
    });
  } catch (_) {
    await ctx.reply(result.msgText, { parse_mode: 'Markdown', ...result.keyboard });
  }
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const st = state.get(chatId);
  if (!st) return;

  const text = normalizeTextInput(ctx.message.text);

  if (st.step === 'ASK_ADMIN_ID') {
    const newAdminId = extractTelegramId(text);
    if (!newAdminId) {
      return ctx.reply('آیدی معتبر پیدا نشد. لطفاً فقط آیدی عددی تلگرام را بفرست.');
    }

    const exists = db.prepare('SELECT tg_id FROM admins WHERE tg_id = ?').get(newAdminId);
    if (exists) {
      state.delete(chatId);
      return ctx.reply('این ادمین قبلاً اضافه شده است.', adminManagementKeyboard());
    }

    db.prepare('INSERT INTO admins (tg_id, created_at, created_by) VALUES (?, ?, ?)').run(
      newAdminId,
      Date.now(),
      String(ctx.from?.id || '') || 'manual'
    );
    state.delete(chatId);
      return ctx.reply(`✅ ادمین جدید با آیدی ${newAdminId} اضافه شد و از الان دقیقاً مثل مدیر به همه بخش‌های ربات دسترسی دارد.`, adminManagementKeyboard());
  }

  if (st.step === 'ASK_USER_QUOTA_ID') {
    const userId = extractTelegramId(text);
    if (!userId) return ctx.reply('آیدی عددی معتبر پیدا نشد. فقط عدد را بفرست.');
    const panels = db.prepare('SELECT * FROM panels WHERE owner_tg_id = ? ORDER BY id DESC').all(userId);
    state.delete(chatId);
    if (!panels.length) return ctx.reply('برای این آیدی عددی هیچ پنلی ثبت نشده.', adminMenu());
    return ctx.reply(panels.map(buildQuotaReportText).join('\n\n--------------------\n\n'), adminMenu());
  }

  if (st.step === 'ASK_PANEL_NAME') {
    st.data.name = text;
    st.step = 'ASK_PANEL_OWNER';
    state.set(chatId, st);
    return ctx.reply('آیدی عددی تلگرام کاربر مالک این پنل را بفرست. اگر نمی‌خوای ثبت شود، فقط - بفرست.');
  }

  if (st.step === 'ASK_PANEL_OWNER') {
    st.data.owner_tg_id = text === '-' ? '' : extractTelegramId(text);
    st.step = 'ASK_PANEL_QUOTA';
    state.set(chatId, st);
    return ctx.reply('می‌خوای چند گیگ سهمیه به این کاربر بدی؟ مثلا برای ۱ ترا عدد 1000 را بفرست. اگر نامحدود/نامشخصه 0 بفرست.');
  }

  if (st.step === 'ASK_PANEL_QUOTA') {
    const bytes = gbToBytes(text);
    if (bytes === null) return ctx.reply('عدد معتبر به گیگ بفرست. مثال: 1000');
    st.data.traffic_limit_bytes = bytes;
    st.step = 'ASK_PANEL_URL';
    state.set(chatId, st);
    return ctx.reply('آدرس پنل رو بفرست (مثل: http://IP:PORT یا https://domain:port)');
  }

  if (st.step === 'ASK_PANEL_URL') {
    st.data.base_url = text.replace(/\/+$/, '');
    st.step = 'ASK_PANEL_WBP';
    state.set(chatId, st);
    return ctx.reply('اگر پنل شما WebBasePath دارد بفرست (مثلاً /panel). اگر ندارد، فقط - بفرست.');
  }

  if (st.step === 'ASK_PANEL_WBP') {
    st.data.web_base_path = text === '-' ? '' : text;
    st.step = 'ASK_PANEL_USER';
    state.set(chatId, st);
    return ctx.reply('Username پنل رو بفرست.');
  }

  if (st.step === 'ASK_PANEL_USER') {
    st.data.username = text;
    st.step = 'ASK_PANEL_PASS';
    state.set(chatId, st);
    return ctx.reply('Password پنل رو بفرست.');
  }

  if (st.step === 'ASK_PANEL_PASS') {
    st.data.password = text;

    try {
      await testPanelLogin(st.data);
    } catch (e) {
      state.delete(chatId);
      return ctx.reply(`❌ لاگین ناموفق بود.\nخطا: ${e.message}\nدوباره از منوی مدیریت تلاش کن.`);
    }

    db.prepare('INSERT INTO panels (name, base_url, web_base_path, username, password, created_at, owner_tg_id, traffic_limit_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      st.data.name || '',
      st.data.base_url,
      st.data.web_base_path || '',
      st.data.username,
      st.data.password,
      Date.now(),
      st.data.owner_tg_id || '',
      Number(st.data.traffic_limit_bytes || 0)
    );

    state.delete(chatId);
    return ctx.reply('✅ پنل با موفقیت اضافه شد.', adminMenu());
  }

  if (st.step && st.step.startsWith('EDIT_')) {
    const panel = getPanelById(Number(st.data.panelId));
    if (!panel) {
      state.delete(chatId);
      return ctx.reply('این پنل پیدا نشد.', adminMenu());
    }

    const patch = {};
    if (st.step === 'EDIT_NAME') patch.name = text;
    if (st.step === 'EDIT_USER') patch.username = text;
    if (st.step === 'EDIT_PASS') patch.password = text;
    if (st.step === 'EDIT_URL') patch.base_url = text.replace(/\/+$/, '');
    if (st.step === 'EDIT_WBP') patch.web_base_path = text === '-' ? '' : text;
    if (st.step === 'EDIT_QUOTA') {
      const bytes = gbToBytes(text);
      if (bytes === null) return ctx.reply('عدد معتبر به گیگ بفرست. مثال: 1000');
      patch.traffic_limit_bytes = bytes;
    }
    if (st.step === 'EDIT_OWNER') patch.owner_tg_id = text === '-' ? '' : extractTelegramId(text);

    const updatedPanel = {
      ...panel,
      ...patch,
    };

    if (!['EDIT_NAME', 'EDIT_QUOTA', 'EDIT_OWNER'].includes(st.step)) {
      try {
        await testPanelLogin(updatedPanel);
      } catch (e) {
        state.delete(chatId);
        return ctx.reply(`❌ تغییرات ذخیره نشد چون تست لاگین ناموفق بود.\nخطا: ${e.message}`, panelManageKeyboard(panel.id));
      }
    }

    db.prepare(`
      UPDATE panels
      SET name = ?, base_url = ?, web_base_path = ?, username = ?, password = ?, owner_tg_id = ?, traffic_limit_bytes = ?
      WHERE id = ?
    `).run(
      updatedPanel.name || '',
      updatedPanel.base_url,
      updatedPanel.web_base_path || '',
      updatedPanel.username,
      updatedPanel.password,
      updatedPanel.owner_tg_id || '',
      Number(updatedPanel.traffic_limit_bytes || 0),
      panel.id
    );

    state.delete(chatId);
    const freshPanel = getPanelById(panel.id);
    return ctx.reply('✅ اطلاعات پنل با موفقیت بروزرسانی شد.', panelManageKeyboard(freshPanel.id));
  }

  if (st.step === 'ASK_LINK') {
    const parsed = parseAnySubscriptionLink(text);
    if (!parsed) {
      return ctx.reply('نتونستم از این متن UID/UUID یا پسورد Trojan استخراج کنم. لطفاً لینک/کانفیگ صحیح بفرست.');
    }

    state.delete(chatId);
    lastLookup.set(chatId, { parsed });

    const result = await lookupAndBuildView(parsed);
    if (!result.ok) {
      return ctx.reply(result.errorMessage);
    }

    return ctx.reply(result.msgText, { parse_mode: 'Markdown', ...result.keyboard });
  }
});

bot.catch((err) => {
  console.error('Bot error', err);
});

bot.launch().then(() => console.log('Bot started'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
