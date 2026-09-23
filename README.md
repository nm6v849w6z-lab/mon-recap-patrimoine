# Mon récap patrimoine (Caisse d'Épargne perso + pro + Trade Republic)

Petite appli perso, auto-hébergée et installable comme une appli sur ton téléphone (PWA),
qui agrège tes comptes via [Powens](https://www.powens.com) (ex-Budget Insight) :
Caisse d'Épargne (compte perso), Caisse d'Épargne (compte pro) et Trade Republic.

C'est un MVP volontairement simple : un backend Node/Express, une base SQLite locale,
et un front HTML/JS sans build. Rien ne part ailleurs que sur ta machine et vers l'API Powens.

## 1. Créer un compte Powens développeur

1. Va sur https://console.powens.com et crée un compte.
2. Crée un **domaine** (en sandbox pour commencer — gratuit, données de test, mais tu peux
   aussi tester avec tes vrais comptes selon l'offre proposée à la création).
3. Dans ce domaine, crée une **application cliente** (Client application). Tu obtiens :
   - un `client_id`
   - un `client_secret`
4. Dans les paramètres de cette application, ajoute l'URL de callback :
   `https://localhost:3000/callback`
   (elle doit correspondre EXACTEMENT à celle utilisée par l'appli).
5. Note le nom de domaine Powens (ex : `tonapp-sandbox` si ton domaine complet est
   `tonapp-sandbox.biapi.pro`).

> Powens propose une offre gratuite/sandbox pour les projets perso à faible volume, mais les
> conditions évoluent — vérifie les tarifs actuels dans la console avant de brancher tes vrais
> comptes bancaires en production.

## 2. Configurer le projet

```bash
cp .env.example .env
```

Remplis `.env` avec :

```
POWENS_DOMAIN=tonapp-sandbox
POWENS_CLIENT_ID=xxxxx
POWENS_CLIENT_SECRET=xxxxx
POWENS_REDIRECT_URI=https://localhost:3000/callback
PORT=3000
```

## 3. Installer et lancer

```bash
npm install
npm start
```

Le serveur tourne en **HTTPS** avec un certificat auto-généré localement (voir section
sécurité plus bas). Ouvre **https://localhost:3000** — ton navigateur va afficher un
avertissement "connexion non privée / non sécurisée" : c'est normal pour un certificat
auto-signé (non reconnu par une autorité publique), pas un signe de problème. Clique sur
"Avancé" puis "Continuer vers localhost" pour l'accepter.

**Chaque personne a son propre compte (identifiant + mot de passe) sur ce même
déploiement** — l'appli est maintenant multi-utilisateur : toutes les données
(comptes, transactions, biens, crédits...) sont cloisonnées par compte, personne ne
voit les données de quelqu'un d'autre même sur un service Render partagé.

### Créer un compte / se connecter

Au premier accès, l'appli affiche un écran de connexion avec un lien "Pas encore de
compte ? Crée-en un." Chaque personne choisit son propre identifiant et mot de passe
(8 caractères minimum) — ce mot de passe chiffre son propre token Powens, exactement
comme le faisait le PIN dans les versions précédentes.

Si la variable d'environnement `SIGNUP_CODE` est définie (recommandé une fois déployé
publiquement sur Render, pour éviter que n'importe qui tombant sur l'URL ne puisse créer
un compte et consommer ton quota Powens), un code d'invitation est demandé à
l'inscription.

## 4. Utilisation comme appli sur ton téléphone (test en wifi local)

L'appli est une PWA (Progressive Web App) : pas besoin d'App Store, tu l'installes
directement depuis le navigateur de ton téléphone, tant qu'il est sur le **même
réseau wifi** que l'ordinateur qui fait tourner le serveur.

1. Lance `npm start`. Le terminal affiche une adresse du type :
   ```
   Accessible depuis ton telephone (meme reseau wifi) via :
     -> https://192.168.1.23:3000
   ```
2. **Important — avant de relier tes comptes** : si tu comptes te connecter à Powens
   *depuis le téléphone*, remplace `POWENS_REDIRECT_URI` dans `.env` par cette même
   adresse (`https://192.168.1.23:3000/callback`), et ajoute-la aussi dans la liste des
   URLs de callback autorisées de ton client Powens (console). Sinon, après
   authentification bancaire, Powens essaiera de rediriger vers `localhost` sur le
   téléphone, ce qui ne renverra jamais vers ton serveur. Redémarre le serveur après
   avoir changé le `.env`.
   - Ton IP locale peut changer (redémarrage du routeur, etc.) — si la connexion
     casse, vérifie que l'adresse affichée au démarrage correspond toujours à celle
     dans `.env`. Le certificat auto-signé couvre automatiquement les IP locales
     détectées au moment de sa génération ; s'il change, supprime le dossier `certs/`
     pour qu'un nouveau certificat soit régénéré au prochain démarrage.
3. Sur le téléphone, ouvre cette adresse **https://...** dans Chrome (Android) ou
   Safari (iOS). Le navigateur affichera un avertissement de certificat non reconnu
   (normal, certificat auto-signé) — accepte l'exception pour continuer.
4. Entre ton identifiant et ton mot de passe pour te connecter.
5. **Installer sur l'écran d'accueil** :
   - Android/Chrome : menu ⋮ → "Ajouter à l'écran d'accueil" (ou bannière d'install automatique).
   - iOS/Safari : bouton Partager → "Sur l'écran d'accueil".
6. L'icône "Grand livre" apparaît sur ton téléphone et s'ouvre en plein écran, sans
   barre d'adresse, comme une vraie appli — connexion protégée par mot de passe.

## 5. Relier tes comptes

Au premier lancement, l'appli n'a encore aucun compte : clique sur **"Relier un compte"**.
Tu es redirigé vers le **Webview Powens**, qui gère l'authentification bancaire (tu ne donnes
jamais tes identifiants bancaires à cette appli, uniquement à Powens/ta banque).

Répète l'opération une fois par établissement :

1. **Caisse d'Épargne** — connexion avec tes identifiants du compte perso.
2. **Caisse d'Épargne** — reconnecte-toi avec les identifiants du compte pro. Powens créera
   une deuxième connexion distincte, même si c'est la même banque.
3. **Trade Republic** — recherche "Trade Republic" dans le sélecteur de banques.

Après chaque connexion réussie, l'appli synchronise automatiquement les comptes et transactions.
Tu peux aussi cliquer sur **"Synchroniser"** à tout moment, ou **"Gérer les connexions"** pour
révoquer ou reconnecter un accès.

Comme les deux connexions Caisse d'Épargne portent le même nom au départ, **clique sur le
petit crayon (✎) à côté d'un groupe dans la barre latérale** pour le renommer — par exemple
"Caisse d'Épargne — Perso" et "Caisse d'Épargne — Pro" — pour les distinguer d'un coup d'œil.

## Performance et indicateurs

Chaque synchronisation enregistre un instantané du solde de chaque compte (et du total).
Après quelques jours d'utilisation, tu verras apparaître :
- **Une ligne de performance** (7j / 30j / depuis le début) sous le patrimoine total et
  sous le solde du compte sélectionné.
- **Un panneau "Indicateurs du mois"** sous le grand livre : taux d'épargne, plus grosse
  dépense, dépenses du mois converties en baguettes 🥖 (estimation à 1,20 €), et
  l'autonomie estimée du compte courant au rythme de dépense actuel.

Ces chiffres sont recalculés côté serveur à partir de tes propres transactions — rien
n'est envoyé ailleurs qu'à Powens. Tant qu'il n'y a qu'un seul jour d'historique, les
lignes de performance restent vides (pas assez de recul pour calculer une variation).

## Interface en onglets (Bilan / Transactions / Projection)

Le dashboard est maintenant organisé en trois onglets, avec le patrimoine total et son
graphique toujours visibles en haut :
- **Bilan** (par défaut) : allocation, puis un vrai bilan **Actif / Passif** — Actif
  financier (tes comptes), Actif immobilier & autres biens, et Passif (crédits) côte à
  côte, comme dans un vrai bilan patrimonial.
- **Transactions** : le grand livre du compte sélectionné dans la barre latérale
  (cliquer sur un compte t'y amène automatiquement).
- **Projection** : le projecteur de patrimoine à 5/10/15 ans.

Ajouter un bien ou un crédit se fait via une vraie fenêtre de formulaire (plus de
popups en série) — elle accepte aussi bien `3.2` que `3,2` pour les décimales, et
affiche une erreur claire en cas de saisie invalide plutôt que d'échouer en silence.

### Quand Powens ne fournit aucun détail de position

Certains connecteurs (dont Trade Republic pour certains types de compte) ne renvoient
qu'un solde global sans décomposer les lignes individuelles — c'est le cas typique d'un
PEA "Nasdaq 100" où Powens ne voit qu'un seul bloc de valorisation. Dans ce cas, le
tableau "Positions" affiche un message explicite avec un bouton **"✎ Modifier la zone
géographique du compte entier"** : tu tagues alors tout le compte d'un coup (ex :
`Etats-Unis:100`) plutôt que de ne rien pouvoir faire.

## Corrections de performance (2 bugs trouvés)

1. **Faux 0,00% de "Performance réelle (positions)"** : si Powens/Trade Republic ne
   renvoie tout simplement pas le champ de gain/perte pour une position (au lieu de le
   renvoyer à 0), l'appli le traitait par erreur comme "0% de performance". Corrigé :
   maintenant, absence de donnée = rien affiché, `0` réel = `0%` affiché.
2. **Pourcentages absurdes (+5000% et compagnie) sur "7j / 30j / Depuis le début"** :
   pour un compte tout juste relié, le tout premier point de l'historique peut être
   quasi nul (avant que le vrai solde soit synchronisé), ce qui rend n'importe quelle
   variation mathématiquement correcte mais absurde à lire. L'appli masque maintenant
   ces comparaisons quand le point de référence est trop petit par rapport à la valeur
   actuelle (moins de 5%), plutôt que d'afficher un chiffre trompeur.

## Détail des positions

Dans l'onglet "Transactions", quand tu sélectionnes un compte-titres (PEA, portefeuille
Trade Republic...), un tableau "Positions" apparaît au-dessus des transactions avec
chaque ligne (ETF, action) : quantité, cours, valorisation, et performance réelle.

La répartition géographique se règle **ligne par ligne** directement dans ce tableau
(bouton "✎" à droite de chaque position) plutôt que pour tout le compte d'un coup — un
PEA qui mélange plusieurs ETF avec des expositions différentes (ex. MSCI World + S&P500)
est ainsi ventilé correctement dans le donut géographique de l'onglet Bilan, au lieu
d'une moyenne approximative sur tout le compte.

### Suggestion automatique pour les ETF connus

Pour une quinzaine d'ETF très courants (iShares Core MSCI World, S&P 500, CAC 40,
MSCI Emerging Markets, Vanguard FTSE All-World...), l'appli reconnaît l'ISIN et
**pré-remplit une suggestion** de répartition géographique dans la fenêtre de tag — que
tu peux ajuster avant de valider, rien n'est jamais enregistré sans confirmation.

