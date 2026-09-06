#!/usr/bin/env bash
#
# Verification de bout en bout d'une instance GameShelf demarree.
#
#   ./scripts/smoke-test.sh [url] [identifiant] [mot_de_passe]
#   ./scripts/smoke-test.sh http://localhost:3000 admin 'motdepasse'
#
# Cree un jeu de test, verifie chaque endpoint, puis nettoie derriere lui.
#
set -uo pipefail

BASE_URL="${1:-http://localhost:3000}"
USERNAME="${2:-admin}"
PASSWORD="${3:-}"
COOKIE_JAR="$(mktemp)"
FAILURES=0
CREATED_ID=""

c_reset=$'\033[0m'; c_green=$'\033[1;32m'; c_red=$'\033[1;31m'; c_blue=$'\033[1;34m'

cleanup() {
  if [[ -n "$CREATED_ID" ]]; then
    curl -s -b "$COOKIE_JAR" -X DELETE "$BASE_URL/api/games/$CREATED_ID" >/dev/null || true
  fi
  rm -f "$COOKIE_JAR"
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

# Code HTTP d'une requete
status() {
  curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -c "$COOKIE_JAR" "$@"
}

printf '%s==>%s Test de %s\n\n' "$c_blue" "$c_reset" "$BASE_URL"

# --- 1. Le service repond ---------------------------------------------------
check "GET /healthz" "$(status "$BASE_URL/healthz")" "200"

health_body="$(curl -s "$BASE_URL/healthz")"
if [[ "$health_body" == *'"status":"ok"'* ]]; then
  printf '%s  PASS%s  /healthz renvoie status=ok\n' "$c_green" "$c_reset"
else
  printf '%s  FAIL%s  /healthz : reponse inattendue (%s)\n' "$c_red" "$c_reset" "$health_body"
  FAILURES=$((FAILURES + 1))
fi

# --- 2. Les routes protegees le sont ----------------------------------------
auth_disabled=0
anon_status="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/games")"
if [[ "$anon_status" == "200" ]]; then
  echo "  note   /api/games accessible sans session : DISABLE_AUTH=1 sur cette instance"
  auth_disabled=1
else
  check "GET /api/games sans session -> 401" "$anon_status" "401"
fi

# --- 3. Connexion -----------------------------------------------------------
if [[ $auth_disabled -eq 0 ]]; then
  if [[ -z "$PASSWORD" ]]; then
    printf '\n%s  !%s  Aucun mot de passe fourni : les tests authentifies sont ignores.\n' "$c_red" "$c_reset"
    echo "     Relancez avec : $0 $BASE_URL $USERNAME '<mot_de_passe>'"
    exit $(( FAILURES > 0 ? 1 : 0 ))
  fi

  login_code="$(curl -s -o /dev/null -w '%{http_code}' -c "$COOKIE_JAR" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
    "$BASE_URL/api/auth/login")"
  check "POST /api/auth/login" "$login_code" "200"

  if [[ "$login_code" != "200" ]]; then
    echo
    echo "  Connexion impossible : verifiez l'identifiant et le mot de passe."
    exit 1
  fi
fi

# --- 4. Lecture -------------------------------------------------------------
check "GET /api/games"  "$(status "$BASE_URL/api/games")"  "200"
check "GET /api/meta"   "$(status "$BASE_URL/api/meta")"   "200"
check "GET /api/stats"  "$(status "$BASE_URL/api/stats")"  "200"

# --- 5. Creation ------------------------------------------------------------
create_body="$(curl -s -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -d '{"title":"__smoke_test__","platform":"Test","condition":"good","quantity":2,"rating":7,"price":12.5}' \
  "$BASE_URL/api/games")"

CREATED_ID="$(printf '%s' "$create_body" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')"
if [[ -n "$CREATED_ID" ]]; then
  printf '%s  PASS%s  POST /api/games (id=%s)\n' "$c_green" "$c_reset" "$CREATED_ID"
else
  printf '%s  FAIL%s  POST /api/games : %s\n' "$c_red" "$c_reset" "$create_body"
  FAILURES=$((FAILURES + 1))
fi

if [[ -n "$CREATED_ID" ]]; then
  check "GET /api/games/:id"    "$(status "$BASE_URL/api/games/$CREATED_ID")" "200"
  check "PUT /api/games/:id"    "$(status -X PUT -H 'Content-Type: application/json' \
    -d '{"title":"__smoke_test__","condition":"mint","quantity":3}' "$BASE_URL/api/games/$CREATED_ID")" "200"
  check "POST favori"           "$(status -X POST "$BASE_URL/api/games/$CREATED_ID/favorite")" "200"
fi

# --- 6. Validation des entrees ---------------------------------------------
check "POST sans titre -> 400" "$(status -H 'Content-Type: application/json' \
  -d '{"title":""}' "$BASE_URL/api/games")" "400"
check "POST etat invalide -> 400" "$(status -H 'Content-Type: application/json' \
  -d '{"title":"x","condition":"nimportequoi"}' "$BASE_URL/api/games")" "400"
check "POST quantite invalide -> 400" "$(status -H 'Content-Type: application/json' \
  -d '{"title":"x","quantity":0}' "$BASE_URL/api/games")" "400"
check "GET jeu inexistant -> 404" "$(status "$BASE_URL/api/games/99999999")" "404"

# --- 7. Export --------------------------------------------------------------
check "GET /api/export?format=csv"  "$(status "$BASE_URL/api/export?format=csv")"  "200"
check "GET /api/export?format=json" "$(status "$BASE_URL/api/export?format=json")" "200"
check "GET /api/backup"             "$(status "$BASE_URL/api/backup")"             "200"

# --- 8. Import --------------------------------------------------------------
import_code="$(status -H 'Content-Type: application/json' \
  -d '{"format":"csv","mode":"merge","content":"titre,plateforme,quantite,etat\n__smoke_import__,Test,2,bon etat\n"}' \
  "$BASE_URL/api/import")"
check "POST /api/import" "$import_code" "200"

imported_id="$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/games?search=__smoke_import__" \
  | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -n1)"
if [[ -n "$imported_id" ]]; then
  curl -s -b "$COOKIE_JAR" -X DELETE "$BASE_URL/api/games/$imported_id" >/dev/null
fi

# --- 9. Suppression ---------------------------------------------------------
if [[ -n "$CREATED_ID" ]]; then
  check "DELETE /api/games/:id" "$(status -X DELETE "$BASE_URL/api/games/$CREATED_ID")" "200"
  CREATED_ID=""
fi

# --- 10. Pages --------------------------------------------------------------
check "GET / (page app)"      "$(status "$BASE_URL/")"            "200"
check "GET /css/style.css"    "$(status "$BASE_URL/css/style.css")" "200"
check "GET /js/app.js"        "$(status "$BASE_URL/js/app.js")"     "200"
check "GET /page-inexistante" "$(status "$BASE_URL/page-inexistante")" "404"

echo
if [[ $FAILURES -eq 0 ]]; then
  printf '%sTous les tests sont passes.%s\n' "$c_green" "$c_reset"
  exit 0
fi
printf '%s%d test(s) en echec.%s\n' "$c_red" "$FAILURES" "$c_reset"
exit 1
