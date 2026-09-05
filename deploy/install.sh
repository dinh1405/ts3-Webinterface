#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# TS3 Webinterface – installer / updater / uninstaller (Debian, Ubuntu, RHEL-compatible)
#
#   One-liner:   curl -fsSL https://raw.githubusercontent.com/dinh1405/ts3-Webinterface/main/deploy/install.sh | sudo bash
#   Options:     bash install.sh --help
#
# The script only prepares the operating system side: Node.js, a system user, the release
# package, .env, the systemd service, optionally nginx and the "ts3web" command. Everything
# TeamSpeak-related is configured afterwards in the browser (setup wizard).
# ---------------------------------------------------------------------------
# shellcheck disable=SC1090,SC1111
set -euo pipefail

INSTALLER_VERSION="1.1.0"
REPO="${TS3WI_REPO:-dinh1405/ts3-Webinterface}"
APP_DIR="/opt/ts3-webinterface"
SERVICE="ts3-webinterface"
APP_USER=""
PORT="8088"
HOST=""
LANG_CHOICE=""
NGINX_NAME=""
NGINX_MODE=""          # "" = ask, "no" = skip, "yes" = use NGINX_NAME
MODE="install"         # install | update | uninstall
FROM_FILE=""
VERSION=""
YES=0
PURGE=0
LANG_SET=0
FIREWALL=1
NODE_MAJOR=22
CONF_DIR="/etc/ts3-webinterface"

# ---------------------------------------------------------------------------
# Messages (de / en)
# ---------------------------------------------------------------------------
declare -A M_de M_en