Pour un ISIN qu'elle ne reconnaît pas, elle te le dit clairement ("ISIN non reconnu
automatiquement") plutôt que de deviner. Tu peux alors renseigner toi-même la
répartition, ou utiliser la zone **"International"** pour un fonds mondial très
diversifié (type MSCI ACWI / FTSE All-World) dont le détail pays par pays n'a pas
vraiment de sens.

Ce catalogue est dans `server/etf-catalog.js` si tu veux y ajouter tes propres ETF.

## Allocation

Trois répartitions sous forme de donuts, en haut du dashboard :
- **Classe d'actif** : Liquidités / Épargne / Actions & titres / Immobilier — déduite
  automatiquement du type de chaque compte Powens et de tes biens ajoutés manuellement.
- **Devise** : déduite de la devise de chaque compte.
- **Zone géographique** : Powens ne fournit pas la composition géographique des
  sous-jacents (ETF, actions...), donc c'est une **saisie manuelle par compte-titres** —
  clique sur le bouton avec le nom du compte (ex. "✎ PEA") sous le donut géographique, et
  entre ta répartition approximative (ex : `Etats-Unis:60, Europe:25, Emergents:15`),
  que tu peux estimer depuis la fiche de composition de ton ETF (MSCI World, etc.).

## Projecteur de patrimoine

