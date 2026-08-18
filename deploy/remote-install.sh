#!/usr/bin/env bash
# Instala só gc.iamcontrol.com.br. Não altera outros vhosts.
set -euo pipefail

ZIP="/root/gc-iamcontrol.zip"
CONF_HTTP="/root/gc.iamcontrol.com.br.conf"
CONF_SSL="/root/gc.iamcontrol.com.br.ssl.conf"
WEBROOT="/var/www/gc.iamcontrol.com.br"
DOMAIN="gc.iamcontrol.com.br"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
NGINX_AVAIL="/etc/nginx/sites-available/${DOMAIN}"

if [[ ! -f "$ZIP" ]]; then
  echo "Falta $ZIP"
  exit 1
fi

command -v unzip >/dev/null || apt-get install -y unzip
command -v nginx >/dev/null || apt-get install -y nginx
command -v rsync >/dev/null || apt-get install -y rsync

mkdir -p "$WEBROOT"
unzip -o "$ZIP" -d "$WEBROOT"
chown -R www-data:www-data "$WEBROOT"

if [[ -f "$CERT" ]]; then
  SRC_CONF="$CONF_SSL"
  if [[ ! -f "$SRC_CONF" ]]; then
    SRC_CONF="$CONF_HTTP"
  fi
else
  SRC_CONF="$CONF_HTTP"
fi

if [[ ! -f "$SRC_CONF" ]]; then
  echo "Falta $SRC_CONF"
  exit 1
fi

install -m 644 "$SRC_CONF" "$NGINX_AVAIL"
sed -i 's/\r$//' "$NGINX_AVAIL"
ln -sfn "$NGINX_AVAIL" "/etc/nginx/sites-enabled/${DOMAIN}"

nginx -t
systemctl reload nginx

test -f "${WEBROOT}/index.html"
if [[ -f "$CERT" ]]; then
  echo "OK: https://${DOMAIN}"
else
  echo "OK: http://${DOMAIN}  (rode certbot --nginx -d ${DOMAIN})"
fi
ls -la "$WEBROOT/index.html"
