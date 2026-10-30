# GameVault

Inventaire **100 % local** pour une collection de jeux vidéo : quels jeux vous
possédez, **en combien d'exemplaires**, **dans quel état**, et **ce qui manque**
dans la boîte.

Avec un **scan de code-barres depuis le téléphone** pour répondre en rayon à la
seule question qui compte : « est-ce que je l'ai déjà ? »

Pas de compte, pas de mot de passe, pas de nom de domaine, aucun service
externe : un serveur Node.js et un fichier SQLite sur votre réseau.

> Le dépôt, le service systemd et la base gardent leur nom technique
> `gameshelf` : les renommer casserait les installations déjà en place.

---

## Ce que fait l'application

- **Fiche par jeu** : titre, plateforme, région, serial éditeur, code-barres,
  quantité, état, complétude, ISO, tags, visuel, notes libres, favori.
- **« Est-ce que je l'ai ? »** : photographiez le code-barres au dos du
  boîtier (ou tapez ses chiffres), et la réponse tombe aussitôt — « déjà dans
  votre collection » avec l'état et les pièces manquantes, ou « pas dans votre
  collection » avec l'ajout pré-rempli. La réponse vient de la copie de la
  collection gardée sur le téléphone : elle fonctionne **aussi en magasin,
  loin du Wi-Fi de la maison**.
