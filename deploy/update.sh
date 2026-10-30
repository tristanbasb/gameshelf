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

# Lance depuis la copie installee, le script n'aurait rien a recuperer :
# install.sh n'y copie pas .git, et ne recopierait le dossier que sur
# lui-meme. Le service redemarrerait sur l'ancienne version sans rien dire.
if [[ "$SOURCE_DIR" == "$APP_DIR" && ! -d "$SOURCE_DIR/.git" ]]; then
  echo "${APP_DIR} est la copie installee, pas un clone git : rien a mettre a jour." >&2
  echo "Lancez ce script depuis le dossier du git clone, par exemple :" >&2
  echo "  cd ~/gameshelf && sudo ./deploy/update.sh" >&2
  exit 1
fi

echo "==> Sauvegarde de la base"
sudo -u "$APP_NAME" node "$APP_DIR/scripts/backup.js" || \
  echo "  (sauvegarde ignoree : la base n'existe peut-etre pas encore)"

echo "==> Recuperation des sources"
if [[ -d "$SOURCE_DIR/.git" ]]; then
  git -C "$SOURCE_DIR" pull --ff-only
fi

echo "==> Deploiement"
exec "$SOURCE_DIR/deploy/install.sh"
