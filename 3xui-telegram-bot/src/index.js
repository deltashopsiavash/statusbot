require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');

const { initDb } = require('./db');
const { XUI } = require('./xuiClient');
const { parseAnySubscriptionLink } = require('./parseLink');
const { safe } = require('./format');
const { statusKeyboard } = require('./ui/keyboards');
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

// ----- Simple state machine (per chat) -----
const state = new Map(); // chatId -> { step, data }
// Keep the last successful lookup per chat for the "refresh" button.
const lastLookup = new Map(); // chatId -> { rawText, parsed }

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
    [Markup.button.callback('⬅️ برگشت', 'BACK_MAIN')],
  ]);
}

async function lookupAndBuildView(parsed) {
  const panels = db.prepare('SELECT * FROM panels ORDER BY id DESC').all();

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
      const r = await xui.findClient(parsed);
      if (r) {
        found = r;
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

  const up = stat?.up ?? stat?.uplink ?? 0;
  const down = stat?.down ?? stat?.downlink ?? 0;
  const used = Number(up) + Number(down);

  // totalGB may be stored as bytes in some versions; in some versions it's "totalGB" in bytes/GB.
  // If it's small (< 10^6) we assume it's in GB and convert to bytes.
  let totalBytes = null;
  const totalGBField = client?.totalGB ?? client?.total ?? null;
  if (totalGBField !== null && totalGBField !== undefined && totalGBField !== '') {
    const n = Number(totalGBField);
    if (!Number.isNaN(n)) {
      totalBytes = (n < 1e6) ? Math.round(n * 1024 * 1024 * 1024) : Math.round(n);
    }
  }

  const remainingBytes = (totalBytes !== null) ? Math.max(totalBytes - used, 0) : null;
  const expiry = client?.expiryTime ?? client?.expireTime ?? client?.expiry ?? null;
  const dLeft = daysLeft(expiry);

  const enabledField = (client?.enable ?? client?.enabled ?? client?.isEnable);
  const enabled = (enabledField === undefined || enabledField === null)
    ? true
    : (enabledField === true || enabledField === 1 || enabledField === '1' || enabledField === 'true');
  const active = enabled && (!expiry || Number(expiry) <= 0 || Number(expiry) > Date.now());

  const activeText = active ? 'فعال ✅' : 'غیرفعال ⛔️';

  const email = safe(client?.email);
  const inboundText = safe(inbound?.remark || inbound?.tag || inbound?.protocol);

  const usedText = fmtGB(used);
  const totalText = totalBytes !== null ? fmtGB(totalBytes) : 'نامشخص';
  const leftText = remainingBytes !== null ? fmtGB(remainingBytes) : 'نامشخص';

  const expireText = expiry ? fmtDateTime(expiry) : 'نامشخص';
  const daysLeftText = (dLeft === null) ? 'نامشخص' : `${dLeft} روز`;

  const view = {
    activeText,
    emailFull: email,
    inboundText,
    usedText,
    totalText,
    leftText,
    expireText,
    daysLeftText,
  };

  const msgText = buildStatusMessage(view);
  const keyboard = statusKeyboard({
    activeText,
    emailShort: shortText(email, 18),
    usedText,
    totalText,
    leftText,
    expireText,
    daysLeftText,
    refreshCb: 'REFRESH_STATUS',
  });

  return { ok: true, msgText, keyboard, meta: { foundPanel, inbound, client, parsed } };
}

bot.start(async (ctx) => {
  await ctx.reply('سلام! از منوی زیر انتخاب کنید:', mainMenu(isAdmin(ctx)));
});

// Decorative buttons
bot.action('NOOP', async (ctx) => {
  await ctx.answerCbQuery();
});

// ---- Callbacks ----
bot.action('BACK_MAIN', async (ctx) => {
  await ctx.answerCbQuery();
  state.delete(ctx.chat.id);
  await ctx.editMessageText('منوی اصلی:', mainMenu(isAdmin(ctx)));
});

bot.action('ADMIN_MENU', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  await ctx.editMessageText('مدیریت:', adminMenu());
});

bot.action('LIST_PANELS', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  const rows = db.prepare('SELECT id, name, base_url, web_base_path, created_at FROM panels ORDER BY id DESC').all();
  if (!rows.length) {
    return ctx.reply('هیچ پنلی ثبت نشده است.');
  }
  const txt = rows.map(r => `#${r.id} ${r.name || '(بدون نام)'}\n${r.base_url}${r.web_base_path || ''}\n`).join('\n');
  await ctx.reply(txt);
});

bot.action('ADD_PANEL', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('اجازه دسترسی ندارید');
  await ctx.answerCbQuery();
  state.set(ctx.chat.id, { step: 'ASK_PANEL_NAME', data: {} });
  await ctx.reply('اسم دلخواه برای این پنل بفرست (مثلاً: سرور آلمان).');
});

bot.action('SERVICE_STATUS', async (ctx) => {
  await ctx.answerCbQuery();
  // Require at least one panel
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
  // Re-run lookup and edit the same message.
  const result = await lookupAndBuildView(last.parsed);
  if (!result.ok) {
    return ctx.reply(result.errorMessage);
  }
  const { msgText, keyboard } = result;
  try {
    await ctx.editMessageText(msgText, {
      parse_mode: 'Markdown',
      ...keyboard,
    });
  } catch (e) {
    // If edit fails (e.g. old message), just send a new one.
    await ctx.reply(msgText, { parse_mode: 'Markdown', ...keyboard });
  }
});

// ---- Text handler ----
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const st = state.get(chatId);
  if (!st) return;

  const text = (ctx.message.text || '').trim();

  // Admin: add panel wizard
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
    return ctx.reply('اگر پنل شما WebBasePath دارد بفرست (مثلاً /panel). اگر ندارد، فقط "-" بفرست.');
  }

  if (st.step === 'ASK_PANEL_WBP') {
    st.data.web_base_path = (text === '-' ? '' : text);
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

    // Test login before save
    try {
      const xui = new XUI({
        baseUrl: st.data.base_url,
        webBasePath: st.data.web_base_path,
        username: st.data.username,
        password: st.data.password,
      });
      await xui.login();
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
    return ctx.reply('✅ پنل با موفقیت اضافه شد.', mainMenu(true));
  }

  // User: service status
  if (st.step === 'ASK_LINK') {
    const parsed = parseAnySubscriptionLink(text);
    if (!parsed) {
      return ctx.reply('نتونستم از این متن UID/UUID یا پسورد Trojan استخراج کنم. لطفاً لینک/کانفیگ صحیح بفرست.');
    }

	    state.delete(chatId);
	    // Save last lookup so the refresh button can re-check.
	    lastLookup.set(chatId, { parsed });

	    const result = await lookupAndBuildView(parsed);
	    if (!result.ok) {
	      return ctx.reply(result.errorMessage);
	    }
	    const { msgText, keyboard } = result;
	    await ctx.reply(msgText, { parse_mode: 'Markdown', ...keyboard });
  }
});

bot.catch((err) => {
  console.error('Bot error', err);
});

bot.launch().then(() => console.log('Bot started'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
