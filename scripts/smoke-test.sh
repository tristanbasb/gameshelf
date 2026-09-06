#!/usr/bin/env bash
#
# Verification de bout en bout d'une instance GameShelf demarree.
#
#   ./scripts/smoke-test.sh                          # https://localhost:3000
#   ./scripts/smoke-test.sh https://192.168.1.20:3000
#   ./scripts/smoke-test.sh http://localhost:3000
#
# Cree un jeu de test, verifie chaque endpoint, puis nettoie derriere lui.
# L'option -k de curl accepte le certificat local auto-signe.
#
set -uo pipefail

BASE_URL="${1:-https://localhost:3000}"
FAILURES=0
CREATED_ID=""

c_reset=$'\033[0m'; c_green=$'\033[1;32m'; c_red=$'\033[1;31m'; c_blue=$'\033[1;34m'

cleanup() {
  if [[ -n "$CREATED_ID" ]]; then
    curl -sk -X DELETE "$BASE_URL/api/games/$CREATED_ID" >/dev/null || true
  fi
}
trap cleanup EXIT

check() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf '%s  PASS%s  %s\n' "$c_green" "$c_reset" "$label"
  else
    printf '%s  FAIL%s  %s (attendu %s, obtenu %s)\n' "$c_red" "$c_reset" "$label" "$expected" "$actual"
    FAILURES=$((FAILURES + 1))
  fi
}

contains() {
  local label="$1" haystack="$2" needle="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf '%s  PASS%s  %s\n' "$c_green" "$c_reset" "$label"
  else
    printf '%s  FAIL%s  %s (motif "%s" absent)\n' "$c_red" "$c_reset" "$label" "$needle"
    FAILURES=$((FAILURES + 1))
  fi
}

# Code HTTP d'une requete
status() {
  curl -sk -o /dev/null -w '%{http_code}' "$@"
}

printf '%s==>%s Test de %s\n\n' "$c_blue" "$c_reset" "$BASE_URL"

# --- 1. Le service repond ---------------------------------------------------
check "GET /healthz" "$(status "$BASE_URL/healthz")" "200"
contains "/healthz renvoie status=ok" "$(curl -sk "$BASE_URL/healthz")" '"status":"ok"'

