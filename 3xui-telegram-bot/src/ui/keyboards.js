const { Markup } = require('telegraf');
const { glassLabel, pill } = require('./style');

function statusKeyboard(view) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(glassLabel('وضعیت اکانت'), 'NOOP'),
      Markup.button.callback(glassLabel(view.activeText), 'NOOP'),
    ],
    [
      Markup.button.callback(glassLabel('نام اکانت'), 'NOOP'),
      Markup.button.callback(glassLabel(view.emailShort), 'NOOP'),
    ],
    [
      Markup.button.callback(glassLabel('مصرف شده ✓'), 'NOOP'),
      Markup.button.callback(glassLabel(view.usedText), 'NOOP'),
    ],
    [
      Markup.button.callback(glassLabel('حجم کلی +'), 'NOOP'),
      Markup.button.callback(glassLabel(view.totalText), 'NOOP'),
    ],
    [
      Markup.button.callback(glassLabel('حجم باقی‌مانده ~'), 'NOOP'),
      Markup.button.callback(glassLabel(view.leftText), 'NOOP'),
    ],
    [
      Markup.button.callback(glassLabel('تاریخ اتمام'), 'NOOP'),
      Markup.button.callback(glassLabel(view.expireText), 'NOOP'),
    ],
    [
      Markup.button.callback(glassLabel('تعداد روز باقی‌مانده'), 'NOOP'),
      Markup.button.callback(glassLabel(view.daysLeftText), 'NOOP'),
    ],
    [Markup.button.callback(pill('🔄 بروزرسانی'), view.refreshCb)],
  ]);
}

function buildPanelRows(rows, prefix) {
  return rows.map((panel) => [
    Markup.button.callback(`📌 ${panel}`, `${prefix}`),
  ]);
}

function panelSelectionKeyboard(rows, mode = 'manage') {
  const prefix = mode === 'inquiry' ? 'PI:' : 'PM:';
  const buttons = rows.map((panel) => [
    Markup.button.callback(`📌 ${panel.label}`, `${prefix}${panel.id}`),
  ]);
  buttons.push([Markup.button.callback('⬅️ برگشت', 'ADMIN_MENU')]);
  return Markup.inlineKeyboard(buttons);
}

function panelManageKeyboard(panelId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📝 تغییر نام پنل', `PE:name:${panelId}`),
      Markup.button.callback('👤 تغییر نام کاربری', `PE:user:${panelId}`),
    ],
    [
      Markup.button.callback('🔑 تغییر رمز عبور', `PE:pass:${panelId}`),
      Markup.button.callback('🌐 تغییر آی‌پی/آدرس', `PE:url:${panelId}`),
    ],
    [
      Markup.button.callback('🧩 تغییر WebBasePath', `PE:wbp:${panelId}`),
      Markup.button.callback('📊 استعلام اینباند', `PI:${panelId}`),
    ],
    [Markup.button.callback('🗑 حذف پنل', `PD:${panelId}`)],
    [
      Markup.button.callback('📋 لیست پنل‌ها', 'LIST_PANELS'),
      Markup.button.callback('⬅️ مدیریت', 'ADMIN_MENU'),
    ],
  ]);
}

function panelDeleteConfirmKeyboard(panelId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ بله، حذف کن', `PDOK:${panelId}`),
      Markup.button.callback('❌ لغو', `PM:${panelId}`),
    ],
  ]);
}

function adminManagementKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ افزودن ادمین', 'ADD_ADMIN')],
    [Markup.button.callback('📋 لیست ادمین‌ها', 'LIST_ADMINS')],
    [Markup.button.callback('⬅️ مدیریت', 'ADMIN_MENU')],
  ]);
}

function inboundSummaryKeyboard(panelId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔄 بروزرسانی استعلام', `PI:${panelId}`)],
    [
      Markup.button.callback('⚙️ تنظیمات پنل', `PM:${panelId}`),
      Markup.button.callback('📋 پنل‌ها', 'INBOUND_INQUIRY'),
    ],
    [Markup.button.callback('⬅️ مدیریت', 'ADMIN_MENU')],
  ]);
}

module.exports = {
  statusKeyboard,
  panelSelectionKeyboard,
  panelManageKeyboard,
  panelDeleteConfirmKeyboard,
  adminManagementKeyboard,
  inboundSummaryKeyboard,
};