M_en[need_root]="Please run as root (e.g. sudo bash install.sh)."
M_de[need_root]="Bitte als root ausführen (z. B. sudo bash install.sh)."
M_en[unsupported_os]="Unsupported distribution: %s. Supported: Debian, Ubuntu and RHEL-compatible systems (apt or dnf)."
M_de[unsupported_os]="Nicht unterstützte Distribution: %s. Unterstützt: Debian, Ubuntu und RHEL-kompatible Systeme (apt oder dnf)."
M_en[no_tty]="No terminal available for questions. Re-run with --yes and the desired options (see --help)."
M_de[no_tty]="Kein Terminal für Rückfragen verfügbar. Bitte mit --yes und den gewünschten Optionen erneut starten (siehe --help)."
M_en[step_packages]="Installing required packages (%s)"
M_de[step_packages]="Benötigte Pakete installieren (%s)"
M_en[step_node]="Checking Node.js"
M_de[step_node]="Node.js prüfen"
M_en[node_install]="Installing Node.js %s (NodeSource)"
M_de[node_install]="Node.js %s installieren (NodeSource)"
M_en[node_ok]="Node.js %s found"
M_de[node_ok]="Node.js %s gefunden"
M_en[node_private]="Node.js was found at %s, which the service user cannot use. Installing a system-wide Node.js."
M_de[node_private]="Node.js liegt unter %s und ist für den Dienstbenutzer nicht nutzbar. Ein systemweites Node.js wird installiert."
M_en[node_unusable]="The service user %s cannot execute %s. Install Node.js system-wide (e.g. /usr/bin/node) and re-run."
M_de[node_unusable]="Der Dienstbenutzer %s kann %s nicht ausführen. Node.js systemweit installieren (z. B. /usr/bin/node) und erneut starten."
M_en[selinux_set]="SELinux is enforcing – allowing nginx to connect to the webinterface (httpd_can_network_connect)"
M_de[selinux_set]="SELinux ist aktiv – nginx darf sich jetzt mit dem Webinterface verbinden (httpd_can_network_connect)"
M_en[step_firewall]="Firewall"
M_de[step_firewall]="Firewall"
M_en[fw_opened]="Opened %s in %s"
M_de[fw_opened]="%s in %s freigegeben"
M_en[fw_hint]="No ufw/firewalld detected. If a firewall (cloud provider, iptables) is active, allow %s."
M_de[fw_hint]="Kein ufw/firewalld erkannt. Falls eine Firewall (Cloud-Anbieter, iptables) aktiv ist, %s freigeben."
M_en[step_user]="System user"
M_de[step_user]="Systembenutzer"
M_en[ts3_found_user]="A TeamSpeak server is running as user \"%s\"."
M_de[ts3_found_user]="Ein TeamSpeak-Server läuft als Benutzer „%s“."
M_en[ts3_found_root]="A TeamSpeak server is running as root. Running as root is not recommended; the webinterface will use its own user \"%s\" (start/stop via start script then requires the same user – see the wizard)."
M_de[ts3_found_root]="Ein TeamSpeak-Server läuft als root. Das ist nicht empfohlen; das Webinterface bekommt einen eigenen Benutzer „%s“ (Start/Stopp per Startskript braucht denselben Benutzer – siehe Assistent)."
M_en[ask_same_user]="Install the webinterface as the same user \"%s\"? (recommended, enables start/stop/backups) [Y/n] "
M_de[ask_same_user]="Webinterface als derselbe Benutzer „%s“ installieren? (empfohlen, ermöglicht Start/Stopp/Backups) [J/n] "
M_en[user_create]="Creating system user \"%s\""
M_de[user_create]="Systembenutzer „%s“ anlegen"
M_en[user_exists]="Using existing user \"%s\""
M_de[user_exists]="Vorhandener Benutzer „%s“ wird verwendet"
M_en[step_download]="Downloading release"
M_de[step_download]="Release herunterladen"
M_en[version_latest]="Latest version: %s"
M_de[version_latest]="Aktuelle Version: %s"
M_en[version_api_fail]="Could not query GitHub for the latest version – falling back to the \"latest\" package."
M_de[version_api_fail]="GitHub konnte nicht nach der aktuellen Version gefragt werden – es wird das Paket „latest“ verwendet."
M_en[checksum_ok]="SHA-256 checksum verified"
M_de[checksum_ok]="SHA-256-Prüfsumme geprüft"
M_en[checksum_missing]="No checksum file found – package is used without verification"
M_de[checksum_missing]="Keine Prüfsummendatei gefunden – Paket wird ungeprüft verwendet"
M_en[using_file]="Using local package %s"
M_de[using_file]="Lokales Paket %s wird verwendet"
M_en[step_install]="Installing to %s"
M_de[step_install]="Installation nach %s"
M_en[step_update]="Updating installation in %s (current: %s)"
M_de[step_update]="Installation in %s aktualisieren (aktuell: %s)"
M_en[already_installed]="An installation already exists in %s. Use --update to update it or --uninstall to remove it."
M_de[already_installed]="In %s existiert bereits eine Installation. Zum Aktualisieren --update, zum Entfernen --uninstall verwenden."
M_en[not_installed]="No installation found in %s."
M_de[not_installed]="In %s wurde keine Installation gefunden."
M_en[step_deps]="Installing Node.js dependencies"
M_de[step_deps]="Node.js-Abhängigkeiten installieren"
M_en[step_env]="Creating .env"
M_de[step_env]=".env anlegen"
M_en[env_kept]=".env kept unchanged"
M_de[env_kept]=".env bleibt unverändert"
M_en[step_service]="systemd service %s"
M_de[step_service]="systemd-Dienst %s"
M_en[unit_kept]="The existing unit differs from the template and was kept. New template: %s"
M_de[unit_kept]="Die vorhandene Unit weicht von der Vorlage ab und wurde beibehalten. Neue Vorlage: %s"
M_en[step_nginx]="nginx reverse proxy"
M_de[step_nginx]="nginx-Reverse-Proxy"
M_en[ask_nginx]="Set up nginx as reverse proxy (recommended, needed for HTTPS)? [Y/n] "
M_de[ask_nginx]="nginx als Reverse-Proxy einrichten (empfohlen, nötig für HTTPS)? [J/n] "
M_en[ask_domain]="Domain for the webinterface (e.g. ts.example.org): "
M_de[ask_domain]="Domain für das Webinterface (z. B. ts.example.org): "
M_en[plesk_detected]="Plesk detected – nginx is managed by Plesk. Use deploy/nginx-plesk.conf for the subdomain (see README)."
M_de[plesk_detected]="Plesk erkannt – nginx wird von Plesk verwaltet. Für die Subdomain deploy/nginx-plesk.conf verwenden (siehe README)."
M_en[nginx_done]="nginx site %s active. HTTPS: certbot --nginx -d %s"
M_de[nginx_done]="nginx-Site %s aktiv. HTTPS: certbot --nginx -d %s"
M_en[ask_host]="No reverse proxy: should the webinterface be reachable directly on port %s from the network (0.0.0.0)? Otherwise it only listens on 127.0.0.1 (SSH tunnel / own proxy). [Y/n] "
M_de[ask_host]="Kein Reverse-Proxy: Soll das Webinterface direkt auf Port %s aus dem Netz erreichbar sein (0.0.0.0)? Sonst lauscht es nur auf 127.0.0.1 (SSH-Tunnel / eigener Proxy). [J/n] "
M_en[step_cli]="Command-line tool ts3web"
M_de[step_cli]="Kommandozeilenwerkzeug ts3web"
M_en[step_health]="Waiting for the service"
M_de[step_health]="Auf den Dienst warten"
M_en[health_fail]="The service did not respond. Check: journalctl -u %s -n 50"
M_de[health_fail]="Der Dienst antwortet nicht. Prüfen mit: journalctl -u %s -n 50"
M_en[done_title]="Installation finished (version %s)"
M_de[done_title]="Installation abgeschlossen (Version %s)"
M_en[done_update]="Update finished (version %s)"
M_de[done_update]="Update abgeschlossen (Version %s)"
M_en[done_open]="Open the setup wizard in your browser:"
M_de[done_open]="Öffne den Einrichtungsassistenten im Browser:"
M_en[done_token]="Setup token (also in %s):"
M_de[done_token]="Setup-Token (auch in %s):"
M_en[done_tunnel]="The service listens on 127.0.0.1 only. From your PC open an SSH tunnel first:"
M_de[done_tunnel]="Der Dienst lauscht nur auf 127.0.0.1. Öffne vom PC aus zuerst einen SSH-Tunnel:"
M_en[done_https]="Set up HTTPS before using it over the internet:"
M_de[done_https]="Vor der Nutzung über das Internet HTTPS einrichten:"
M_en[done_cli]="Useful commands: ts3web status | logs | update | setup-token | reset-admin | uninstall"
M_de[done_cli]="Nützliche Befehle: ts3web status | logs | update | setup-token | reset-admin | uninstall"
M_en[done_setup_complete]="Setup is already complete – sign in at:"
M_de[done_setup_complete]="Die Einrichtung ist bereits abgeschlossen – Anmeldung unter:"
M_en[ask_uninstall]="Remove the webinterface service, unit, CLI and program files in %s? (data/, backups/ and .env are kept unless --purge) [y/N] "
M_de[ask_uninstall]="Dienst, Unit, CLI und Programmdateien in %s entfernen? (data/, backups/ und .env bleiben ohne --purge erhalten) [j/N] "
M_en[uninstall_done]="Uninstalled. Kept: %s"
M_de[uninstall_done]="Deinstalliert. Erhalten: %s"
M_en[uninstall_purged]="Uninstalled including all data."
M_de[uninstall_purged]="Deinstalliert inklusive aller Daten."
M_en[aborted]="Aborted."
M_de[aborted]="Abgebrochen."
M_en[rollback_hint]="The previous version is in %s (ts3web rollback)."
M_de[rollback_hint]="Die vorherige Version liegt in %s (ts3web rollback)."

