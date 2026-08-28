# MaxFinder

Recherche des trains TGV INOUI et INTERCITÉS ouverts aux abonnements **MAX JEUNE** et
**MAX SENIOR**, correspondances comprises, avec **alertes push quand une place se libère**.

Entièrement hébergé sur **GitHub Pages** : pas de serveur, pas de base de données, pas de coût.
GitHub Actions tient le rôle du backend.

---

## Comment ça marche

```
GitHub Actions (4×/jour)
  1. GET métadonnées Opendatasoft → champ `modified`
     inchangé et pas de push de code ? → stop, coût quasi nul
  2. GET export JSONL filtré `od_happy_card="OUI"`   (~5 Mo au lieu de 36)
  3. build → public/data/{index,stations,trips}.json
  4. évalue watches.yml, compare à state/sync-state.json
  5. nouvelles places → notification ntfy
  6. vite build → upload-pages-artifact → deploy-pages
  7. commit de state/sync-state.json

Navigateur
  index.json + stations.json au démarrage   (~5 Ko gzip)
  trips.json à la première recherche        (~410 Ko gzip, mis en cache)
  puis recherche et correspondances 100 % locales, instantanées
```

Le choix structurant : sur les 396 000 lignes du dataset, seules **61 610 correspondent à une
place réellement ouverte**. Tout le jeu utile tient donc dans le site statique, ce qui supprime
serveur, quotas d'API et latence — et permet le calendrier de disponibilité sur 31 jours.

`public/data/` n'est **pas** versionné : il est publié comme artefact Pages, ce qui garde
l'historique git propre. Seul `state/sync-state.json`, quelques kilooctets, est commité.

---

## Mise en service

### 1. Créer le dépôt

Dépôt **public** de préférence : minutes Actions illimitées et Pages inclus dans l'offre gratuite.
Les données SNCF sont déjà ouvertes (ODbL). La seule information personnelle est le contenu de
`watches.yml`, qui révèle vos trajets surveillés.

```bash
git add -A && git commit -m "MaxFinder"
git remote add origin git@github.com:<vous>/<repo>.git
git push -u origin main
```

### 2. Activer Pages

`Settings → Pages → Build and deployment → Source : GitHub Actions`.

Aucun réglage de branche : le workflow publie directement l'artefact.

### 3. Configurer les notifications ntfy

