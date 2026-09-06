# GameShelf

Inventaire **100 % local** pour une collection de jeux vidéo : quels jeux vous
possédez, **en combien d'exemplaires**, **dans quel état**, et **ce qui manque**
dans la boîte.

Avec un **scan de code-barres depuis le téléphone** pour répondre en rayon à la
seule question qui compte : « est-ce que je l'ai déjà ? »

Pas de compte, pas de mot de passe, pas de nom de domaine, aucun service
externe : un serveur Node.js et un fichier SQLite sur votre réseau.

---

## Ce que fait l'application

- **Fiche par jeu** : titre, plateforme, code-barres, quantité, état,
  complétude, tags, visuel, notes libres, favori.
- **Scan de code-barres** : ouvrez la caméra du téléphone, visez le dos du
  boîtier, et l'application répond immédiatement — soit « ✓ vous l'avez déjà »
  avec la quantité, l'état et les pièces manquantes, soit une proposition
  d'ajout avec le code déjà rempli.
- **Complétude** : cochez ce que contient l'exemplaire (boîte, jaquette papier,
  notice, disque ou cartouche). La vue **Incomplets** liste d'un coup tout ce
  qui est amputé d'une pièce.
- **Recherche instantanée** sur le titre, la plateforme, les tags, les notes
  et le code-barres.
- **Filtres** par état, plateforme, tag, favoris et incomplets —
  combinables, et reflétés dans l'URL.
- **Saisie en chaîne** : le bouton **Enregistrer et suivant** garde la fiche
  ouverte, conserve la plateforme et l'état, vide le reste et replace le
  curseur sur le titre. Cataloguer une étagère revient à enchaîner
  titre → Entrée. Ces deux valeurs sont mémorisées d'une session à l'autre.
