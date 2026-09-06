#!/usr/bin/env bash
#
# Installation de GameShelf sur un serveur Ubuntu, pour un usage local.
#
#   sudo ./deploy/install.sh
#   sudo ./deploy/install.sh --port 8080
#   sudo ./deploy/install.sh --http-only     # sans HTTPS (scan camera indisponible)
#
# Le script est idempotent : vous pouvez le relancer pour mettre a jour.
#
set -euo pipefail

APP_NAME="gameshelf"
APP_DIR="/opt/${APP_NAME}"
APP_USER="${APP_NAME}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
NODE_MAJOR=22
PORT="${PORT:-3000}"
ENABLE_HTTPS=1

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------------------------------------------------------------------------
# Affichage
# ---------------------------------------------------------------------------
c_reset=$'\033[0m'; c_blue=$'\033[1;34m'; c_green=$'\033[1;32m'
c_yellow=$'\033[1;33m'; c_red=$'\033[1;31m'

info()  { printf '%s==>%s %s\n' "$c_blue"   "$c_reset" "$*"; }
ok()    { printf '%s  ok%s %s\n' "$c_green"  "$c_reset" "$*"; }
warn()  { printf '%s  ! %s %s\n' "$c_yellow" "$c_reset" "$*"; }
fail()  { printf '%s  x %s %s\n' "$c_red"    "$c_reset" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)      PORT="${2:-3000}"; shift 2 ;;
    --http-only) ENABLE_HTTPS=0; shift ;;
    -h|--help)   sed -n '2,10p' "$0"; exit 0 ;;
    *)           fail "Option inconnue : $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || fail "Ce script doit etre lance avec sudo."

# ---------------------------------------------------------------------------
# 1. Node.js et openssl
# ---------------------------------------------------------------------------
info "Verification de Node.js"
need_node=1
if command -v node >/dev/null 2>&1; then
  current_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$current_major" -ge 20 ]]; then
    need_node=0
    ok "Node.js $(node -v) deja present"
  else
    warn "Node.js $(node -v) est trop ancien (v20 minimum)"
  fi
fi

if [[ $need_node -eq 1 ]]; then
  info "Installation de Node.js ${NODE_MAJOR}.x depuis NodeSource"
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg build-essential python3
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
  ok "Node.js $(node -v) installe"
fi

if [[ $ENABLE_HTTPS -eq 1 ]] && ! command -v openssl >/dev/null 2>&1; then
  info "Installation d'openssl (certificat local)"
  apt-get install -y -qq openssl
fi

# ---------------------------------------------------------------------------
# 2. Utilisateur systeme dedie
# ---------------------------------------------------------------------------
if id "$APP_USER" >/dev/null 2>&1; then
  ok "Utilisateur ${APP_USER} deja present"
else
  info "Creation de l'utilisateur systeme ${APP_USER}"
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
  ok "Utilisateur cree"
fi

# ---------------------------------------------------------------------------
# 3. Copie des fichiers
# ---------------------------------------------------------------------------
info "Copie de l'application vers ${APP_DIR}"
mkdir -p "$APP_DIR"

if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  command -v rsync >/dev/null 2>&1 || apt-get install -y -qq rsync
  # --delete nettoie les anciens fichiers, mais data/ et .env sont preserves.
  rsync -a --delete \
    --exclude 'data/' --exclude '.env' --exclude 'node_modules/' \
    --exclude '.git/' --exclude 'backups/' \
    "$SOURCE_DIR"/ "$APP_DIR"/
fi
mkdir -p "$APP_DIR/data/uploads"
ok "Fichiers en place"

# ---------------------------------------------------------------------------
# 4. Configuration
# ---------------------------------------------------------------------------
if [[ -f "$APP_DIR/.env" ]]; then
  ok "Fichier .env existant conserve"
else
  info "Generation du fichier .env"
  cat > "$APP_DIR/.env" <<ENVEOF
PORT=${PORT}
HOST=0.0.0.0
DATA_DIR=${APP_DIR}/data
ENABLE_HTTPS=${ENABLE_HTTPS}
RAWG_API_KEY=
MAX_UPLOAD_MB=5
ENVEOF
  ok "Fichier .env cree"
fi

# ---------------------------------------------------------------------------
# 5. Dependances npm
# ---------------------------------------------------------------------------
info "Installation des dependances npm (peut prendre une minute)"
cd "$APP_DIR"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi
ok "Dependances installees"

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------------------
# 6. Service systemd
# ---------------------------------------------------------------------------
info "Installation du service systemd"
sed -e "s|__APP_DIR__|${APP_DIR}|g" \
    -e "s|__APP_USER__|${APP_USER}|g" \
    "$APP_DIR/deploy/gameshelf.service" > "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable "$APP_NAME" >/dev/null 2>&1
systemctl restart "$APP_NAME"
sleep 3

if systemctl is-active --quiet "$APP_NAME"; then
  ok "Service ${APP_NAME} demarre"
else
  journalctl -u "$APP_NAME" -n 30 --no-pager || true
  fail "Le service n'a pas demarre (voir les logs ci-dessus)"
fi

# ---------------------------------------------------------------------------
# 7. Pare-feu (si ufw est actif)
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  info "Ouverture du port ${PORT} dans ufw"
  ufw allow "${PORT}/tcp" >/dev/null 2>&1 && ok "Port ${PORT} autorise"
fi

# ---------------------------------------------------------------------------
# Recapitulatif
# ---------------------------------------------------------------------------
if [[ $ENABLE_HTTPS -eq 1 ]]; then scheme="https"; else scheme="http"; fi
ip_address="$(hostname -I | awk '{print $1}')"

echo
echo "==========================================================="
echo " GameShelf est installe. Aucun compte, aucun mot de passe."
echo "-----------------------------------------------------------"
echo " Sur ce serveur   : ${scheme}://localhost:${PORT}"
echo " Sur le telephone : ${scheme}://${ip_address}:${PORT}"
echo "-----------------------------------------------------------"
if [[ $ENABLE_HTTPS -eq 1 ]]; then
  echo " Le certificat est auto-signe : le navigateur affichera un"
  echo " avertissement a la premiere visite. Acceptez-le une fois"
  echo " (Parametres avances > Continuer), c'est ce qui autorise"
  echo " la camera pour le scan de codes-barres."
else
  echo " Mode HTTP : le scan par camera sera refuse par le"
  echo " navigateur du telephone. Relancez sans --http-only"
  echo " pour l'activer."
fi
echo "-----------------------------------------------------------"
echo " Logs        : sudo journalctl -u ${APP_NAME} -f"
echo " Redemarrer  : sudo systemctl restart ${APP_NAME}"
echo " Donnees     : ${APP_DIR}/data"
echo "==========================================================="