- **Identification par Claude** *(optionnelle, avec une clé Anthropic)* : une
  photo du boîtier, le code-barres et, s'il est connu, le serial suffisent —
  Claude retrouve le jeu, le serveur vérifie la proposition, et vous validez
  la fiche avant qu'elle ne remplisse le formulaire. Voir
  [Identifier un jeu avec Claude](#identifier-un-jeu-avec-claude).
- **Discussion avec Claude** *(même clé)* : des questions en langage courant —
  « quels jeux PS2 n'ont pas leur notice ? », « que vaut ma collection N64 ? ».
  Claude consulte la collection pour répondre, cherche en ligne cotes et
  éditions, et chaque jeu qu'il cite ouvre sa fiche. Voir
  [Discuter avec Claude](#discuter-avec-claude).
- **Recherche instantanée**, sans aller-retour avec le serveur : le titre, la
  plateforme, la région, le serial, les tags, les notes et le code-barres.
  Insensible aux accents et à la casse — « asterix » trouve « Astérix » —, les
  mots dans n'importe quel ordre — « daxter jak » trouve « Jak and Daxter ».
  Les passages trouvés sont surlignés, et une faute de frappe propose le titre
  le plus proche. La recherche comprend aussi l'état de la boîte :
  « ps2 sans notice », « incomplet », « sans iso ».
- **Trois affichages** :
  - **Jaquettes**, chacune à la proportion réelle de son boîtier — un jeu
    Switch est plus étroit qu'un jeu PS2, une boîte de N64 plus large que
    haute ;
  - **Étagère**, les tranches des boîtiers rangées par plateforme, à leur
    épaisseur et leur hauteur réelles, aux couleurs de chaque console ;
  - **Liste**, compacte, avec les colonnes utiles.
- **La frise** : sous la recherche, toute la collection d'un coup d'œil, une
  tranche par jeu. Elle s'allume sur les jeux trouvés pendant la frappe ; on la
  parcourt du doigt (ou à la souris) pour voir passer les titres, et on relâche
  pour ouvrir la fiche.
- **Corrections en un geste** depuis la fiche : l'état, ce que contient la
  boîte, l'ISO, le nombre d'exemplaires, le favori. Retrouver une notice au
  fond d'un carton, c'est un toucher.
- **Filtres** par plateforme, état, région, tag, favoris, incomplets et
  « sans ISO » — combinables, avec le nombre de jeux que chacun laisserait, et
  reflétés dans l'adresse.
- **Bilan** : la longueur d'étagère occupée (à l'épaisseur de chaque boîtier),
  la répartition par plateforme, état et région, la part de boîtes complètes
  et d'ISO. Chaque ligne du bilan affiche les jeux concernés.
- **Saisie en chaîne** : **Enregistrer et suivant** garde le formulaire
  ouvert, conserve plateforme, région et état, vide le reste. Le formulaire
  signale un jeu déjà présent — même titre, ou même code-barres.
- **Import / export** CSV et JSON, plus une sauvegarde complète de la base.
  L'export suit les filtres affichés.
- **Suppression annulable** depuis la notification, pendant neuf secondes.
- **Rien ne bouge sous le doigt** : pas de zoom au toucher d'un champ sur
  iPhone, pas de saut de mise en page pendant la recherche, pas d'effet de
  pression sur les boutons. Le bouton retour du téléphone ferme la fenêtre
  ouverte au lieu de quitter l'application.
- **Installable sur le téléphone**, avec des raccourcis vers le scanner et
  l'ajout. Avec le certificat installé (voir plus bas), l'application s'ouvre
  même sans réseau.
- **Thème sombre, noir, clair ou celui du système** — le noir, sans teinte
  bleue, éteint le fond sur les écrans OLED —, interface responsive,
  utilisable au clavier.

### États disponibles

| Valeur stockée | Libellé            |
|----------------|--------------------|
| `sealed`       | Neuf, sous blister |
| `mint`         | Très bon           |
| `good`         | Bon                |
| `fair`         | Acceptable         |
| `poor`         | Mauvais            |
| *(vide)*       | Non renseigné      |

### Raccourcis clavier

`Ctrl+K` ou `/` recherche · `s` scanner · `n` nouveau jeu · `c` discuter avec Claude (si activé) · `Entrée` ferme le clavier du téléphone · `Échap` vide la recherche ou ferme la fenêtre

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
sudo ./deploy/update.sh             # depuis le clone : sauvegarde + git pull + redéploiement
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
> Sans nom de domaine, impossible d'obtenir un certificat public : GameVault
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

### iPhone : installer le certificat

Safari est plus strict que Chrome : accepter l'avertissement ne suffit pas
toujours à débloquer la caméra. Installer le certificat règle la question, et
le plus simple est de le récupérer depuis le téléphone lui-même :

1. Ouvrir `https://<ip-du-serveur>:3000/cert.pem` dans Safari — iOS propose de
   télécharger un profil de configuration.
2. **Réglages → Profil téléchargé → Installer**.
3. **Réglages → Général → Informations → Réglages de confiance des
   certificats** → activer la confiance pour `GameVault`.
   *Cette étape est indispensable et facile à oublier : sans elle, le
   certificat est installé mais pas approuvé.*
4. Rouvrir `https://<ip-du-serveur>:3000` : plus d'avertissement, et la caméra
   est autorisée.

La même route sert sur Android, où l'étape 3 se trouve dans
*Sécurité → Chiffrement → Installer un certificat → Certificat CA*.

### En magasin, sans réseau

Loin du Wi-Fi de la maison, le serveur ne répond plus. L'application garde
donc une copie de la collection dans le navigateur du téléphone, mise à jour à
chaque ouverture : la recherche, les fiches et le scan continuent de répondre
à partir de cette copie. Les modifications, elles, attendent le retour du
réseau — l'en-tête de la liste signale alors « Copie locale ».

Pour que l'application **s'ouvre** elle-même sans réseau (et pas seulement
reste ouverte), le navigateur doit accepter son service worker, ce qu'il ne
fait qu'avec un certificat reconnu : installez le certificat du serveur sur le
téléphone, comme décrit ci-dessus. Sans lui, gardez simplement l'onglet ouvert
avant de partir.

Les jaquettes suivent : le service worker garde la
[miniature](#miniatures-des-jaquettes) de chaque jeu de la collection, et le
jeu scanné en rayon s'affiche avec la sienne.

### Compatibilité

La lecture fonctionne sur tous les navigateurs, par deux chemins :

- **API `BarcodeDetector`** quand le navigateur la fournit — Chrome et Edge.
  C'est le décodeur du système, le plus rapide.
- **Décodeur embarqué** partout ailleurs, Safari sur iPhone en particulier.
  Il s'agit de ZXing, livré avec l'application dans
  [`public/js/vendor/`](public/js/vendor/) — donc sans accès réseau requis.
  Ses 350 Ko ne sont téléchargés qu'au premier scan sur ces navigateurs,
  jamais au démarrage.

Dans les deux cas, la saisie manuelle du code reste disponible et donne la
même réponse.

Formats lus : EAN-13, EAN-8, UPC-A, UPC-E, Code 128, ITF.

### Si le code est difficile à lire

Le décodeur n'analyse que le rectangle du viseur, à la définition du capteur :
cadrez le code dedans plutôt que de coller le téléphone sur la boîte.

Un code flou reste illisible, quel que soit le traitement — l'information
n'est pas dans l'image. L'application agit donc sur la prise de vue :

- **autofocus continu** demandé à la caméra dès l'ouverture ;
- **toucher l'aperçu** refait la mise au point à cet endroit, utile quand le
  téléphone s'obstine à viser l'arrière-plan ;
- **bouton d'éclairage** en bas à droite quand l'appareil le permet : en
  faible lumière, le capteur allonge le temps de pose et le moindre mouvement
  devient flou.

---

## Miniatures des jaquettes

Les jaquettes viennent le plus souvent d'autres sites — Amazon, eBay,
PriceCharting, des boutiques — et en grand format, souvent 1300 à 1600 pixels
de large. Sur un téléphone, la grille en décoderait des centaines pour les
afficher sur une centaine de points chacune. Et hors ligne, aucune ne
s'afficherait : le navigateur ne laisse pas l'application garder une image
venue d'un autre site.

Le serveur fabrique donc des **miniatures**. À la première demande, il
télécharge l'image une fois, la réduit pour couvrir 360 × 480 pixels — trois
pixels physiques par point sur la grille d'un téléphone —, la convertit en WebP
et la garde dans `data/thumbs/`. Sur une collection de 240 jeux, les jaquettes
passent de 30 Mo à 6 Mo, de 160 Ko à 32 Ko en moyenne, et surtout d'images de
1600 pixels à décoder à des images à la taille de l'écran.

- La grille, la liste, la frise, le bilan et le scan affichent la miniature ;
  la fiche d'un jeu garde l'image d'origine, en grand.
- Le service worker garde les miniatures de **toute** la collection, pas
  seulement celles qui ont défilé à l'écran : en magasin, le jeu scanné
  retrouve sa jaquette. Cela suppose le certificat installé (voir
  [En magasin, sans réseau](#en-magasin-sans-réseau)).
- Si une miniature ne peut pas être fabriquée, l'interface affiche l'image
  d'origine, comme avant ; et si l'image d'origine est hors de portée, la fiche
  se rabat sur la miniature. Certains hébergeurs refusent les téléchargements
  qui ne viennent pas d'un navigateur — c'est le cas de gamecash.fr : leurs
  jaquettes restent en taille d'origine, et ne s'affichent pas hors ligne.
  L'échec est noté dans le journal du service, et n'est retenté qu'au bout
  d'une demi-heure.
- Les miniatures qu'aucune fiche n'utilise plus sont supprimées avec les
  jaquettes orphelines, une fois par heure. Le dossier peut être vidé sans
  risque : il se reconstitue à la demande.

**Garde-fous.** Faire télécharger une adresse au serveur, c'est lui prêter sa
place sur le réseau local. La route ne télécharge donc que des images déjà
utilisées par une fiche ; elle refuse les adresses du réseau local, de la
machine elle-même et les plages réservées — vérifiées à chaque redirection, et
au moment même de la connexion ; elle abandonne au-delà de 10 secondes ou de
8 Mo ; elle vérifie que le contenu est une image d'après ses premiers octets,
et non d'après le type annoncé ; et elle plafonne ses dimensions avant de la
décoder.

**Dépendance.** La réduction passe par [sharp](https://sharp.pixelplumbing.com/),
dont les binaires sont précompilés pour Windows, macOS et Linux (x64 et ARM) :
`npm install` suffit, sans Visual Studio ni outils de compilation. Sur une
plateforme qu'elle ne couvre pas, le serveur démarre quand même, le signale
dans son journal, et la grille affiche les images d'origine.

---

## Identifier un jeu avec Claude

Devant un jeu qui n'est pas encore dans la collection, le plus long est de
retrouver son titre exact, sa plateforme, sa région et son serial. Avec une clé
Anthropic dans `.env` (`ANTHROPIC_API_KEY`), Claude s'en charge.

**Le geste.** Une photo du jeu suffit — face avant, dos, tranche, disque ou
cartouche : Claude lit ce qu'elle montre. Trois entrées :

- dans **Ajouter**, en haut du formulaire : **Photographier le jeu** ouvre
  l'appareil photo, et l'identification part dès la photo prise ;
- dans le scanner, quand une photo ne porte pas de code-barres :
  **Reconnaître le jeu avec Claude**, qui part aussitôt ;
- dans le scanner, quand la réponse est « pas dans votre collection » :
  **Identifier avec Claude**, avec la photo et le code qui viennent d'être lus.
  La fenêtre propose alors d'ajouter le serial avant de lancer.

**Avec ou sans code-barres.** Photographier le dos donne le plus de chances :
le code-barres, lu sur le téléphone, désigne une édition précise — région,
réédition Platinum ou Player's Choice —, et le titre, la plateforme et la
mention PEGI ou ESRB y figurent aussi. Une face avant suffit à reconnaître le
jeu, mais pas son édition : le verdict s'arrête alors à « Probablement ce
jeu », et l'écran rappelle que l'édition reste à vérifier. Un code-barres
trouvé seulement en ligne n'entre jamais dans la fiche — il peut être celui
d'une autre édition, et le scan répondrait ensuite à côté.

**Ce que fait Claude.** Il lit la photo, cherche le code-barres sur le web
(bases de codes-barres, fiches de vente, sites de collectionneurs) et recoupe
le tout. Il rend ce qu'il a lu sur la photo, la fiche qu'il propose, ses
sources et ses doutes.

**Ce que vérifie le serveur.** La proposition n'est pas prise pour argent
comptant. Le serveur vérifie lui-même :

- la clé de contrôle du code-barres ;
- l'accord entre le code-barres fourni, celui que Claude lit sur la photo et
  celui de la fiche trouvée — de même pour le serial et la région ;
- les sources : seules comptent les pages que la recherche a réellement
  renvoyées. Une adresse citée sans en provenir est écartée.

Le verdict en découle :

| Verdict | Condition |
|---|---|
| **Jeu confirmé** | une source relie ce code-barres à ce titre, et rien ne le contredit |
| **Probablement ce jeu** | rien ne le contredit, mais seul le titre — lu sur la photo, ou confirmé en ligne — l'appuie, sans le code-barres de l'exemplaire |
| **Identification incertaine** | une vérification contredit la fiche, ou aucun indice ne l'appuie |
| **Jeu non identifié** | Claude n'a pas trouvé |

**La validation.** L'écran montre la fiche proposée, chaque vérification
(concordante, contradictoire ou impossible), les doutes, les sources, et le
jeu de la collection qui lui ressemble s'il y en a un. Rien n'est rempli avant
**C'est bien ce jeu** — **Remplir quand même** pour un verdict incertain. Le
formulaire qui suit reste modifiable et s'enregistre à la main.
**Ce n'est pas ce jeu** ramène à la photo : reprenez-la de plus près, ou
ajoutez le serial pour départager deux éditions.

**Ce qui sort de la maison.** La photo (réduite à 2000 pixels), le code-barres,
le serial et la liste des plateformes de la collection partent chez Anthropic.
La photo n'est conservée ni sur le serveur ni dans la collection. Le serveur
doit avoir accès à Internet ; en magasin, sans réseau, le scan fonctionne
comme avant, mais pas l'identification.

**Le coût.** Chaque identification est facturée sur le compte de la clé :
de l'ordre de 10 à 15 centimes selon le nombre de recherches (Claude Opus 5.5,
cinq recherches au plus). Le journal du service note, pour chacune, les jetons
lus et écrits et le nombre de recherches. Un plafond de 40 identifications par
tranche de dix minutes protège d'une boucle qui s'emballerait. Si le modèle
décline une demande, l'API la rejoue d'elle-même sur le modèle de repli
qu'Anthropic recommande.

---

## Discuter avec Claude

Avec la même clé (`ANTHROPIC_API_KEY`), **Discuter avec Claude** ouvre une
conversation : dans le menu **Plus**, par l'icône de bulle dans l'en-tête sur
ordinateur, ou avec la touche `C`. Sans clé, le menu **Plus** l'indique et dit
quoi renseigner.

**Ce que Claude peut faire.** Il ne connaît pas la collection d'avance : il la
consulte avec deux outils, en lecture seule — une recherche (texte,
plateforme, état, pièce manquante, favoris, ISO) et des statistiques
(répartitions, pièces manquantes, doublons, derniers ajouts). Il compte au lieu
de deviner, et chaque jeu qu'il cite est un lien vers sa fiche. Pour les cotes,
les dates de sortie ou les éditions, il cherche sur le web (trois recherches
au plus par étape) et ses sources s'affichent sous la réponse.

**Ce qu'il ne fait pas.** Il ne modifie rien : pour ajouter, corriger ou
supprimer un jeu, il indique le geste dans l'application.

**La conversation.** La réponse s'écrit au fil de l'eau, et **Arrêter** la
coupe ; le serveur oublie alors l'échange interrompu. La conversation affichée
est gardée sur l'appareil. Claude, lui, s'en souvient tant que le service
tourne, douze heures au plus sans message ; après un redémarrage, la question
suivante repart de zéro et la fenêtre le signale. Le crayon en haut commence
une nouvelle conversation.

**Ce qui sort de la maison, et le coût.** Les messages, et ce que les outils
renvoient de la collection pour y répondre, partent chez Anthropic. Chaque
message est facturé sur le compte de la clé : quelques centimes, davantage
pour une longue conversation ou une recherche web. Les consignes et le début
de la conversation sont mis en cache, ce qui en réduit le coût d'un message à
l'autre. Le journal du service note, pour chaque réponse, les jetons lus, dont
ceux servis par le cache, les jetons écrits et le nombre de recherches. Un
plafond de 60 messages par tranche de dix minutes protège d'une boucle qui
s'emballerait.

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
| `ANTHROPIC_API_KEY` | *(vide)* | Active l'[identification](#identifier-un-jeu-avec-claude) et la [discussion](#discuter-avec-claude) avec Claude ([console.anthropic.com](https://console.anthropic.com)) |
| `MAX_UPLOAD_MB` | `5` | Taille maximale d'une image |

> **Aucune authentification** : toute personne ayant accès au réseau local peut
> lire et modifier la collection. C'est le compromis assumé d'une installation
> domestique. N'exposez pas le port sur Internet.
>
> En revanche, une page web ouverte ailleurs dans le navigateur **ne peut pas**
> écrire dans la collection : toute requête de modification venue d'un autre
> site est refusée, et seul le JSON est accepté comme corps de requête. Sans
> cela, un simple formulaire sur une page quelconque aurait suffi à remplacer
> l'inventaire — le navigateur de la maison servant de pont, que le port soit
> exposé ou non.

---

## Importer une collection existante

Bouton **Import / export** dans l'en-tête. Le fichier peut être un CSV
(séparateur `,`, `;` ou tabulation, détecté automatiquement) ou un JSON.

La première ligne du CSV donne les en-têtes. Le format d'un inventaire tenu à
la main est reconnu tel quel :

```csv
Titre,Région,État,Serial,EAN,Complet,ISO,Notes
.hack // INFECTION,PAL,Très bon,SLES52237,3546430109915,Oui,Oui,-
.hack // MUTATION,PAL,Très bon,SLES52467,3546430111451,"CD, Boîte",Oui,-
Call of Duty Le Jour De Gloire,PAL,Acceptable,SLES52783,-,Oui,Oui,-
```

Conversions automatiques :

- **En-têtes** : `titre`, `plateforme`, `région`, `état`, `serial`, `ean`,
  `quantité`, `complet`, `iso`, `favori`, `tags`, `notes` — avec ou sans
  accents, ainsi que leurs synonymes courants (`console`, `zone`,
  `code-barres`, `référence`, `dump`…).
- **État** : `Neuf`, `Très bon`, `Bon`, `Acceptable`, `Mauvais`, et les
  variantes usuelles (`TBE`, `sous blister`, `abîmé`…).
- **Complet** : `Oui`, `Non`, ou la liste de ce qui est présent —
  `CD, Boîte` signifie donc « sans notice ». Les colonnes séparées
  (`boîte`, `notice`, `disque`) restent acceptées et priment sur cette liste.
- **Tiret seul** : `-` vaut case vide, dans n'importe quelle colonne.
- **Séparateur** : virgule, point-virgule ou tabulation, détecté tout seul.

> La jaquette n'est comptée comme manquante que si le fichier la nomme
> explicitement. La plupart des inventaires ne la distinguent pas de la boîte,
> et la déclarer absente partout fausserait la collection.

Deux réglages complètent l'import :

- **Plateforme par défaut** — pour un fichier ne couvrant qu'une console, qui
  n'a donc pas de colonne « plateforme ».
- **Mode** : *Ajouter* (les doublons titre + plateforme sont ignorés) ou
  *Remplacer* (la collection est effacée avant l'import).

Les lignes invalides sont signalées, l'import se poursuit pour les autres.

L'**export CSV** reprend exactement ces colonnes : un aller-retour
export → import restitue la collection à l'identique.

---

## Sauvegardes

Les données tiennent dans `data/` : la base `gameshelf.db`, le dossier
`uploads/`, le certificat `tls/` et les sauvegardes `backups/`. Le dossier
`thumbs/` n'est qu'un cache de miniatures, inutile à sauvegarder.

Un import en mode **Remplacer** prend de lui-même une copie de la base juste
avant d'effacer quoi que ce soit : elle est écrite dans `data/backups/` sous
le nom `avant-import-<date>.db`, et les cinq dernières sont conservées.

Depuis l'interface, **Import / export → Sauvegarde .db** télécharge une copie
cohérente de la base sans arrêter le service.

En ligne de commande :

```bash
node scripts/backup.js                 # écrit dans data/backups, garde les 14 dernières
docker compose exec gameshelf node scripts/backup.js
```

Sauvegarde quotidienne par cron :

```cron
0 3 * * * cd /opt/gameshelf && /usr/bin/node scripts/backup.js >> /var/log/gameshelf-backup.log 2>&1
```

> Une simple copie de `gameshelf.db` pendant que le service tourne peut être
> incohérente (mode WAL). Utilisez toujours le script ou le bouton dédié.

Le journal d'écriture est fusionné dans `gameshelf.db` après chaque
modification : le fichier principal porte donc la collection complète, et non
un état figé au dernier regroupement. Les jaquettes devenues orphelines —
fiche supprimée, visuel remplacé, téléversement interrompu — sont retirées
automatiquement une fois par heure.

---

## Vérifier une installation

```bash
npm test
```

Démarre une instance isolée sur un port libre, avec une base neuve dans un
dossier temporaire, y déroule le test de bout en bout, puis nettoie : la
collection n'est jamais touchée.

Pour tester une instance déjà en service — le serveur, par exemple :

```bash
./scripts/smoke-test.sh https://localhost:3000
```

Le script teste l'ensemble des routes (lecture, création, modification, scan
par code-barres, filtre des incomplets, validation des entrées, import, export,
sauvegarde, pages statiques, refus des écritures venues d'un autre site,
vérification du contenu des images, fabrication des miniatures et refus des
adresses locales) et supprime les données de test qu'il a créées.

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
| `GET` | `/thumbs?src=` | Miniature WebP d'une jaquette utilisée par une fiche |
| `GET` | `/api/external/search?q=` | Recherche RAWG (si clé configurée) |
| `POST` | `/api/identify` | Identification par Claude (`multipart` : `photo`, `ean`, `ean_source`, `serial`) — propose, n'enregistre rien |
| `POST` | `/api/chat` | Discussion avec Claude (`{conversation, message}`) — réponse en flux `text/event-stream` : `conversation`, `text`, `activity`, `sources`, puis `done` ou `error` |

Paramètres de `GET /api/games` : `search`, `ean`, `serial`, `platform`,
`region`, `condition`, `tag`, `favorite=1`, `incomplete=1`, `iso=0|1`,
`sort`, `dir`, `page`, `limit` (`limit=all` renvoie toute la collection).

`POST /api/import` accepte `{content, format, mode, defaultPlatform}`.

---

## Structure du dépôt

```
src/            serveur Express, accès SQLite, routes
  config.js     lecture de la configuration et du .env
  db.js         schéma, migrations, fusion du journal
  tls.js        certificat local auto-signé
  games.js      validation et requêtes sur les jeux
  csv.js        lecture / écriture CSV
  images.js     reconnaissance du type réel d'une image
  limite.js     plafonds de débit par adresse
  uploads.js    entretien des jaquettes orphelines
  miniatures.js miniatures des jaquettes : téléchargement sûr, réduction, cache
  identification.js  identification par Claude et vérification de la proposition
  discussion.js discussion avec Claude : outils de lecture de la collection, réponse en flux
  routes/       jeux, import-export, recherche externe, identification, discussion
public/         interface (HTML, CSS, JS natif — aucun build)
  js/data.js    la collection en mémoire : recherche, filtres, tri, copie locale
  js/views.js   jaquettes, étagère, liste, frise, panneau de filtres
  js/platforms.js  couleurs et dimensions des boîtiers par plateforme
  js/detail.js, editor.js, scanner.js, identify.js, chat.js, stats.js, menu.js  les fenêtres
  sw.js         service worker : ouverture hors ligne
deploy/         install.sh, update.sh, unité systemd
scripts/        sauvegarde, test de bout en bout, smoke-test
```

```bash
npm run lint    # analyse statique (ESLint, seule dépendance de développement)
npm test        # instance isolée + test de bout en bout
```

Le schéma évolue par migrations incrémentales (`PRAGMA user_version` dans
`src/db.js`) : ajoutez une fonction à la fin du tableau, ne modifiez jamais les
précédentes.

---

## Licence

MIT