- **Deux affichages** : grille de visuels, ou tableau triable colonne par
  colonne. Pagination réglable, avec une option **Tout afficher** (400 fiches
  s'affichent en une vingtaine de millisecondes).
- **Import / export** CSV et JSON, plus une sauvegarde complète de la base.
- **Thème sombre / clair**, interface responsive, utilisable au clavier.

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

## Installation

### Sur un serveur Ubuntu

```bash
git clone https://github.com/tristanbasb/gameshelf.git && cd gameshelf
sudo ./deploy/install.sh
```

Le script installe Node.js si besoin, crée un utilisateur système dédié,
installe le service systemd, génère le certificat local et ouvre le port dans
`ufw` s'il est actif. À la fin, il affiche les deux adresses à utiliser :

```
Sur ce serveur   : https://localhost:3000
Sur le telephone : https://192.168.1.20:3000
```

C'est tout — l'application est directement utilisable, sans connexion.

Le script est idempotent : relancez-le pour mettre à jour (`.env` et `data/`
sont préservés).

```bash
sudo systemctl status gameshelf     # état du service
sudo journalctl -u gameshelf -f     # logs en direct
sudo systemctl restart gameshelf    # redémarrage
sudo ./deploy/update.sh             # git pull + sauvegarde + redéploiement
```

### Avec Docker

```bash
git clone https://github.com/tristanbasb/gameshelf.git && cd gameshelf
mkdir -p data && sudo chown -R 1000:1000 data
docker compose up -d --build
```

### Sans rien installer, pour essayer

```bash
npm install && npm start
```

Puis <https://localhost:3000>.

---

## Le scan depuis le téléphone

Ouvrez `https://<ip-du-serveur>:3000` dans le navigateur du téléphone (même
réseau Wi-Fi) et touchez **Scanner**.

### Le certificat

> Les navigateurs **réservent l'accès à la caméra aux connexions sécurisées**.
> Sans nom de domaine, impossible d'obtenir un certificat public : GameShelf
> génère donc au premier démarrage un certificat auto-signé couvrant l'adresse
> IP locale de la machine.

À la première visite, le téléphone affichera un avertissement de sécurité.
C'est attendu. Touchez **Paramètres avancés → Continuer vers le site** : c'est
cette acceptation qui autorise ensuite la caméra.

Le certificat est stocké dans `data/tls/` et dure 10 ans. Il est régénéré
automatiquement uniquement si l'adresse IP du serveur change — pensez donc à
réserver une IP fixe pour la machine dans votre box, sinon l'avertissement
réapparaîtra à chaque changement d'adresse.

### Si la caméra reste refusée

Certains navigateurs restent stricts avec un certificat auto-signé. Deux
solutions :

1. **Installer le certificat comme approuvé sur le téléphone** — copiez
   `data/tls/cert.pem` sur l'appareil et ajoutez-le dans
   *Paramètres → Sécurité → Chiffrement → Installer un certificat → Certificat
   CA*. L'avertissement disparaît définitivement.
2. **Autoriser l'origine dans Chrome** — ouvrez
   `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, ajoutez
   `http://192.168.1.20:3000` (avec votre IP), activez, relancez le navigateur.
   Vous pouvez alors utiliser l'adresse en HTTP simple.

Dans tous les cas, la **saisie manuelle du code** reste disponible et donne
exactement la même réponse.

### Compatibilité

La lecture s'appuie sur l'API `BarcodeDetector` du navigateur, disponible sur
Chrome pour Android. Sur un navigateur qui ne la propose pas (Safari iOS
notamment), l'application bascule automatiquement sur la saisie manuelle.

Formats lus : EAN-13, EAN-8, UPC-A, UPC-E, Code 128, ITF.

---

## Configuration

Tout est optionnel : les valeurs par défaut conviennent à une installation
locale. Voir [`.env.example`](.env.example).

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `HOST` | `0.0.0.0` | Interface d'écoute (`0.0.0.0` = accessible depuis le réseau local) |
| `DATA_DIR` | `./data` | Base SQLite, images et certificat |
| `ENABLE_HTTPS` | `1` | HTTPS local auto-signé. `0` = HTTP simple, sans scan par caméra |
| `RAWG_API_KEY` | *(vide)* | Active le pré-remplissage en ligne ([rawg.io/apidocs](https://rawg.io/apidocs)) |
| `MAX_UPLOAD_MB` | `5` | Taille maximale d'une image |

> **Aucune authentification** : toute personne ayant accès au réseau local peut
> lire et modifier la collection. C'est le compromis assumé d'une installation
> domestique. N'exposez pas le port sur Internet.

---

## Importer une collection existante

Bouton **Import / export** dans l'en-tête. Le fichier peut être un CSV
(séparateur `,`, `;` ou tabulation, détecté automatiquement) ou un JSON.

La première ligne du CSV donne les en-têtes. Les noms français courants sont
reconnus :

```csv
titre,plateforme,ean,quantité,état,boîte,jaquette,notice,disque,tags,notes
Chrono Trigger,Super Nintendo,3307210001003,1,comme neuf,oui,oui,oui,oui,collector,Rangé étagère 2
Tetris,Game Boy,3307210001004,4,correct,non,non,non,oui,,Trois cartouches nues
```

Conversions automatiques :

- **État** : `neuf`, `sous blister`, `comme neuf`, `TBE`, `bon état`,
  `correct`, `abîmé`…
- **Complétude** : une colonne vide vaut « présent » ; écrivez `non`,
  `manquant` ou `absent` pour signaler une pièce manquante.

Deux modes : **Ajouter** (les doublons titre + plateforme sont ignorés) ou
**Remplacer** (la collection est effacée avant l'import). Les lignes invalides
sont signalées, l'import se poursuit pour les autres.

---

## Sauvegardes

Les données tiennent dans `data/` : la base `gameshelf.db`, le dossier
`uploads/` et le certificat `tls/`.

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

## Vérifier une installation

```bash
./scripts/smoke-test.sh https://localhost:3000
```

Le script teste l'ensemble des routes (lecture, création, modification, scan
par code-barres, filtre des incomplets, validation des entrées, import, export,
sauvegarde, pages statiques) et supprime les données de test qu'il a créées.

---

## API HTTP

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/healthz` | État du service |
| `GET` | `/api/config` | Capacités de l'instance |
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
`tag`, `favorite=1`, `incomplete=1`, `sort`, `dir`, `page`,
`limit` (`limit=all` renvoie toute la collection).

---

## Structure du dépôt

```
src/            serveur Express, accès SQLite, routes
  config.js     lecture de la configuration et du .env
  db.js         schéma et migrations
  tls.js        certificat local auto-signé
  games.js      validation et requêtes sur les jeux
  csv.js        lecture / écriture CSV
  routes/       jeux, import-export, recherche externe
public/         interface (HTML, CSS, JS natif — aucun build)
deploy/         install.sh, update.sh, unité systemd
scripts/        sauvegarde, smoke-test
```

Le schéma évolue par migrations incrémentales (`PRAGMA user_version` dans
`src/db.js`) : ajoutez une fonction à la fin du tableau, ne modifiez jamais les
précédentes.

---

## Licence

MIT