# --- 2. Contexte securise (necessaire au scan par camera) -------------------
if [[ "$BASE_URL" == https://* ]]; then
  printf '%s  PASS%s  servi en HTTPS : le scan par camera sera autorise\n' "$c_green" "$c_reset"
else
  printf '  note   servi en HTTP : la camera sera refusee sur un telephone\n'
  printf '         (saisie manuelle du code uniquement)\n'
fi

# --- 3. Lecture -------------------------------------------------------------
check "GET /api/config" "$(status "$BASE_URL/api/config")" "200"
check "GET /api/games"  "$(status "$BASE_URL/api/games")"  "200"
check "GET /api/meta"   "$(status "$BASE_URL/api/meta")"   "200"
check "GET /api/lookup" "$(status "$BASE_URL/api/lookup?ean=3307210000000")" "200"

# --- 4. Creation ------------------------------------------------------------
create_body="$(curl -sk -H 'Content-Type: application/json' \
  -d '{"title":"__smoke_test__","platform":"Test","condition":"good","quantity":2,"rating":7,"ean":"3307219999999","has_manual":0}' \
  "$BASE_URL/api/games")"

CREATED_ID="$(printf '%s' "$create_body" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')"
if [[ -n "$CREATED_ID" ]]; then
  printf '%s  PASS%s  POST /api/games (id=%s)\n' "$c_green" "$c_reset" "$CREATED_ID"
else
  printf '%s  FAIL%s  POST /api/games : %s\n' "$c_red" "$c_reset" "$create_body"
  FAILURES=$((FAILURES + 1))
fi

if [[ -n "$CREATED_ID" ]]; then
  check "GET /api/games/:id" "$(status "$BASE_URL/api/games/$CREATED_ID")" "200"
  check "PUT /api/games/:id" "$(status -X PUT -H 'Content-Type: application/json' \
    -d '{"title":"__smoke_test__","condition":"mint","quantity":3}' "$BASE_URL/api/games/$CREATED_ID")" "200"
  check "POST favori"        "$(status -X POST "$BASE_URL/api/games/$CREATED_ID/favorite")" "200"

  # Le jeu cree porte un code-barres et une notice manquante : on verifie que
  # le scan le retrouve et que le filtre "incomplets" le remonte.
  contains "/api/lookup retrouve le jeu par son code-barres" \
    "$(curl -sk "$BASE_URL/api/lookup?ean=3307219999999")" '"found":true'
  contains "filtre incomplete=1 remonte le jeu sans notice" \
    "$(curl -sk "$BASE_URL/api/games?incomplete=1&search=__smoke_test__")" '__smoke_test__'
fi

# --- 5. Validation des entrees ---------------------------------------------
check "POST sans titre -> 400" "$(status -H 'Content-Type: application/json' \
  -d '{"title":""}' "$BASE_URL/api/games")" "400"
check "POST etat invalide -> 400" "$(status -H 'Content-Type: application/json' \
  -d '{"title":"x","condition":"nimportequoi"}' "$BASE_URL/api/games")" "400"
check "POST quantite invalide -> 400" "$(status -H 'Content-Type: application/json' \
  -d '{"title":"x","quantity":0}' "$BASE_URL/api/games")" "400"
check "POST code-barres invalide -> 400" "$(status -H 'Content-Type: application/json' \
  -d '{"title":"x","ean":"abc123"}' "$BASE_URL/api/games")" "400"
check "GET jeu inexistant -> 404" "$(status "$BASE_URL/api/games/99999999")" "404"
check "GET tout afficher (limit=all)" "$(status "$BASE_URL/api/games?limit=all")" "200"

# --- 6. Export --------------------------------------------------------------
check "GET /api/export?format=csv"  "$(status "$BASE_URL/api/export?format=csv")"  "200"
check "GET /api/export?format=json" "$(status "$BASE_URL/api/export?format=json")" "200"
check "GET /api/backup"             "$(status "$BASE_URL/api/backup")"             "200"

# --- 7. Import --------------------------------------------------------------
check "POST /api/import" "$(status -H 'Content-Type: application/json' \
  -d '{"format":"csv","mode":"merge","content":"titre,plateforme,quantite,etat,notice,ean\n__smoke_import__,Test,2,bon etat,non,3307218888888\n"}' \
  "$BASE_URL/api/import")" "200"

imported_id="$(curl -sk "$BASE_URL/api/games?search=__smoke_import__" \
  | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -n1)"
if [[ -n "$imported_id" ]]; then
  curl -sk -X DELETE "$BASE_URL/api/games/$imported_id" >/dev/null
fi

# --- 8. Suppression ---------------------------------------------------------
if [[ -n "$CREATED_ID" ]]; then
  check "DELETE /api/games/:id" "$(status -X DELETE "$BASE_URL/api/games/$CREATED_ID")" "200"
  CREATED_ID=""
fi

# --- 9. Pages ---------------------------------------------------------------
check "GET / (page app)"      "$(status "$BASE_URL/")"                 "200"
check "GET /css/style.css"    "$(status "$BASE_URL/css/style.css")"    "200"
check "GET /js/app.js"        "$(status "$BASE_URL/js/app.js")"        "200"
check "GET /page-inexistante" "$(status "$BASE_URL/page-inexistante")" "404"

echo
if [[ $FAILURES -eq 0 ]]; then
  printf '%sTous les tests sont passes.%s\n' "$c_green" "$c_reset"
  exit 0
fi
printf '%s%d test(s) en echec.%s\n' "$c_red" "$FAILURES" "$c_reset"
exit 1