Estime ton patrimoine dans 5, 10 et 15 ans à partir de trois hypothèses réglables (en
haut du panneau, sauvegardées automatiquement) :
- **DCA mensuel** : le montant que tu comptes investir chaque mois.
- **Rendement annuel espéré** : appliqué à l'ensemble de tes comptes + versements DCA
  (formule de valeur future à versements constants).
- **Appréciation immobilière** : taux annuel appliqué à la valeur de tes biens.

Les crédits ne sont **pas extrapolés approximativement** : leur capital restant dû à
chaque horizon est calculé avec le vrai échéancier d'amortissement (même moteur que la
section Immobilier & crédits), donc la projection tient compte du jour exact où un prêt
sera soldé.

## Nettoyage automatique des doublons

Si tu relies deux fois le même compte par erreur (ou reconnectes après un souci), chaque
synchronisation supprime désormais localement les connexions/comptes qui n'existent plus
côté Powens. Pour faire disparaître un doublon : va dans "Gérer les connexions", révoque
la connexion en trop côté Powens, puis clique sur "Synchroniser" ici.

## Performance réelle des placements

Pour les comptes-titres (PEA, portefeuille Trade Republic...), l'appli récupère le vrai
gain/perte de tes positions directement depuis Powens (pas une simple variation de solde,
qui mélangerait versements et performance réelle). Ça s'affiche sous le solde du compte,
sous le libellé "Performance réelle (positions)".

