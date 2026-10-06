#!/usr/bin/env bash
#
# Verification complete de bout en bout.
#
#   npm test
#
# Demarre une instance isolee sur un port libre, avec une base neuve dans un
# dossier temporaire, y deroule le test de bout en bout, puis nettoie. La
# collection reelle n'est jamais touchee : rien ne pointe vers data/.
#
set -uo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Le dossier de test vit dans le depot, sous un nom ignore par git. Un dossier
# temporaire du systeme obligerait a ecrire le meme chemin de deux facons :
# node.exe ne comprend pas /tmp, et le shell de Windows ne comprend pas les
# chemins a antislashs. Un chemin relatif au projet est lu correctement des
# deux cotes — config.js le resout depuis la racine.
RELATIF=".test-$$"
DOSSIER="$RACINE/$RELATIF"
PORT="${PORT_TEST:-$((3100 + RANDOM % 800))}"
JOURNAL="$DOSSIER/serveur.log"
PID=""

nettoyer() {
  if [[ -n "$PID" ]]; then
    kill "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
  fi
  rm -rf "$DOSSIER" 2>/dev/null
}
trap nettoyer EXIT

mkdir -p "$DOSSIER"
printf '==> Instance de test sur le port %s\n' "$PORT"

DATA_DIR="./$RELATIF/data" ENABLE_HTTPS=0 PORT="$PORT" HOST=127.0.0.1 \
  node "$RACINE/src/server.js" > "$JOURNAL" 2>&1 &
PID=$!

# Dix secondes au plus pour que le service reponde.
pret=0
for _ in $(seq 1 50); do
  if curl -fs -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null; then
    pret=1
    break
  fi
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.2
done

if [[ $pret -eq 0 ]]; then
  echo "Le service de test n'a pas demarre :" >&2
  cat "$JOURNAL" >&2
  exit 1
fi

bash "$RACINE/scripts/smoke-test.sh" "http://127.0.0.1:$PORT"
CODE=$?

# Une erreur apparue dans les journaux du serveur compte comme un echec : elle
# ne se voit pas forcement dans les reponses HTTP.
if grep -q '\[erreur\]' "$JOURNAL"; then
  echo "Des erreurs ont ete journalisees par le serveur :" >&2
  grep '\[erreur\]' "$JOURNAL" >&2
  CODE=1
fi

exit $CODE
