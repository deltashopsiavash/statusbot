const { Markup } = require('telegraf');
const { glassLabel, pill } = require('./style');

function statusKeyboard(view) {
  // view: { activeText, emailShort, usedText, totalText, leftText, expireText, daysLeftText, refreshCb }
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

module.exports = { statusKeyboard };
