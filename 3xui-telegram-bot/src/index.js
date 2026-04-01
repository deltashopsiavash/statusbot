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

function isAdmin(ctx) {
  return String(ctx.from?.id || '') === ADMIN_TG_ID;
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
    [Markup.button.callback('⬅️ برگشت', 'BACK_MAIN')],
  ]);
}

function panelLabel(panel) {
  const raw = String(panel?.name || '').trim();
  return raw || String(panel?.base_url || 'پنل بدون نام');
}

function panelDetailsText(panel) {
  return [
    '⚙️ مدیریت پنل',
    '',
    `📌 نام: ${panelLabel(panel)}`,
    `🌐 آدرس: ${safe(panel.base_url)}`,
    `👤 نام کاربری: ${safe(panel.username)}`,
    `🧩 WebBasePath: ${panel.web_base_path || '-'}`,
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
  const inboundMap = new Map();

  const summary = {
    online: 0,
    expired: 0,
    disabled: 0,
    finished: 0,
    totalUsers: 0,
    totalBytes: 0,
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

bot.action(/^PE:(name|user|pass|url|wbp):(\d+)$/, async (ctx) => {
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

  if (st.step === 'ASK_PANEL_NAME') {
    st.data.name = text;
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

    db.prepare('INSERT INTO panels (name, base_url, web_base_path, username, password, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      st.data.name || '',
      st.data.base_url,
      st.data.web_base_path || '',
      st.data.username,
      st.data.password,
      Date.now()
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

    const updatedPanel = {
      ...panel,
      ...patch,
    };

    if (st.step !== 'EDIT_NAME') {
      try {
        await testPanelLogin(updatedPanel);
      } catch (e) {
        state.delete(chatId);
        return ctx.reply(`❌ تغییرات ذخیره نشد چون تست لاگین ناموفق بود.\nخطا: ${e.message}`, panelManageKeyboard(panel.id));
      }
    }

    db.prepare(`
      UPDATE panels
      SET name = ?, base_url = ?, web_base_path = ?, username = ?, password = ?
      WHERE id = ?
    `).run(
      updatedPanel.name || '',
      updatedPanel.base_url,
      updatedPanel.web_base_path || '',
      updatedPanel.username,
      updatedPanel.password,
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
