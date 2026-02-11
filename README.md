StatusBot
Telegram Service Status Bot for 3x-ui / x-ui

ربات تلگرام برای نمایش وضعیت سرویس کاربران (حجم، انقضا، محدودیت IP و …) از طریق API پنل 3x-ui.

✨ امکانات

اتصال به پنل 3x-ui / x-ui

دریافت لینک اشتراک (VLESS / VMESS / Trojan / Subscription)

استخراج UUID یا پسورد

نمایش:

حجم کل

حجم مصرف‌شده

حجم باقی‌مانده

تاریخ انقضا

محدودیت IP

اینباند و ایمیل کلاینت

نصب خودکار روی Ubuntu

اجرای دائمی با systemd

🚀 نصب با یک دستور (Ubuntu 22.04+)

فقط این دستور را اجرا کنید:

curl -fsSL https://raw.githubusercontent.com/deltashopsiavash/statusbot/main/install.sh | sudo bash


در هنگام نصب از شما پرسیده می‌شود:

BOT_TOKEN (توکن دریافتی از BotFather)

ADMIN_TG_ID (آیدی عددی ادمین)

اسکریپت به صورت خودکار:

Node.js نصب می‌کند

تمام کتابخانه‌های مورد نیاز را نصب می‌کند

فایل .env می‌سازد

سرویس systemd ایجاد می‌کند

ربات را اجرا می‌کند

📂 مسیر نصب
/opt/statusbot/3xui-telegram-bot


فایل تنظیمات:

/opt/statusbot/3xui-telegram-bot/.env

🛠 مدیریت سرویس
مشاهده وضعیت سرویس
systemctl status statusbot.service

مشاهده لاگ‌ها
journalctl -u statusbot.service -f

ری‌استارت
systemctl restart statusbot.service

توقف
systemctl stop statusbot.service

🔄 آپدیت ربات
cd /opt/statusbot
git pull
systemctl restart statusbot.service