## Immobilier et crédits

Section "Immobilier & crédits" en bas du dashboard : ajoute un bien (valeur estimée,
modifiable à tout moment) et un crédit (montant emprunté, taux, durée, date de 1ère
mensualité). Le capital restant dû est **recalculé en direct** à partir de la formule
d'amortissement — pas besoin de le mettre à jour chaque mois, c'est toujours exact au jour
près. Le patrimoine total intègre automatiquement biens + comptes - crédits restants.

## Déploiement en ligne (Render + GitHub), sans installation locale

Pour que quelqu'un utilise l'appli sans rien installer chez lui : on la déploie sur
[Render](https://render.com) (gratuit), avec le code hébergé sur GitHub. Comme Render
n'offre pas de disque persistant gratuit, la base SQLite est répliquée en continu vers
[Backblaze B2](https://www.backblaze.com/cloud-storage) (10 Go gratuits à vie, sans
carte bancaire) via [Litestream](https://litestream.io) — déjà configuré dans le projet
(`Dockerfile`, `litestream.yml`, `entrypoint.sh`).

**Un seul déploiement Render suffit pour plusieurs personnes** — l'appli est
multi-utilisateur (identifiant + mot de passe, voir plus haut), chacun crée son propre
compte sur la même URL. Pense à définir `SIGNUP_CODE` (variable d'environnement Render)
si l'URL est publique, pour que seules les personnes à qui tu l'as donné puissent créer
un compte.

### 1. Mets le code sur GitHub

1. Crée un dépôt GitHub (public ou privé, les deux fonctionnent avec Render gratuit).
2. Pousse le contenu de ce dossier dedans (`git init`, `git add .`, `git commit`,
   `git remote add origin ...`, `git push`). Le `.gitignore` exclut déjà `.env`,
   `data.sqlite` et `certs/` — rien de sensible ne part sur GitHub.

### 2. Crée un compte Backblaze B2 (gratuit, sans CB)

1. Va sur [backblaze.com/cloud-storage](https://www.backblaze.com/cloud-storage),
   crée un compte.
2. Crée un **bucket** privé (ex : `mon-recap-patrimoine-backup`). Note la **région**
   affichée (ex : `us-west-004`) — ton endpoint sera
   `s3.<région>.backblazeb2.com`.
3. Dans "App Keys", crée une nouvelle clé applicative avec accès à ce bucket. Note
   immédiatement le **keyID** et l'**applicationKey** (l'applicationKey ne sera plus
   jamais affichée après).

### 3. Crée le service sur Render

1. Sur [render.com](https://render.com), "New +" → "Web Service", connecte ton dépôt
   GitHub.
2. Render détecte le `Dockerfile` automatiquement (environnement "Docker"). Choisis le
   plan **Free**.
3. Dans l'onglet "Environment" du service, ajoute ces variables :
   ```
   POWENS_DOMAIN=...
   POWENS_CLIENT_ID=...
   POWENS_CLIENT_SECRET=...
   POWENS_REDIRECT_URI=https://<nom-de-ton-service>.onrender.com/callback
   B2_KEY_ID=...
   B2_APPLICATION_KEY=...
   B2_BUCKET=mon-recap-patrimoine-backup
   B2_ENDPOINT=s3.us-west-004.backblazeb2.com
   B2_REGION=us-west-004
   ```
   (adapte le nom du service, la région/endpoint B2, et tes propres identifiants
   Powens — voir section 1 de ce README pour les obtenir).
4. Une fois le service créé, Render te donne son URL réelle
   (`https://ton-service.onrender.com`) — retourne alors dans les paramètres de ton
   application cliente Powens (console) et ajoute exactement cette URL + `/callback`
   comme URL de callback autorisée, et mets à jour `POWENS_REDIRECT_URI` sur Render en
   conséquence si le nom généré diffère de ce que tu avais anticipé.
5. Déploie. Ouvre l'URL Render — HTTPS valide directement, aucun avertissement de
   certificat cette fois (Render gère un vrai certificat, contrairement au local).
6. Crée ton compte, relie tes comptes, comme en local.

### À savoir sur cette configuration

- **Plan gratuit Render = le service s'endort après 15 min d'inactivité** et met
  quelques secondes à se réveiller au prochain accès. Pas grave pour un usage perso,
  juste un temps de chargement un peu plus long de temps en temps.
- **Litestream sauvegarde en continu**, mais restaure seulement au **démarrage** du
  conteneur. Si le service crashe en plein milieu d'une écriture, la toute dernière
  seconde de données pourrait ne pas être sauvegardée — négligeable pour un usage perso,
  à garder en tête si tu veux du zéro-perte strict.
- Le dossier `certs/` et la logique de certificat auto-signé ne servent qu'en local :
  sur Render, `RENDER=true` (variable définie automatiquement par Render) fait basculer
  le serveur en HTTP simple, car c'est Render qui termine le HTTPS en amont.

## Sécurité

Trois couches ont été ajoutées pour protéger l'accès à tes comptes :

1. **Mot de passe à la connexion.** Rien n'est affiché — aucun solde, aucune connexion — tant que
   le mot de passe n'a pas été saisi. Après 5 échecs, l'appli impose un délai croissant avant de
   réessayer.
2. **Chiffrement du token Powens.** Le token qui donne accès à tes comptes n'est jamais
   stocké en clair dans `data.sqlite` : il est chiffré avec AES-256-GCM, avec une clé
   dérivée de ton mot de passe (via `scrypt`). Sans lui, le fichier `data.sqlite` seul ne
   permet à personne de lire tes données Powens.
3. **HTTPS.** Le trafic entre ton téléphone/navigateur et le serveur est chiffré, y
   compris sur le réseau wifi local, via un certificat auto-signé généré au premier
   démarrage (dossier `certs/`, à ne jamais partager).

**Comment ça marche concrètement** : la clé de déchiffrement n'est dérivée qu'en mémoire
(RAM), au moment où tu te connectes — elle n'est jamais écrite sur disque, ni dans le
cookie de session (qui ne contient qu'un identifiant aléatoire opaque). Un redémarrage du
serveur efface la clé : il faut se reconnecter. Une session reste active 4h d'inactivité
avant reverrouillage automatique.

**⚠️ À savoir absolument** : si tu oublies ton mot de passe, **il n'y a aucune récupération
possible** — c'est le prix de ne rien stocker ailleurs qu'en mémoire. La seule solution
est de supprimer `data.sqlite` et de repartir de zéro (reconnexion de tous tes comptes).
Note bien ton mot de passe quelque part de sûr (gestionnaire de mots de passe).

### Limites restantes à connaître

- Le certificat HTTPS est **auto-signé**, pas émis par une autorité reconnue : ton
  navigateur affichera toujours un avertissement à accepter manuellement (normal, mais
  assure-toi que l'IP/nom affiché correspond bien à ta propre machine avant d'accepter).
- **Un seul "utilisateur" Powens** est créé pour toute l'appli (normal pour un usage
  strictement perso).
- **Trade Republic** n'a pas d'API officielle : Powens y accède par un connecteur maison,
  qui peut occasionnellement se désynchroniser (identifiants à revalider via "Gérer les
  connexions").
- La synchro n'est pas automatique/planifiée : on la déclenche à la main ou via le
  callback après connexion. Pour une synchro périodique, ajoute un `cron`/`node-cron` qui
  appelle `POST /api/sync` (protégé par l'authentification — il faudrait alors une session valide en
  arrière-plan), ou branche les
  [webhooks Powens](https://docs.powens.com/documentation/integration-guides/webhooks).
- Pas de catégorisation avancée pour l'instant — les comptes sont regroupés par connexion
  (renommable) dans la barre latérale.

## Pistes d'évolution

- Cron/webhooks pour une synchro automatique.
- Export CSV par compte (utile pour la compta du compte pro).
- Hébergement avec un vrai nom de domaine + certificat HTTPS reconnu (VPS, Raspberry Pi +
  reverse proxy type Caddy, ou Tailscale) pour un accès depuis n'importe où (4G comprise),
  sans avertissement de certificat.

## Structure du projet

```
server/
  server.js       — routes Express (auth identifiant/mot de passe, webview, callback, API du dashboard)
  crypto-auth.js  — derivation de cle depuis le mot de passe, chiffrement AES-256-GCM
  sessions.js     — sessions en memoire (cle de dechiffrement jamais sur disque)
  https-cert.js   — generation/cache du certificat auto-signe local
  powens.js       — client HTTP vers l'API Powens
  db.js           — acces SQLite (comptes, transactions, snapshots, comptes utilisateurs, tokens chiffres)
public/
  index.html, style.css, app.js — appli (sans build, vanilla JS)
certs/            — certificat HTTPS local auto-signe (genere au 1er lancement)
data.sqlite       — base locale (creee au premier lancement)
```
