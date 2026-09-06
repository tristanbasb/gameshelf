#!/usr/bin/env bash
#
# Met a jour une installation systemd de GameShelf depuis le depot git.
#
#   cd /chemin/vers/le/clone && sudo ./deploy/update.sh
#
# Une sauvegarde de la base est faite avant toute chose.
#
set -euo pipefail

APP_NAME="gameshelf"
APP_DIR="/opt/${APP_NAME}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ $EUID -eq 0 ]] || { echo "Lancez ce script avec sudo." >&2; exit 1; }
[[ -d "$APP_DIR" ]] || { echo "Installation introuvable dans ${APP_DIR}." >&2; exit 1; }

echo "==> Sauvegarde de la base"
sudo -u "$APP_NAME" node "$APP_DIR/scripts/backup.js" "$APP_DIR/backups" || \
  echo "  (sauvegarde ignoree : la base n'existe peut-etre pas encore)"

echo "==> Recuperation des sources"
if [[ -d "$SOURCE_DIR/.git" ]]; then
  git -C "$SOURCE_DIR" pull --ff-only
fi

echo "==> Deploiement"
exec "$SOURCE_DIR/deploy/install.sh"
