# Stage Tracker

Application **locale** pour suivre ses candidatures de stage (pensée pour un stage de fin d'études en IA /
data, utilisable pour n'importe quel domaine). Tes données restent sur ton PC, aucune API d'IA payante :
l'app prépare des prompts que tu colles toi-même dans Claude.

- **Aujourd'hui** : prochain entretien avec compte à rebours, tâches du jour, relances, candidatures sans
  nouvelles, objectif d'envois de la semaine, taux de réponse.
- **Candidatures** : Kanban (glisser-déposer) et tableau filtrable, fiche détaillée avec timeline, contacts,
  documents envoyés, analyse de l'offre (compétences surlignées, score).
- **Relances automatiques**, entretiens datés (export / abonnement agenda Apple, Outlook, Google),
  préparation d'entretien avec flashcards, remerciement et relance après chaque entretien.
- **Entreprises cibles** : importe la liste que Claude te prépare, puis « Candidater » en un clic.
- **Lettres** : diff avec ta lettre de base, export DOCX / PDF ; modèles de messages pré-remplis.
- Clair / sombre, utilisable sur téléphone, sauvegardes automatiques, corbeille.

## Installation en une commande

**Windows** : ouvre PowerShell (menu Démarrer → « PowerShell ») et colle :

```powershell
irm https://raw.githubusercontent.com/NathanSignoud/stage-tracker/main/install.ps1 | iex
```

**macOS / Linux** : ouvre un terminal et colle :

```bash
curl -fsSL https://raw.githubusercontent.com/NathanSignoud/stage-tracker/main/install.sh | bash
```

La commande installe l'app dans le dossier `stage-tracker` de ton dossier personnel, puis la lance et ouvre
le navigateur. Si Node.js 22+ manque, elle propose de l'installer (winget sous Windows, Homebrew sur Mac) ;
sinon, installe-le depuis <https://nodejs.org>. **Pour la relancer les fois suivantes, colle la même
commande** : elle met l'app à jour au passage, sans jamais toucher à tes données (`data/`).

`Ctrl+C` dans la fenêtre arrête l'app.

### Installation manuelle

```bash
git clone https://github.com/NathanSignoud/stage-tracker.git
cd stage-tracker
npm install
npm run dev
```

Le module SQLite (`better-sqlite3`) est livré précompilé pour Windows, macOS et Linux : pas besoin
d'outils de compilation.

## Lancement

`npm run dev` (lancé par la commande d'installation) ouvre l'app sur <http://127.0.0.1:3000>. Il :

1. crée le dossier `data/` au premier lancement ;
2. fait une **sauvegarde automatique** de la base (les 10 dernières sont conservées) ;
3. applique les migrations de schéma éventuelles ;
4. ajoute les données de départ au premier lancement (réglages, mots-clés IA/data, modèles de messages) ;
5. démarre l'app, accessible **uniquement depuis ce PC**.

### Depuis ton téléphone

Copie `.env.example` en `.env.local` et choisis un code d'au moins 6 caractères (`APP_PIN=…`).
Le code est demandé une fois par appareil (mémorisé 30 jours).

**`npm run mobile`** (recommandé, partout : Wi-Fi ou 4G, sans droits administrateur)

1. Arrête d'abord `npm run dev` s'il tourne (même port).
2. Lance `npm run mobile` : au premier lancement, `cloudflared` est téléchargé dans `.tools/` (≈ 55 Mo,
   version figée et vérifiée par SHA-256), puis l'app est compilée (≈ 30 s).
3. Une adresse `https://….trycloudflare.com` et un **QR code** s'affichent : scanne-le avec le téléphone.

Le PC ouvre une connexion sortante vers Cloudflare (aucun port à ouvrir). L'app reste sur ton PC, mais elle
est **joignable depuis Internet** pendant que la commande tourne : l'adresse est aléatoire et change à chaque
lancement, le code est obligatoire, et après 5 erreurs l'accès est bloqué (1 min, puis 2, 4… jusqu'à 1 h).
`Ctrl+C` coupe tout. Sur ce PC, ouvre <http://127.0.0.1:3000> (le code est aussi demandé).

**`npm run dev:lan`** (même Wi-Fi uniquement)

Le téléphone accède directement au PC (`http://<IP du PC>:3000`). Nécessite que le pare-feu Windows autorise
Node.js sur les réseaux privés, donc des **droits administrateur** ; trafic non chiffré (HTTP).

> `npm run dev` n'accepte que les requêtes faites depuis ce PC : même un tunnel lancé par erreur ne peut
> pas exposer tes données sans code.

Sur **macOS / Linux**, `npm run mobile` utilise le `cloudflared` installé sur ta machine
(`brew install cloudflared`, ou le paquet de ta distribution) ; le téléchargement automatique ne concerne
que Windows.

### Premiers pas

1. **Réglages → Profil et suivi** : ton nom, ta présentation, tes domaines et compétences (utilisés pour
   signer les messages et remplir les prompts), ton objectif d'envois par semaine.
2. **Réglages → Mots-clés** : ajuste la liste de compétences et coche celles que tu maîtrises.
3. Dépose ton CV et ta lettre « de base » dans `data/base/`, puis **Documents → Importer data/base/**.
4. Ajoute ta première candidature avec **+** (ou la touche `N`).

## Interface

- **Ordinateur** : menu en pilule en haut, menu **⋯** pour Réglages et Corbeille.
- **Téléphone** : onglets en bas (Aujourd'hui, Candidatures, **+** pour ajouter, Calendrier, Plus).
- **Une couleur par sujet**, partout : violet = entretiens, jaune = tâches, vert = envois, pêche = relances et
  dates limites, bleu = chiffres. Toujours accompagnée d'un libellé.
- **Thème** clair ou sombre : suit celui de l'appareil, bouton soleil/lune pour choisir.
- **Aujourd'hui** : prochain entretien (compte à rebours, préparer, ajouter à l'agenda), tâches à cocher,
  candidatures sans nouvelles avec **Relancer**, envois de la semaine, taux de réponse, pipeline cliquable.

## Raccourcis

| Touche | Action |
| --- | --- |
| `N` | Ajout rapide d'une candidature |
| `Ctrl+K` | Recherche globale (candidatures, entreprises, contacts, échanges) et navigation |
| `Tab` (en haut de page) | « Aller au contenu » : saute la navigation |

## Où sont mes données ?

Tout est dans `data/` (exclu de git) :

| Chemin | Contenu |
| --- | --- |
| `data/app.db` | la base SQLite (+ fichiers `-wal`/`-shm` pendant que l'app tourne) |
| `data/documents/` | les fichiers de CV / lettres ajoutés dans l'app |
| `data/base/` | ton CV et ta lettre « de base » (diff des lettres, prompts) |
| `data/backups/` | les sauvegardes JSON |

## Sauvegarder / restaurer

```bash
npm run backup                                        # data/backups/backup-AAAA-MM-JJ_HH-mm-ss.json
npm run restore -- data/backups/<fichier>.json        # remplace toutes les données
```

- Les sauvegardes `auto-…` (au démarrage) sont limitées aux 10 plus récentes ; les `backup-…` (manuelles)
  ne sont jamais supprimées automatiquement.
- `restore` sauvegarde d'abord l'état actuel (`pre-restore-…`) : une restauration n'est jamais destructive.
- Depuis l'app : **Réglages → Sauvegardes** (sauvegarder maintenant, télécharger le JSON).
- Le JSON contient toute la base mais **pas** les fichiers de `data/documents/`. Pour une sauvegarde
  complète (ex. changement de PC), copie le dossier `data/` entier, l'app étant arrêtée.

## Suppression et corbeille

« Supprimer » demande confirmation puis place l'élément dans la **Corbeille**, d'où on peut le restaurer.
La suppression définitive n'est possible que depuis la corbeille, avec une seconde confirmation.

## Entretiens et calendrier

- Étapes : **Test technique** (sans créneau, avant l'appel RH) → **Entretien RH** → **Entretien technique**.
- Quand une candidature passe en **Entretien RH** ou **Entretien technique** (Kanban, fiche), l'app demande la
  date, l'heure, la durée, le lieu ou lien visio. « Date pas encore connue » est possible : le tableau de bord et
  la fiche affichent alors l'entretien dans « Date à fixer » avec un bouton **Fixer la date**.
- Planifier un entretien RH ou technique fait aussi avancer la candidature au statut correspondant (jamais en
  arrière). Le prochain entretien reste affiché sur Aujourd'hui jusqu'à sa fin.
- Kanban très rempli : chaque colonne défile seule ; le bouton **Compact** affiche une ligne par candidature.
- Page **Calendrier** : vue mois (agenda sur téléphone) des entretiens, dates limites et tâches.

### Connecter Apple Calendrier et Outlook

Bouton **Connecter mon agenda** (page Calendrier) :

| Agenda | Méthode | Mise à jour |
| --- | --- | --- |
| Outlook Windows (classique) sur ce PC | Abonnement à l'URL `http://127.0.0.1:3000/api/calendar/feed/<clé>.ics` | automatique, tant que l'app tourne |
| iPhone (Apple Calendrier) | `npm run dev:lan`, puis abonnement à l'URL `webcal://<IP du PC>:3000/…` | quand l'iPhone est sur le même Wi-Fi et que l'app tourne |
| Outlook web / nouvel Outlook / Google Agenda | Import du fichier `.ics` (bouton « .ics ») ou bouton **Agenda** de chaque entretien | à refaire après un changement |

Les services en ligne (Outlook web, iCloud, Google) lisent les abonnements depuis leurs serveurs, qui ne
peuvent pas joindre ton PC : pour eux, utilise l'import. Chaque entretien exporté contient deux rappels
(la veille et 1 h avant). L'URL d'abonnement contient une clé secrète, régénérable depuis le même dialogue.

## Entreprises cibles

Page **Entreprises** : ta liste d'entreprises repérées avant de trouver une offre (site carrière, localisation,
secteur, notes, statut À explorer / Intéressante / Écartée).

1. **Importer une liste → Copier le prompt de recherche** : Claude reçoit ton profil, la liste des entreprises
   que tu as déjà (pour ne pas les répéter) et le format attendu.
2. Colle sa réponse : tableau Markdown, CSV, copie depuis Excel / Sheets, JSON ou liste à puces — les colonnes
   (« Entreprise », « Site carrière », « Ville », « Company », « Careers »…) sont reconnues automatiquement.
3. Vérifie l'aperçu (nouvelles / déjà connues, doublons fusionnés), décoche si besoin, importe.

Une entreprise déjà présente n'est jamais dupliquée : seuls ses champs vides sont complétés. Option : créer
d'office une candidature « À explorer » par entreprise. Sinon, bouton **Candidater** quand tu trouves une
offre (candidature pré-remplie avec la page carrière, le lieu et tes notes). Les candidatures et contacts sont
rapprochés par le nom de l'entreprise.

## Gagner du temps

| Outil | Où | Ce qu'il fait |
| --- | --- | --- |
| **Analyse de l'offre** | fiche candidature | Colle (ou importe) le texte de l'offre : les compétences de ta liste sont surlignées (✓ maîtrisée, ◌ à travailler) et un score est calculé (maîtrisées / détectées). Ta liste et ce que tu maîtrises : **Réglages → Mots-clés**. |
| **Remplir depuis le lien** | ajout rapide, formulaire | Lit la page de l'offre (données `JobPosting` des sites carrière, sinon le contenu principal) et pré-remplit poste, entreprise, lieu, date limite et texte. Respecte `robots.txt` ; LinkedIn est refusé (copie-colle le texte). |
| **Prompt pour Claude** | fiche, lettre, préparation | Lettre, relance, remerciement, message LinkedIn, préparation d'entretien : prompt rempli avec l'offre, ton profil, ta lettre et ton CV de base, à relire puis « Copier et ouvrir Claude ». Aucune API payante. |
| **Messages** | fiche, tâches de relance / remerciement | Modèles pré-remplis (`{entreprise}`, `{poste}`, `{contact}`…), copie ou brouillon dans ta messagerie ; « Marquer comme envoyé » l'ajoute à la timeline et coche la tâche. |
| **Lettre** | fiche → Lettre | Colle ta lettre finale : diff avec ta lettre de base, versions numérotées liées à la candidature, export **DOCX** et **PDF**. |
| **Préparer l'entretien** | fiche, carte « Prochain entretien » | Notes sur l'entreprise, questions qu'on va te poser (avec tes réponses), questions à poser, **flashcards** (Espace = réponse, 1/2/3 = à revoir / bien / parfait). |

Les textes des prompts et des messages se modifient dans **Réglages → Gabarits**. Ton nom, tes
coordonnées et ta présentation (utilisés pour signer et dans les prompts) : **Réglages → Profil**.

### CV et lettre « de base »

Dépose-les dans `data/base/` (DOCX, PDF, Markdown ou texte, avec « CV » ou « lettre » dans le nom), puis
**Documents → Importer data/base/** : le texte est extrait automatiquement. Ou ajoute une version dans
Documents et clique sur ★ pour la définir comme base.

## Après un entretien

Pour chaque entretien planifié : une tâche **« Envoyer un remerciement »** le lendemain et une **relance
à J+7** (annulée dès que la candidature bouge ou qu'un nouvel entretien est planifié). Les deux ont un bouton
**Rédiger** qui ouvre le bon modèle de message. Réglable dans **Réglages → Profil et suivi**.

## Sur l'écran d'accueil du téléphone

Dans Safari, **Partager → Sur l'écran d'accueil** : l'app s'ouvre en plein écran avec son icône. Avec
`npm run mobile`, l'adresse change à chaque lancement : l'icône ne fonctionne que tant que l'adresse ne
change pas (il faudra la recréer après un relancement, ou passer à une adresse fixe).

## Relances automatiques

- Passage en **Envoyée** : la date d'envoi est renseignée (si vide) et une tâche « Relancer … » est créée
  à date d'envoi + 10 jours.
- Passage en **Relancée** (ou bouton « Relancé » sur le tableau de bord) : la relance est cochée et une
  2e relance est planifiée à + 7 jours.
- Passage en entretien, offre ou statut final : les relances en attente sont annulées.
- Délais modifiables dans **Réglages** (0 = désactivé).

## Développement

```bash
npm test             # tests (Vitest) de la logique critique
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run db:generate  # après une modification de src/db/schema.ts
```

Architecture : Next.js (App Router) + SQLite (Drizzle). `src/server/services/` contient la logique d'accès à la
base (fonctions synchrones, testées), `src/server/actions/` les actions appelées par l'interface (validation zod),
`src/lib/domain/` la logique pure (statuts, relances, matching, import d'entreprises), `src/app/` les pages.
Après une modification de `src/db/schema.ts` : `npm run db:generate` (la migration s'applique au démarrage).
