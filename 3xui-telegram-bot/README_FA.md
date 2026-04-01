# ربات تلگرام وضعیت سرویس (3x-ui / x-ui)

این پروژه یک ربات تلگرام می‌سازد که:
- شما (ادمین) می‌توانید پنل 3x-ui را به ربات اضافه کنید (آدرس پنل + یوزرنیم + پسورد)
- کاربر داخل منو روی «وضعیت سرویس» می‌زند
- ربات از کاربر لینک اشتراک (VLESS/VMESS/Trojan یا لینک سابسکریپشن) می‌گیرد
- UID/UUID (یا پسورد Trojan) را از لینک استخراج می‌کند
- از طریق API پنل 3x-ui کلاینت را پیدا می‌کند و اطلاعاتی مثل:
  - حجم کل، حجم مصرف‌شده، حجم باقی‌مانده
  - تاریخ انقضا / باقی‌مانده تا انقضا
  - محدودیت IP (اگر تنظیم شده باشد)
  - ایمیل/نام کاربری کلاینت و اینباند مربوطه

> نکته: ساختار دقیق فیلدها در نسخه‌های مختلف 3x-ui ممکن است کمی فرق کند. کد طوری نوشته شده که تا حد امکان با چند مدل خروجی کنار بیاید و اگر چیزی نبود، همان را «نامشخص» نمایش می‌دهد.

---

## پیش‌نیازها

### 1) سرور و پنل
- Ubuntu 22.04
- نصب پنل 3x-ui (همان اسکریپت شما)

### 2) نصب Node.js (نسخه 18 یا 20 پیشنهاد می‌شود)
روی اوبونتو:
```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

---

## نصب و اجرا

1) فایل‌ها را روی سرور کپی کنید و وارد پوشه شوید:
```bash
cd /opt
sudo mkdir -p 3xui-bot
sudo chown -R $USER:$USER /opt/3xui-bot
# فایل‌های پروژه را اینجا Extract کنید
cd /opt/3xui-bot
```

2) نصب پکیج‌ها:
```bash
npm install
```

3) فایل env را بسازید:
```bash
cp .env.example .env
nano .env
```

- `BOT_TOKEN` را از BotFather بگیرید.
- `ADMIN_TG_ID` را از طریق ربات‌هایی مثل @userinfobot می‌توانید بگیرید (عدد).

4) اجرا:
```bash
npm start
```

---

## نحوه استفاده در تلگرام

### ادمین
- `/start`
- منوی «مدیریت» → «افزودن پنل»
- اطلاعات را طبق دستور ربات بدهید:
  - Panel URL مثل: `http://IP:PORT`
  - Username
  - Password
  - (اختیاری) WebBasePath اگر پنل شما پشت مسیر خاصی است. معمولاً خالی بگذارید.

### کاربران
- `/start`
- گزینه «وضعیت سرویس»
- لینک اشتراک را می‌فرستند
- ربات نتیجه را برمی‌گرداند

---

## اجرای دائمی با systemd

فایل سرویس را بسازید:
```bash
sudo nano /etc/systemd/system/3xui-status-bot.service
```

محتوا:
```ini
[Unit]
Description=3x-ui Service Status Telegram Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/3xui-bot
EnvironmentFile=/opt/3xui-bot/.env
ExecStart=/usr/bin/node /opt/3xui-bot/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

فعال و اجرا:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now 3xui-status-bot
sudo systemctl status 3xui-status-bot
```

لاگ:
```bash
journalctl -u 3xui-status-bot -f
```

---

## امنیت

- بهتر است پنل را روی HTTPS و پشت فایروال/ACL نگه دارید.
- این ربات برای گرفتن اطلاعات از پنل نیاز به یوزرنیم/پسورد پنل دارد؛ دسترسی ادمین ربات را محدود نگه دارید.