t() {
  local key=$1; shift
  local text
  if [[ $LANG_CHOICE == de ]]; then text=${M_de[$key]:-${M_en[$key]:-$key}}; else text=${M_en[$key]:-$key}; fi
  # shellcheck disable=SC2059
  printf "$text" "$@"
}
log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
TS3 Webinterface installer ${INSTALLER_VERSION}

Usage: install.sh [options]
  --dir <path>          Installation directory (default: ${APP_DIR})
  --user <name>         System user for the service (default: user of a running ts3server, else ts3web)
  --port <n>            Port of the webinterface (default: ${PORT})
  --host <ip>           Listen address (default: 127.0.0.1 with nginx, otherwise asked / 0.0.0.0)
  --lang de|en          Language of this installer and default UI language
  --nginx <domain>      Set up nginx reverse proxy for this domain
  --no-nginx            Do not touch nginx
  --service-name <n>    systemd unit name (default: ${SERVICE}; use for parallel installations)
  --version <x.y.z>     Install a specific release instead of the latest
  --from-file <tar.gz>  Install from a local release package (no download)
  --repo <owner/name>   GitHub repository (default: ${REPO})
  --update              Update an existing installation (keeps .env, data/, backups/)
  --uninstall [--purge] Remove the installation (--purge also deletes data/, backups/, .env and the user)
  --no-firewall         Do not open ports in ufw/firewalld
  --yes                 No questions (non-interactive)
  --help                This help
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir) APP_DIR=$2; shift 2 ;;
    --user) APP_USER=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --host) HOST=$2; shift 2 ;;
    --lang) LANG_CHOICE=$2; LANG_SET=1; shift 2 ;;
    --nginx) NGINX_MODE=yes; NGINX_NAME=$2; shift 2 ;;
    --no-nginx) NGINX_MODE=no; shift ;;
    --service-name) SERVICE=$2; shift 2 ;;
    --version) VERSION=${2#v}; shift 2 ;;
    --from-file) FROM_FILE=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    --update) MODE=update; shift ;;
    --uninstall) MODE=uninstall; shift ;;
    --purge) PURGE=1; shift ;;
    --no-firewall) FIREWALL=0; shift ;;
    --yes|-y) YES=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

