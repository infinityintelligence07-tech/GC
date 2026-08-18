#!/usr/bin/env bash
# Rodar na VPS do IAM Control (Debian/Ubuntu + nginx).
# Uso (na pasta do projeto, já com dist pronto OU rode npm run build antes):
#   sudo bash deploy/vps-setup.sh

set -euo pipefail

DOMAIN="gc.iamcontrol.com.br"
WEBROOT="/var/www/gc.iamcontrol.com.br"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_SRC="${DEPLOY_DIR}/gc.iamcontrol.com.br.conf"
SITE_SSL_SRC="${DEPLOY_DIR}/gc.iamcontrol.com.br.ssl.conf"
DIST_SRC="$(cd "${DEPLOY_DIR}/.." && pwd)/dist"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [[ $EUID -ne 0 ]]; then
  echo "Rode com sudo."
  exit 1
fi

if [[ ! -d "$DIST_SRC" ]]; then
  echo "Pasta dist/ não encontrada. No projeto: npm ci && npm run build"
  exit 1
fi

mkdir -p "$WEBROOT"
rsync -a --delete "$DIST_SRC/" "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"

if [[ -f "$CERT" && -f "$SITE_SSL_SRC" ]]; then
  install -m 644 "$SITE_SSL_SRC" "/etc/nginx/sites-available/${DOMAIN}"
else
  install -m 644 "$SITE_SRC" "/etc/nginx/sites-available/${DOMAIN}"
fi
sed -i 's/\r$//' "/etc/nginx/sites-available/${DOMAIN}"
ln -sfn "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"

nginx -t
systemctl reload nginx

echo
if [[ -f "$CERT" ]]; then
  echo "HTTPS ativo em https://${DOMAIN}"
else
  echo "HTTP ativo em http://${DOMAIN}"
  echo "SSL: certbot --nginx -d ${DOMAIN}"
fi
echo "Supabase: Authentication → URL Configuration → Site URL = https://${DOMAIN}"
echo "          Additional Redirect URLs: https://${DOMAIN}/**"
