# GameShelf

Inventaire auto-hébergé pour une collection de jeux vidéo : quels jeux vous
possédez, **en combien d'exemplaires**, **dans quel état**, et **ce qui manque**
dans la boîte.

Avec un **scan de code-barres depuis le téléphone** pour répondre en rayon à la
seule question qui compte : « est-ce que je l'ai déjà ? »

Application web légère (Node.js + SQLite, sans étape de build côté client),
pensée pour tourner sur un petit serveur Ubuntu.

---

## Ce que fait l'application

- **Fiche par jeu** : titre, plateforme, code-barres, quantité, état,
  format (physique / dématérialisé), complétude, développeur, éditeur, année,
  note, date d'achat, tags, visuel, notes libres, favori.
- **Scan de code-barres** : ouvrez la caméra du téléphone, visez le dos du
  boîtier, et l'application répond immédiatement — soit « ✓ vous l'avez déjà »
  avec la quantité, l'état et les pièces manquantes, soit une proposition
  d'ajout avec le code déjà rempli.
- **Complétude** : cochez ce que contient l'exemplaire (boîte, jaquette papier,
  notice, disque ou cartouche). La vue **Incomplets** liste d'un coup tout ce
  qui est amputé d'une pièce.
- **Recherche instantanée** sur le titre, le studio, l'éditeur, les tags, les
  notes et le code-barres.
- **Filtres** par état, plateforme, format, tag, favoris et incomplets —
  combinables, et reflétés dans l'URL (une vue filtrée se met en marque-page).
- **Deux affichages** : grille de visuels, ou tableau triable colonne par
  colonne. Pagination réglable, avec une option **Tout afficher**.
- **Import / export** CSV et JSON, plus une sauvegarde complète de la base.
- **Thème sombre / clair**, interface responsive, utilisable au clavier.
- **Authentification** par session ; compte administrateur créé au premier
  démarrage.

### États disponibles

| Valeur stockée | Libellé            |
|----------------|--------------------|
| `sealed`       | Neuf, sous blister |
| `mint`         | Comme neuf         |
| `good`         | Bon état           |
| `fair`         | État correct       |
| `poor`         | Abîmé              |
| *(vide)*       | Non renseigné      |

### Raccourcis clavier

`s` scanner · `n` nouveau jeu · `/` recherche · `Échap` fermer / vider

---

## Le scan depuis le téléphone

Ouvrez simplement l'application dans le navigateur du téléphone et touchez
**Scanner**.

> **La caméra exige une connexion HTTPS** (ou `localhost`) — c'est une règle des
> navigateurs, pas de l'application. En HTTP simple, le scan bascule
> automatiquement sur une saisie manuelle du code. Suivez la procédure nginx +
> certbot ci-dessous pour obtenir un certificat.

La lecture s'appuie sur l'API `BarcodeDetector` du navigateur, disponible sur
Chrome pour Android. Sur un navigateur qui ne la propose pas (Safari iOS
notamment), la saisie manuelle du code reste disponible et donne la même
réponse.

Formats lus : EAN-13, EAN-8, UPC-A, UPC-E, Code 128, ITF.

---

## Déploiement

### Option A — Docker (recommandé)

Prérequis : Docker et le plugin Compose.

```bash
git clone https://github.com/tristanbasb/gameshelf.git && cd gameshelf
cp .env.example .env
```

Renseignez au minimum `ADMIN_PASSWORD` et `SESSION_SECRET` dans `.env` :

```bash
printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
```

Puis :

```bash
mkdir -p data && sudo chown -R 1000:1000 data
docker compose up -d --build
```

L'application écoute sur `127.0.0.1:3000`. Pour y accéder depuis le réseau
local, remplacez le mapping de ports dans `docker-compose.yml` par
`"3000:3000"` ; pour une exposition publique — et pour le scan par caméra —
placez un reverse proxy HTTPS devant et gardez `TRUST_PROXY=1`.

```bash
docker compose logs -f          # suivre les logs
docker compose restart          # redémarrer
docker compose down             # arrêter
docker compose up -d --build    # mettre à jour après un git pull
```

### Option B — Installation native avec systemd

