#!/usr/bin/env bash
set -euo pipefail

APP_NAME="statusbot"
REPO_URL="https://github.com/deltashopsiavash/statusbot.git"
INSTALL_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}.service"
NODE_MAJOR="20"

GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RED="\033[0;31m"; NC="\033[0m"

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[-]${NC} $*"; }

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "این اسکریپت باید با root اجرا شود. مثال:"
    echo "sudo bash install.sh"
    exit 1
  fi
}

has_cmd() { command -v "$1" >/dev/null 2>&1; }

install_deps() {
  log "آپدیت پکیج‌ها..."
  apt-get update -y

  log "نصب پیش‌نیازها..."
  apt-get install -y ca-certificates curl git gnupg build-essential

  if ! has_cmd node; then
    log "نصب Node.js ${NODE_MAJOR}..."
    mkdir -p /etc/apt/keyrings
    curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    apt-get install -y nodejs
  else
    warn "Node.js از قبل نصب است: $(node -v)"
  fi
}

ask_env() {
  echo
  echo "=== تنظیمات ربات ==="
  read -rp "BOT_TOKEN (توکن BotFather): " BOT_TOKEN
  while [[ -z "${BOT_TOKEN}" ]]; do
    warn "BOT_TOKEN نمی‌تواند خالی باشد."
    read -rp "BOT_TOKEN: " BOT_TOKEN
  done

  read -rp "ADMIN_TG_ID (آیدی عددی ادمین): " ADMIN_TG_ID
  while [[ -z "${ADMIN_TG_ID}" || ! "${ADMIN_TG_ID}" =~ ^[0-9]+$ ]]; do
    warn "ADMIN_TG_ID باید عدد باشد."
    read -rp "ADMIN_TG_ID: " ADMIN_TG_ID
  done

  # اختیاری: اگر خواستی پورت یا اسم سرویس رو تغییر بدی
  read -rp "ENV (پیش‌فرض: production) [Enter]: " NODE_ENV
  NODE_ENV="${NODE_ENV:-production}"
}

clone_or_update() {
  log "آماده‌سازی مسیر نصب: ${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    warn "ریپو از قبل وجود دارد، آپدیت می‌کنم..."
    git -C "${INSTALL_DIR}" fetch --all --prune
    git -C "${INSTALL_DIR}" reset --hard origin/main || git -C "${INSTALL_DIR}" reset --hard origin/master
  else
    log "کلون کردن ریپو..."
    git clone "${REPO_URL}" "${INSTALL_DIR}"
  fi
}

setup_env_file() {
  # مسیر پروژه نود داخل ریپو
  local APP_DIR="${INSTALL_DIR}/3xui-telegram-bot"
  if [[ ! -f "${APP_DIR}/package.json" ]]; then
    err "package.json پیدا نشد. مطمئن شو پروژه داخل مسیر 3xui-telegram-bot/ است."
    exit 1
  fi

  log "ساخت .env داخل ${APP_DIR}"
  cat > "${APP_DIR}/.env" <<EOF
BOT_TOKEN=${BOT_TOKEN}
ADMIN_TG_ID=${ADMIN_TG_ID}
NODE_ENV=${NODE_ENV}
EOF

  chmod 600 "${APP_DIR}/.env"
}

install_node_modules() {
  local APP_DIR="${INSTALL_DIR}/3xui-telegram-bot"
  log "نصب پکیج‌های npm..."
  cd "${APP_DIR}"

  # اگر package-lock هست، بهتره ci بزنیم
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev
  else
    npm install --omit=dev
  fi
}

create_user() {
  if id -u "${APP_NAME}" >/dev/null 2>&1; then
    warn "یوزر ${APP_NAME} از قبل هست."
  else
    log "ساخت یوزر سیستمی ${APP_NAME}..."
    useradd -r -s /usr/sbin/nologin -d "${INSTALL_DIR}" "${APP_NAME}"
  fi

  chown -R "${APP_NAME}:${APP_NAME}" "${INSTALL_DIR}"
}

setup_systemd() {
  local APP_DIR="${INSTALL_DIR}/3xui-telegram-bot"

  log "ساخت سرویس systemd: /etc/systemd/system/${SERVICE_NAME}"
  cat > "/etc/systemd/system/${SERVICE_NAME}" <<EOF
[Unit]
Description=Telegram Status Bot for 3x-ui (x-ui/3x-ui) - ${APP_NAME}
After=network.target

[Service]
Type=simple
User=${APP_NAME}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/src/index.js
Restart=always
RestartSec=3
# امنیت بیشتر (اختیاری)
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}"

  log "وضعیت سرویس:"
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
}

print_done() {
  echo
  log "تمام ✅ ربات نصب و اجرا شد."
  echo
  echo "دستورات مفید:"
  echo "  مشاهده لاگ‌ها:   journalctl -u ${SERVICE_NAME} -f"
  echo "  ری‌استارت:       systemctl restart ${SERVICE_NAME}"
  echo "  توقف:            systemctl stop ${SERVICE_NAME}"
  echo "  آپدیت ریپو:      cd ${INSTALL_DIR} && git pull && systemctl restart ${SERVICE_NAME}"
}

main() {
  need_root
  install_deps
  ask_env
  clone_or_update
  setup_env_file
  install_node_modules
  create_user
  setup_systemd
  print_done
}

main "$@"