1. Installez l'application **ntfy** ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) /
   [iOS](https://apps.apple.com/us/app/ntfy/id1625396347)).
2. Choisissez un nom de topic **long et imprévisible**, par exemple `maxfinder-a7f3c19b4e`.
3. Abonnez-vous à ce topic dans l'application.
4. `Settings → Secrets and variables → Actions → New repository secret` :
   `NTFY_TOPIC` = votre topic.

> **Le topic doit rester un secret.** Sur ntfy.sh, quiconque connaît le nom d'un topic peut en lire
> les messages et y publier. C'est pourquoi il vit dans un secret de dépôt et non dans
> `watches.yml`, qui est public.

Secrets facultatifs : `NTFY_SERVER` (instance auto-hébergée), `NTFY_TOKEN` (topic protégé).
Variable facultative : `SITE_URL`, pour rendre les notifications cliquables vers votre site.

### 4. Déclarer vos alertes

Éditez `watches.yml`. L'interface web sait générer le bloc à coller : cliquez sur
**« M'alerter quand un train se libère »** après une recherche.

```yaml
watches:
  - name: "Paris vers Bordeaux, vendredi soir"
    from: ["PARIS (intramuros)"]
    to: ["BORDEAUX ST JEAN"]
    dates:
      relative_days: [0, 31]   # fenêtre glissante, jamais à re-régler
      weekdays: [fri]
    depart_between: ["16:00", "21:30"]
    max_changes: 1
    enabled: true
```

#### Surveiller une date précise

Remplacez `relative_days` par des bornes absolues. Pour un seul jour, mettez la même date des
deux côtés :

```yaml
  - name: "Toulouse vers Paris le 24 octobre"
    from: ["TOULOUSE MATABIAU"]
    to: ["PARIS (intramuros)"]
    dates:
      from: "2026-10-24"
      to: "2026-10-24"
    depart_between: ["15:00", "21:00"]
    max_changes: 1
    priority: 5
    enabled: true
```

La SNCF ne publiant que **31 jours glissants**, une date plus lointaine n'est pas encore
consultable : la règle ne surveille rien *pour l'instant* et s'activera d'elle-même quand la
fenêtre l'atteindra. `watches:preview` le dit explicitement au lieu de crier à l'erreur :

```
EN ATTENTE la SNCF n a pas encore publie le 2026-10-24.
           Cette regle s activera d elle-meme vers le 2026-09-24 (dans 28 jours).
           Rien a corriger : laissez-la en place.
```

Une fois la date passée, la règle s'éteint seule — et l'outil vous invite alors à la supprimer.

Vérifiez avant de pousser :

```bash
npm run doctor            # diagnostic complet de la chaîne d'alerte
npm run watches:check     # syntaxe et schéma seulement
npm run watches:preview   # ce que chaque règle enverrait, sur les données locales
```

### « Je ne reçois rien »

```bash
NTFY_TOPIC="votre-topic" npm run doctor
```

`doctor` publie un message **puis le relit sur le serveur** : c'est la relecture qui prouve
l'acheminement, un POST accepté ne dit rien de ce qui a réellement été enregistré. Il vérifie
ensuite la validité de `watches.yml`, le nombre de règles actives, et ce que chacune
déclencherait.

Les deux causes les plus fréquentes ne sont pas des pannes :

| Symptôme | Cause |
| --- | --- |
| Le run est vert, rien n'est parti | Aucune règle `enabled: true`, ou dataset inchangé donc arrêt immédiat |
| `doctor` est tout vert, le téléphone reste muet | Le secret dit *où publier*, il ne vous **abonne** à rien |
| Une règle surveille 0 trajet | Normal : l'alerte existe pour vous prévenir quand cela changera |
| ntfy répond `404 page not found` | Nom de topic invalide, pas un topic manquant |

**Le topic est sensible à la casse** (vérifié sur ntfy.sh : `MonTopic` et `montopic` sont deux
sujets distincts). Il ne doit contenir que des lettres, chiffres, `-` et `_` — ni point, ni
espace, ni accent, sous peine d'un `404` peu explicite. Le **nom d'affichage** que propose
l'application ntfy est purement local et cosmétique : seule l'URL compte.

Pour forcer une exécution complète : `Actions → Run workflow`, cocher **`force`**. Sans cette
case, un dataset inchangé fait sortir le job immédiatement — c'est voulu, et cela ressemble à une
panne. Cocher **`notify_test`** n'envoie qu'un message de contrôle.

`watches:preview` répond à la vraie question — « cette règle va-t-elle déclencher, et sur
quoi ? ». Il liste les dates surveillées, les trajets qui correspondent déjà, et signale les
gares introuvables ou une règle qui ne pourrait jamais déclencher.

> **Le secret `NTFY_TOPIC` ne vous abonne à rien.** Il indique seulement au workflow *où*
> publier. Sans abonnement au même topic dans l'application ntfy, le message part dans le vide.

### 5. Premier run

`Actions → Synchronisation et alertes → Run workflow`, avec `force` coché.
Pour tester seulement la chaîne de notification, cochez `notify_test` à la place.

---

## Développement local

```bash
npm install
npm run sync:local     # télécharge les données dans public/data/ (sans notifier)
npm run dev            # http://localhost:5173

npm test               # 72 tests, dont un rendu complet de l'interface
npm run typecheck
```

Interroger les données sans navigateur — pratique pour comparer avec SNCF Connect :

```bash
npx tsx scripts/query.ts PARIS "BORDEAUX ST JEAN" --date 2026-09-03
npx tsx scripts/query.ts NANCY BORDEAUX --changes 1
npx tsx scripts/query.ts LYON MARSEILLE --after 17:00 --before 21:00 --limit 10
```

---

## Ce que la forme du dataset impose

Quatre particularités des données, chacune traitée et couverte par des tests.

**Une ville n'est pas une gare.** `PARIS (intramuros)` recouvre **six gares physiques**
(FRPMO, FRPLY, FRPNO, FRPST, FRPAZ, FRPBE), `LYON (intramuros)` deux, `LILLE (intramuros)` deux —
au total **29 % des trajets**. Le code distingue donc la `Station` (gare physique, nœud du graphe,
identifiée par son code IATA) de la `Place` (ville sélectionnable, qui regroupe les gares
homonymes). Chercher « Paris » interroge bien les six gares, et une correspondance peut *traverser*
Paris : arriver Gare de l'Est, repartir de Montparnasse, au prix du temps de transfert urbain.
Confondre les deux niveaux rendait invisibles la plupart des trains parisiens.

Le dataset ne publiant aucun nom pour ces gares, l'interface affiche le code (`[FRPMO]`) plutôt que
d'inventer un libellé.

**Tous les segments sont déjà là.** Pour un même train, le dataset liste chaque paire
origine-destination, segments intermédiaires inclus. Une recherche directe est donc un simple
filtre : il n'y a aucun itinéraire à reconstruire.

**Certaines arrivées sont le lendemain.** `heure_arrivee` peut être *antérieure* à `heure_depart`.
La normalisation ajoute une journée, et les correspondances ne franchissent jamais minuit — la
suite du voyage se trouverait dans le fichier du lendemain, absent du graphe du jour.

**La fenêtre glisse sur 31 jours.** Les dates passées disparaissent. Les alertes calées sur des
dates absolues s'éteignent donc d'elles-mêmes : préférez `relative_days`. Les clés périmées sont
purgées de l'état à chaque run.

---

## Pourquoi l'app ne réserve pas à votre place

Il n'existe **aucune API publique de réservation** : l'[API SNCF](https://numerique.sncf.com/startup/api/)
couvre la recherche d'itinéraires et l'open data, et la vente ne passe que par des accords B2B
revendeurs — qui ne peuvent de toute façon pas poser un billet MAX, lié à un compte personnel.

Réserver automatiquement supposerait donc de piloter SNCF Connect avec un navigateur headless et
vos identifiants. Trois raisons de ne pas le faire, indépendamment de l'envie :

- **Vos identifiants vivraient dans les secrets d'un dépôt public**, injectés dans un job qui
  exécute une centaine de paquets npm. Une seule dépendance transitive compromise exfiltre le
  login SNCF *et* la carte enregistrée sur le compte.
- **Les CGU de SNCF Connect interdisent l'accès automatisé**, et le site est protégé contre les
  robots. Le risque encouru est la suspension du compte, donc la perte de l'abonnement MAX —
  incomparablement plus coûteuse que le confort gagné.
- **Un robot de réservation qui échoue en silence est pire que pas de robot** : on se croit
  réservé, on ne l'est pas, et on le découvre en gare.

Le parti retenu est donc de rendre la réservation manuelle *quasi instantanée* : la notification
porte deux boutons, « Voir le trajet » qui ouvre le site sur la recherche exacte (bonnes gares,
bonne date) et « Réserver » vers SNCF Connect. Deux touches depuis le téléphone, sans rien
resaisir.

`SITE_URL` est déduit automatiquement de l'URL Pages du dépôt ; définissez la variable de dépôt du
même nom seulement pour un domaine personnalisé.

## Points d'exploitation

**Les workflows planifiés sont désactivés après 60 jours d'inactivité** sur un dépôt public
([documentation GitHub](https://docs.github.com/actions/managing-workflow-runs/disabling-and-enabling-a-workflow)).
Le commit quotidien de `state/` vise à l'éviter. GitHub prévient par courriel avant de désactiver,
et la réactivation se fait en un clic depuis l'onglet Actions — surveillez ce courriel plutôt que
de considérer le problème comme définitivement réglé.

**L'état des alertes est enregistré avant le déploiement**, pas après. Si une étape ultérieure
échoue, GitHub saute les suivantes : enregistrer l'état en fin de job signifierait ne jamais le
persister, donc réémettre les mêmes alertes à chaque run. Contrepartie assumée : un échec de
déploiement laisse le site en retard jusqu'à la publication SNCF suivante, ou jusqu'à un run
manuel avec `force`.

**MaxFinder n'est pas un horaire, c'est une carte des places MAX ouvertes.** Le dataset ne
contient que les trains ouverts à la réservation MAX (`od_happy_card = OUI`) — 63 000 lignes sur
394 000. Sur Toulouse → Paris le 30 août, 11 trains circulent et **aucun** n'a de place MAX : SNCF
Connect en montre donc 11, MaxFinder aucun. Ce n'est pas une lacune, c'est l'objet de l'outil.
L'interface le dit maintenant explicitement, une liste vide passant sinon pour une panne.

**Le dataset est un instantané quotidien, SNCF Connect est en direct.** Une place libérée à 10 h
apparaît immédiatement sur SNCF Connect et seulement le lendemain matin ici. C'est la limite dure
de cette source : aucun travail applicatif ne la contourne.

**Une place affichée peut déjà être partie.** Le dataset est un instantané publié une fois par
matin ; seule la réservation fait foi.

**Les horaires sont des heures locales françaises**, pas des instants. Le code ne leur applique
jamais de conversion de fuseau ; seul le cron est en UTC.

**Ce site n'est ni édité ni approuvé par la SNCF.** Données SNCF Voyageurs, dataset
[`tgvmax`](https://ressources.data.sncf.com/explore/dataset/tgvmax/), licence ODbL.

---

## Organisation du code

| Chemin | Rôle |
| --- | --- |
| `shared/` | Logique partagée entre le navigateur et le job d'alertes |
| `shared/places.ts` | Modèle à deux niveaux ville / gare physique |
| `shared/search.ts` | Moteur d'itinéraires, jusqu'à deux correspondances |
| `shared/watch.ts` | Évaluation d'une règle de surveillance |
| `scripts/ods.ts` | Client Opendatasoft, export JSONL en flux |
| `scripts/build-data.ts` | Construction des fichiers statiques |
| `scripts/sync.ts` | Orchestrateur appelé par GitHub Actions |
| `scripts/query.ts` | CLI d'interrogation locale |
| `scripts/watch-preview.ts` | Prévisualisation des alertes sans rien envoyer |
| `scripts/doctor.ts` | Diagnostic de la chaîne d'alerte, avec preuve de livraison |
| `src/` | Interface React |

`shared/watch.ts` est délibérément commun aux deux mondes : la même fonction décide ce qu'une
alerte signale et ce que le site affiche, ce qui interdit toute divergence entre les deux.

Le build vérifie les données contre une requête d'agrégation indépendante de l'API et signale tout
écart de comptage par date.

## Pistes d'extension

- **« Toutes les destinations depuis une gare »** : quasi gratuit, les données sont déjà côté
  client.
- **Lignes indisponibles** pour afficher « ce train existe mais est complet » : environ +1 Mo
  gzippé, à charger dans un fichier séparé.
- **Noms réels des gares parisiennes et lyonnaises** : demande un référentiel externe reliant les
  codes IATA aux libellés.
- **Carte de France** : le dataset n'a ni latitude ni longitude, il faut construire un référentiel
  de coordonnées pour les 254 gares.