Le script gère tout : Node.js, utilisateur système dédié, dépendances,
service systemd et, si vous le demandez, nginx.

```bash
git clone https://github.com/tristanbasb/gameshelf.git && cd gameshelf
sudo ./deploy/install.sh
```

Avec un nom de domaine, un reverse proxy nginx et HTTPS (nécessaire au scan) :

```bash
sudo ./deploy/install.sh --nginx jeux.mondomaine.fr
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d jeux.mondomaine.fr
```

Le script affiche l'identifiant et le mot de passe administrateur à la fin.
Il est idempotent : relancez-le pour mettre à jour une installation existante
(`.env` et `data/` sont préservés).

```bash
sudo systemctl status gameshelf     # état du service
sudo journalctl -u gameshelf -f     # logs en direct
sudo systemctl restart gameshelf    # redémarrage
sudo ./deploy/update.sh             # git pull + sauvegarde + redéploiement
```

### Option C — En local, pour tester

```bash
npm install
cp .env.example .env
npm start
```

Puis <http://localhost:3000> — `localhost` étant un contexte sécurisé, le scan
par caméra fonctionne aussi en local. Le mot de passe administrateur généré
s'affiche une seule fois dans la console au tout premier démarrage.

---

## Configuration

Toutes les options passent par des variables d'environnement (fichier `.env`
ou environnement systemd/Docker). Voir [`.env.example`](.env.example).

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `HOST` | `0.0.0.0` | Interface d'écoute (`127.0.0.1` derrière un proxy) |
| `DATA_DIR` | `./data` | Base SQLite + images téléversées |
| `ADMIN_USERNAME` | `admin` | Identifiant créé au premier démarrage |
| `ADMIN_PASSWORD` | *(vide)* | Si vide, un mot de passe aléatoire est généré et affiché dans les logs |
| `SESSION_SECRET` | *(généré)* | À définir en production (`openssl rand -hex 32`) |
| `SESSION_DAYS` | `30` | Durée de validité d'une session |
| `TRUST_PROXY` | `0` | `1` derrière un reverse proxy (X-Forwarded-*) |
| `DISABLE_AUTH` | `0` | `1` pour supprimer la connexion — réseau privé uniquement |
| `RAWG_API_KEY` | *(vide)* | Active le pré-remplissage en ligne ([rawg.io/apidocs](https://rawg.io/apidocs)) |
| `MAX_UPLOAD_MB` | `5` | Taille maximale d'une image |

---

## Importer une collection existante

Bouton **Import / export** dans l'en-tête. Le fichier peut être un CSV
(séparateur `,`, `;` ou tabulation, détecté automatiquement) ou un JSON.

La première ligne du CSV donne les en-têtes. Les noms français courants sont
reconnus :

```csv
titre,plateforme,ean,quantité,état,format,boîte,jaquette,notice,disque,année,éditeur,tags,notes
Chrono Trigger,Super Nintendo,3307210001003,1,comme neuf,physique,oui,oui,oui,oui,1995,Square,collector,Rangé étagère 2
Tetris,Game Boy,3307210001004,4,correct,physique,non,non,non,oui,1989,Nintendo,,Trois cartouches nues
```

Conversions automatiques :

- **État** : `neuf`, `sous blister`, `comme neuf`, `TBE`, `bon état`,
  `correct`, `abîmé`…
- **Format** : `physique`, `démat`, `steam`…
- **Complétude** : une colonne vide vaut « présent » ; écrivez `non`,
  `manquant` ou `absent` pour signaler une pièce manquante.

Deux modes :

- **Ajouter** — les doublons (même titre + même plateforme) sont ignorés ;
- **Remplacer** — la collection est effacée avant l'import.

Les lignes invalides sont signalées, l'import se poursuit pour les autres.

---

## Sauvegardes

Les données tiennent dans `data/` : la base `gameshelf.db` et le dossier
`uploads/`.

Depuis l'interface, **Import / export → Sauvegarde .db** télécharge une copie
cohérente de la base sans arrêter le service.

En ligne de commande :

```bash
node scripts/backup.js                 # écrit dans ./backups, garde les 14 dernières
docker compose exec gameshelf node scripts/backup.js
```

Sauvegarde quotidienne par cron :

```cron
0 3 * * * cd /opt/gameshelf && /usr/bin/node scripts/backup.js >> /var/log/gameshelf-backup.log 2>&1
```

> Une simple copie de `gameshelf.db` pendant que le service tourne peut être
> incohérente (mode WAL). Utilisez toujours le script ou le bouton dédié.

---

## Mot de passe oublié

```bash
node scripts/reset-password.js                  # compte admin, mot de passe aléatoire
node scripts/reset-password.js admin 'nouveau'  # mot de passe imposé
docker compose exec gameshelf node scripts/reset-password.js
```

Toutes les sessions existantes sont révoquées.

---

## Vérifier une installation

```bash
./scripts/smoke-test.sh http://localhost:3000 admin 'votre-mot-de-passe'
```

Le script teste l'ensemble des routes (lecture, création, modification, scan
par code-barres, filtre des incomplets, validation des entrées, import, export,
sauvegarde, pages statiques) et supprime les données de test qu'il a créées.

---

## API HTTP

Toutes les routes `/api/*` exigent le cookie de session, obtenu via
`POST /api/auth/login`.

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/healthz` | État du service (publique) |
| `POST` | `/api/auth/login` | Connexion (`{username, password}`) |
| `POST` | `/api/auth/logout` | Déconnexion |
| `GET` | `/api/auth/me` | Session courante |
| `POST` | `/api/auth/password` | Changement de mot de passe |
| `GET` | `/api/games` | Liste filtrée et paginée |
| `POST` | `/api/games` | Création |
| `GET` | `/api/games/:id` | Détail |
| `PUT` | `/api/games/:id` | Modification (fusion partielle) |
| `POST` | `/api/games/:id/favorite` | Bascule du favori |
| `DELETE` | `/api/games/:id` | Suppression |
| `GET` | `/api/lookup?ean=` | « Est-ce que je l'ai ? » — recherche par code-barres |
| `GET` | `/api/meta` | Plateformes, tags, compteurs des vues rapides |
| `GET` | `/api/export?format=csv\|json` | Export |
| `POST` | `/api/import` | Import (`{content, format, mode}`) |
| `GET` | `/api/backup` | Copie de la base SQLite |
| `POST` | `/api/upload` | Téléversement d'une image (`multipart`, champ `cover`) |
| `GET` | `/api/external/search?q=` | Recherche RAWG (si clé configurée) |

Paramètres de `GET /api/games` : `search`, `ean`, `platform`, `condition`,
`format`, `tag`, `favorite=1`, `incomplete=1`, `sort`, `dir`, `page`,
`limit` (`limit=all` renvoie toute la collection).

---

## Structure du dépôt

```
src/            serveur Express, accès SQLite, routes
  config.js     lecture de la configuration et du .env
  db.js         schéma et migrations
  auth.js       sessions, mots de passe, limitation des tentatives
  games.js      validation et requêtes sur les jeux
  csv.js        lecture / écriture CSV
  routes/       auth, jeux, import-export, recherche externe
public/         interface (HTML, CSS, JS natif — aucun build)
deploy/         install.sh, update.sh, unité systemd, conf nginx
scripts/        sauvegarde, réinitialisation de mot de passe, smoke-test
```

Le schéma évolue par migrations incrémentales (`PRAGMA user_version` dans
`src/db.js`) : ajoutez une fonction à la fin du tableau, ne modifiez jamais les
précédentes.

---

## Sécurité

- Mots de passe hachés en bcrypt (coût 12).
- Jetons de session aléatoires (32 octets), stockés hachés en SHA-256, révoqués
  au changement de mot de passe.
- Cookie `HttpOnly`, `SameSite=Lax`, et `Secure` dès que la requête arrive en HTTPS.
- Limitation à 10 tentatives de connexion par IP et par quart d'heure.
- En-têtes `Content-Security-Policy`, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`.
- Requêtes SQL exclusivement paramétrées ; champs de tri sur liste blanche.
- Le service systemd tourne sous un utilisateur dédié, sans privilèges, avec
  un accès en écriture limité à `data/`.

Exposé sur Internet, mettez impérativement l'application derrière HTTPS.

---

## Licence

MIT