APP_DIR=${APP_DIR%/}
[[ $APP_DIR == /* ]] || die "--dir must be an absolute path"
[[ $PORT =~ ^[0-9]+$ ]] || die "--port must be a number"
[[ $SERVICE =~ ^[A-Za-z0-9_.-]+$ ]] || die "--service-name: letters, digits, . _ - only"

# Language: flag → environment → English
if [[ -z $LANG_CHOICE ]]; then
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in de*) LANG_CHOICE=de ;; *) LANG_CHOICE=en ;; esac
fi
[[ $LANG_CHOICE == de || $LANG_CHOICE == en ]] || LANG_CHOICE=en

[[ $EUID -eq 0 ]] || die "$(t need_root)"

# Questions are read from /dev/tty so that "curl | bash" works too.
TTY=""
if [[ -r /dev/tty && -w /dev/tty ]] && { : < /dev/tty; } 2>/dev/null; then TTY=/dev/tty; fi
ask() {  # ask <prompt> <default> → prints answer
  local prompt=$1 default=$2 answer=""
  if [[ $YES -eq 1 || -z $TTY ]]; then printf '%s' "$default"; return; fi
  printf '%s' "$prompt" > "$TTY"
  read -r answer < "$TTY" || true
  printf '%s' "${answer:-$default}"
}
ask_yes() {  # ask_yes <prompt> <default y|n> → exit status
  local a; a=$(ask "$1" "$2")
  [[ $a =~ ^([yYjJ]|yes|ja)$ ]]
}
if [[ $YES -eq 0 && -z $TTY ]]; then die "$(t no_tty)"; fi

# ---------------------------------------------------------------------------
# OS / package manager
# ---------------------------------------------------------------------------
PKG=""
OS_ID="unknown"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  case "${ID:-} ${ID_LIKE:-}" in
    *debian*|*ubuntu*) PKG=apt ;;
    *rhel*|*fedora*|*centos*|*rocky*|*alma*) PKG=dnf ;;
  esac
fi
if [[ -z $PKG ]]; then
  command -v apt-get >/dev/null 2>&1 && PKG=apt
  command -v dnf >/dev/null 2>&1 && PKG=dnf
fi
[[ -n $PKG ]] || die "$(t unsupported_os "$OS_ID")"
IS_PLESK=0; [[ -f /usr/local/psa/version ]] && IS_PLESK=1

pkg_install() {
  if [[ $PKG == apt ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null 2>&1 || apt-get update -qq
    apt-get install -y -qq "$@" >/dev/null
  else
    dnf install -y -q "$@" >/dev/null
  fi
}
run_as() {  # run_as <user> <cmd...> – with the user's HOME (npm cache)
  local u=$1; shift
  local home; home=$(getent passwd "$u" | cut -d: -f6)
  if command -v runuser >/dev/null 2>&1; then runuser -u "$u" -- env HOME="$home" "$@"; else su -s /bin/bash "$u" -c "HOME='$home' $(printf '%q ' "$@")"; fi
}
conf_file() { printf '%s/%s.conf' "$CONF_DIR" "$SERVICE"; }
read_conf() {  # instance file; explicit --lang wins over the stored language
  local lang_flag=$LANG_CHOICE
  [[ -r $(conf_file) ]] && . "$(conf_file)" 2>/dev/null || true
  [[ $LANG_SET -eq 1 ]] && LANG_CHOICE=$lang_flag
  return 0
}
installed_version() { [[ -r $APP_DIR/VERSION ]] && tr -d '[:space:]' < "$APP_DIR/VERSION" || echo "?"; }

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
if [[ $MODE == uninstall ]]; then
  # shellcheck disable=SC2034
  CREATED_USER=0
  read_conf
  [[ -d $APP_DIR ]] || die "$(t not_installed "$APP_DIR")"
  if [[ $YES -ne 1 ]]; then ask_yes "$(t ask_uninstall "$APP_DIR")" n || { echo "$(t aborted)"; exit 0; }; fi
  systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$SERVICE.service"
  systemctl daemon-reload
  if [[ -n ${NGINX_SITE:-} ]]; then
    rm -f "/etc/nginx/sites-enabled/$NGINX_SITE" "/etc/nginx/sites-available/$NGINX_SITE" "/etc/nginx/conf.d/$NGINX_SITE.conf"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
  fi
  rm -f "$(conf_file)"
  if [[ $PURGE -eq 1 ]]; then
    rm -rf "$APP_DIR"
    if [[ ${CREATED_USER:-0} -eq 1 && -n ${APP_USER:-} ]] && ! pgrep -u "$APP_USER" >/dev/null 2>&1; then userdel -r "$APP_USER" >/dev/null 2>&1 || true; fi
    [[ -d $CONF_DIR ]] && [[ -z $(ls -A "$CONF_DIR") ]] && rm -rf "$CONF_DIR" && rm -f /usr/local/bin/ts3web
    echo "$(t uninstall_purged)"
  else
    find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name data ! -name backups ! -name .env -exec rm -rf {} +
    [[ -d $CONF_DIR ]] && [[ -z $(ls -A "$CONF_DIR") ]] && rm -rf "$CONF_DIR" && rm -f /usr/local/bin/ts3web
    echo "$(t uninstall_done "$APP_DIR/{data,backups,.env}")"
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Install / update
# ---------------------------------------------------------------------------
if [[ $MODE == install && -f $APP_DIR/server/index.js ]]; then
  if [[ -f $APP_DIR/VERSION ]]; then MODE=update; else die "$(t already_installed "$APP_DIR")"; fi
fi
if [[ $MODE == update ]]; then
  [[ -f $APP_DIR/server/index.js ]] || die "$(t not_installed "$APP_DIR")"
  read_conf
  if [[ -z $APP_USER ]]; then APP_USER=$(stat -c %U "$APP_DIR/server/index.js"); fi
  if [[ -r $APP_DIR/.env ]]; then
    PORT=$(grep -E '^PORT=' "$APP_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true); PORT=${PORT:-8088}
  fi
  [[ -z $NGINX_MODE ]] && NGINX_MODE=no
fi

log "$(t step_packages "curl tar bzip2 sqlite3")"
if [[ $PKG == apt ]]; then pkg_install ca-certificates curl tar bzip2 sqlite3 openssl gnupg; else pkg_install ca-certificates curl tar bzip2 sqlite openssl; fi

log "$(t step_node)"
# Prefer a system-wide Node.js; a per-user installation (nvm under /root or /home) is unusable for the service user.
pick_node() {
  local c
  for c in /usr/bin/node /usr/local/bin/node /snap/bin/node; do [[ -x $c ]] && { echo "$c"; return; }; done
  command -v node 2>/dev/null || true
}
node_major() { [[ -n ${1:-} && -x $1 ]] && "$1" -v | sed 's/^v\([0-9]*\).*/\1/' || echo 0; }
install_node() {
  info "$(t node_install "$NODE_MAJOR.x")"
  if [[ $PKG == apt ]]; then curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  else curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null; fi
  pkg_install nodejs
  NODE_BIN=/usr/bin/node
}
NODE_BIN=$(pick_node)
if [[ -n $NODE_BIN && ( $NODE_BIN == /root/* || $NODE_BIN == /home/* ) ]]; then
  warn "$(t node_private "$NODE_BIN")"
  install_node
elif [[ $(node_major "$NODE_BIN") -lt 20 ]]; then
  install_node
fi
[[ -x $NODE_BIN ]] || die "Node.js not found after installation"
info "$(t node_ok "$("$NODE_BIN" -v) · $NODE_BIN")"

# --- user ------------------------------------------------------------------
log "$(t step_user)"
# shellcheck disable=SC2034
CREATED_USER=${CREATED_USER:-0}
if [[ -z $APP_USER ]]; then
  ts3_pid=$(pgrep -x ts3server | head -1 || true)
  ts3_user=""
  [[ -n $ts3_pid ]] && ts3_user=$(ps -o user= -p "$ts3_pid" | tr -d '[:space:]')
  if [[ -n $ts3_user && $ts3_user != root ]]; then
    info "$(t ts3_found_user "$ts3_user")"
    if ask_yes "$(t ask_same_user "$ts3_user")" y; then APP_USER=$ts3_user; else APP_USER=ts3web; fi
  elif [[ $ts3_user == root ]]; then
    APP_USER=ts3web
    warn "$(t ts3_found_root "$APP_USER")"
  else
    APP_USER=ts3web
  fi
fi
if id "$APP_USER" >/dev/null 2>&1; then
  info "$(t user_exists "$APP_USER")"
else
  info "$(t user_create "$APP_USER")"
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER" 2>/dev/null \
    || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /sbin/nologin "$APP_USER"
  CREATED_USER=1
fi
APP_HOME=$(getent passwd "$APP_USER" | cut -d: -f6)
[[ -d $APP_HOME ]] || { mkdir -p "$APP_HOME"; chown "$APP_USER:$APP_USER" "$APP_HOME"; }
run_as "$APP_USER" "$NODE_BIN" -v >/dev/null 2>&1 || die "$(t node_unusable "$APP_USER" "$NODE_BIN")"

# --- release package -------------------------------------------------------
log "$(t step_download)"
TMP=$(mktemp -d /tmp/ts3wi-install.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
PKG_FILE=""
if [[ -n $FROM_FILE ]]; then
  [[ -f $FROM_FILE ]] || die "File not found: $FROM_FILE"
  PKG_FILE=$FROM_FILE
  info "$(t using_file "$FROM_FILE")"
else
  if [[ -z $VERSION ]]; then
    VERSION=$(curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1 || true)
  fi
  if [[ -n $VERSION ]]; then
    info "$(t version_latest "$VERSION")"
    URL="https://github.com/$REPO/releases/download/v$VERSION/ts3-webinterface-$VERSION.tar.gz"
  else
    warn "$(t version_api_fail)"
    URL="https://github.com/$REPO/releases/latest/download/ts3-webinterface-latest.tar.gz"
  fi
  PKG_FILE="$TMP/package.tar.gz"
  curl -fL --progress-bar -o "$PKG_FILE" "$URL"
  if curl -fsSL -o "$TMP/package.sha256" "$URL.sha256" 2>/dev/null; then
    expected=$(awk '{print $1}' "$TMP/package.sha256")
    actual=$(sha256sum "$PKG_FILE" | awk '{print $1}')
    [[ $expected == "$actual" ]] || die "SHA-256 mismatch (expected $expected, got $actual)"
    info "$(t checksum_ok)"
  else
    warn "$(t checksum_missing)"
  fi
fi
mkdir -p "$TMP/x"
tar -xzf "$PKG_FILE" -C "$TMP/x"
SRC=$(find "$TMP/x" -maxdepth 1 -mindepth 1 -type d | head -1)
[[ -f $SRC/server/index.js && -f $SRC/package.json ]] || die "Invalid package (server/index.js missing)"
NEW_VERSION=$(tr -d '[:space:]' < "$SRC/VERSION" 2>/dev/null || echo "?")

# --- copy files ------------------------------------------------------------
if [[ $MODE == update ]]; then
  log "$(t step_update "$APP_DIR" "$(installed_version)")"
  systemctl stop "$SERVICE" >/dev/null 2>&1 || true
  rm -rf "$APP_DIR/.previous"
  mkdir -p "$APP_DIR/.previous"
  for entry in server web deploy node_modules package.json package-lock.json VERSION README.md README.de.md CHANGELOG.md LICENSE SECURITY.md .env.example; do
    [[ -e $APP_DIR/$entry ]] && mv "$APP_DIR/$entry" "$APP_DIR/.previous/"
  done
else
  log "$(t step_install "$APP_DIR")"
  mkdir -p "$APP_DIR"
fi
cp -a "$SRC/." "$APP_DIR/"
mkdir -p "$APP_DIR/data" "$APP_DIR/backups"
chmod 755 "$APP_DIR/deploy/install.sh" "$APP_DIR/deploy/ts3web" 2>/dev/null || true
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "$(t step_deps)"
if [[ -f $APP_DIR/package-lock.json ]]; then
  run_as "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund --loglevel=error" \
    || run_as "$APP_USER" bash -c "cd '$APP_DIR' && npm install --omit=dev --no-audit --no-fund --loglevel=error"
else
  run_as "$APP_USER" bash -c "cd '$APP_DIR' && npm install --omit=dev --no-audit --no-fund --loglevel=error"
fi

# --- nginx decision (before .env, because it determines HOST) --------------
if [[ $MODE == install ]]; then
  if [[ $IS_PLESK -eq 1 && $NGINX_MODE != no ]]; then
    warn "$(t plesk_detected)"; NGINX_MODE=no; HOST=${HOST:-127.0.0.1}
  fi
  if [[ -z $NGINX_MODE ]]; then
    if ask_yes "$(t ask_nginx)" y; then
      NGINX_NAME=$(ask "$(t ask_domain)" "")
      if [[ -n $NGINX_NAME ]]; then NGINX_MODE=yes; else NGINX_MODE=no; fi
    else
      NGINX_MODE=no
    fi
  fi
  if [[ -z $HOST ]]; then
    if [[ $NGINX_MODE == yes ]]; then HOST=127.0.0.1
    elif ask_yes "$(t ask_host "$PORT")" y; then HOST=0.0.0.0
    else HOST=127.0.0.1; fi
  fi
fi

# --- .env ------------------------------------------------------------------
if [[ -f $APP_DIR/.env ]]; then
  info "$(t env_kept)"
else
  log "$(t step_env)"
  secret=$(openssl rand -hex 48 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')
  trust=0; [[ $NGINX_MODE == yes ]] && trust=1
  public_url=""
  [[ $NGINX_MODE == yes ]] && public_url="http://$NGINX_NAME"
  cat > "$APP_DIR/.env" <<EOF
# TS3 Webinterface – created by install.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)
# TeamSpeak-related settings are made in the browser and stored in data/config.json.
HOST=$HOST
PORT=$PORT
TRUST_PROXY=$trust
PUBLIC_URL=$public_url
JWT_SECRET=$secret
SESSION_HOURS=12
DATA_DIR=data
BACKUP_DIR=backups
UI_LANGUAGE=$LANG_CHOICE
EOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"

# --- systemd ---------------------------------------------------------------
log "$(t step_service "$SERVICE")"
UNIT="/etc/systemd/system/$SERVICE.service"
gen_unit() {
  sed -e "s#@APP_DIR@#$APP_DIR#g" -e "s#@APP_USER@#$APP_USER#g" -e "s#@SERVICE@#$SERVICE#g" -e "s#@NODE@#$NODE_BIN#g" "$APP_DIR/deploy/ts3-webinterface.service.tpl"
}
if [[ -f $UNIT ]] && ! diff -q <(gen_unit) "$UNIT" >/dev/null 2>&1 && [[ $MODE == update ]]; then
  gen_unit > "$APP_DIR/deploy/$SERVICE.service.generated"
  warn "$(t unit_kept "$APP_DIR/deploy/$SERVICE.service.generated")"
else
  gen_unit > "$UNIT"
fi
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

# --- nginx -----------------------------------------------------------------
NGINX_SITE=""
if [[ $NGINX_MODE == yes && $MODE == install ]]; then
  log "$(t step_nginx)"
  command -v nginx >/dev/null 2>&1 || pkg_install nginx
  NGINX_SITE="ts3-webinterface-${NGINX_NAME}"
  if [[ -d /etc/nginx/sites-available ]]; then
    target="/etc/nginx/sites-available/$NGINX_SITE"
    sed -e "s#@SERVER_NAME@#$NGINX_NAME#g" -e "s#@PORT@#$PORT#g" "$APP_DIR/deploy/nginx-site.conf.tpl" > "$target"
    ln -sf "$target" "/etc/nginx/sites-enabled/$NGINX_SITE"
  else
    sed -e "s#@SERVER_NAME@#$NGINX_NAME#g" -e "s#@PORT@#$PORT#g" "$APP_DIR/deploy/nginx-site.conf.tpl" > "/etc/nginx/conf.d/$NGINX_SITE.conf"
  fi
  if nginx -t >/dev/null 2>&1; then
    if command -v getenforce >/dev/null 2>&1 && [[ $(getenforce 2>/dev/null) == Enforcing ]] && command -v setsebool >/dev/null 2>&1; then
      info "$(t selinux_set)"
      setsebool -P httpd_can_network_connect 1 || warn "setsebool failed – nginx may get 502 until httpd_can_network_connect is set"
    fi
    systemctl enable nginx >/dev/null 2>&1 || true
    systemctl restart nginx
    info "$(t nginx_done "$NGINX_SITE" "$NGINX_NAME")"
  else
    warn "nginx -t failed:"; nginx -t || true
  fi
fi

# --- firewall --------------------------------------------------------------
if [[ $MODE == install && $FIREWALL -eq 1 ]]; then
  fw_ports=()
  if [[ $NGINX_MODE == yes ]]; then fw_ports=(80/tcp 443/tcp)
  elif [[ $HOST != 127.0.0.1 && $HOST != localhost ]]; then fw_ports=("$PORT/tcp"); fi
  if [[ ${#fw_ports[@]} -gt 0 ]]; then
    log "$(t step_firewall)"
    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
      for fp in "${fw_ports[@]}"; do ufw allow "$fp" >/dev/null 2>&1 || true; done
      info "$(t fw_opened "${fw_ports[*]}" ufw)"
    elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
      for fp in "${fw_ports[@]}"; do firewall-cmd --permanent --add-port="$fp" >/dev/null 2>&1 || true; done
      firewall-cmd --reload >/dev/null 2>&1 || true
      info "$(t fw_opened "${fw_ports[*]}" firewalld)"
    else
      info "$(t fw_hint "${fw_ports[*]}")"
    fi
  fi
fi

# --- CLI -------------------------------------------------------------------
log "$(t step_cli)"
install -m 755 "$APP_DIR/deploy/ts3web" /usr/local/bin/ts3web
mkdir -p "$CONF_DIR"
{
  echo "# TS3 Webinterface instance – written by install.sh"
  echo "APP_DIR='$APP_DIR'"
  echo "APP_USER='$APP_USER'"
  echo "SERVICE='$SERVICE'"
  echo "REPO='$REPO'"
  echo "PORT='$PORT'"
  echo "NGINX_SITE='${NGINX_SITE:-}'"
  echo "CREATED_USER='${CREATED_USER:-0}'"
  echo "LANG_CHOICE='$LANG_CHOICE'"
} > "$(conf_file)"
chmod 600 "$(conf_file)"

# --- health ----------------------------------------------------------------
log "$(t step_health)"
health=""
for _ in $(seq 1 40); do
  health=$(curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
  [[ -n $health ]] && break
  sleep 1
done
if [[ -z $health ]]; then
  warn "$(t health_fail "$SERVICE")"
  journalctl -u "$SERVICE" -n 20 --no-pager || true
  exit 1
fi
needs_setup=$(curl -fsS "http://127.0.0.1:$PORT/api/auth/setup-status" 2>/dev/null | grep -o '"needsSetup":[a-z]*' | cut -d: -f2 || true)

# --- summary ---------------------------------------------------------------
echo
if [[ $MODE == update ]]; then log "$(t done_update "$NEW_VERSION")"; info "$(t rollback_hint "$APP_DIR/.previous")"; else log "$(t done_title "$NEW_VERSION")"; fi
env_public=$(grep -E '^PUBLIC_URL=' "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true)
env_host=$(grep -E '^HOST=' "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true)
HOST=${HOST:-${env_host:-0.0.0.0}}
if [[ -n $env_public ]]; then
  BASE_URL="$env_public"
elif [[ $NGINX_MODE == yes && -n $NGINX_NAME ]]; then
  BASE_URL="http://$NGINX_NAME"
elif [[ $HOST == 127.0.0.1 || $HOST == localhost ]]; then
  BASE_URL="http://localhost:$PORT"
else
  ip=$(hostname -I 2>/dev/null | awk '{print $1}'); ip=${ip:-<server-ip>}
  BASE_URL="http://$ip:$PORT"
fi
echo
if [[ $needs_setup == true ]]; then
  token=""
  for _ in $(seq 1 10); do [[ -s $APP_DIR/data/setup-token ]] && { token=$(tr -d '[:space:]' < "$APP_DIR/data/setup-token"); break; }; sleep 1; done
  if [[ -z $env_public && $NGINX_MODE != yes && ( $HOST == 127.0.0.1 || $HOST == localhost ) ]]; then
    info "$(t done_tunnel)"
    info "    ssh -L $PORT:127.0.0.1:$PORT root@$(hostname -f 2>/dev/null || hostname)"
    echo
  fi
  info "$(t done_open)"
  printf '\n    \033[1m%s/setup#token=%s\033[0m\n\n' "$BASE_URL" "$token"
  info "$(t done_token "$APP_DIR/data/setup-token")  $token"
else
  info "$(t done_setup_complete)  $BASE_URL"
fi
if [[ $NGINX_MODE == yes && -n $NGINX_NAME ]]; then echo; info "$(t done_https)"; info "    certbot --nginx -d $NGINX_NAME"; fi
echo
info "$(t done_cli)"
echo
