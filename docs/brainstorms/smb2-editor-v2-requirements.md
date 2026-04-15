# SMB2 Editor v2 — Requirements

**Date:** 2026-04-15
**Statut:** Draft pour planning
**Auteur:** Yael (brainstorm assisté)

## 1. Contexte et motivation

Les éditeurs de niveaux pour Super Mario Bros. 2 (NES) disponibles aujourd'hui sont tous
des applications Windows natives abandonnées depuis 2017 au plus tard
([loginsinex/smb2](https://github.com/loginsinex/smb2), Discombobulator,
Transmogrificator). Aucun n'est activement maintenu en 2026, aucun n'est
multi-plateforme, et tous supposent que l'utilisateur sait manipuler une ROM et un
émulateur NES.

On veut un éditeur **web, accessible à un utilisateur lambda**, qui reprend les
fonctionnalités d'édition du projet `loginsinex/smb2` mais avec une ergonomie
moderne inspirée de Super Mario Maker.

**Pitch en une phrase :** Mario Maker pour Super Mario Bros. 2 sur NES, dans le
navigateur.

## 2. Utilisateur cible

**Persona unique :** un joueur curieux qui n'a jamais fait de ROM hacking.

- Il possède déjà une ROM SMB2 NES (on ne s'occupe pas de lui en fournir une).
- Il sait se servir d'un émulateur NES pour jouer, ou au minimum peut apprendre.
- Il ne sait pas ce qu'est un offset, un pointeur, une palette indexée, un patch IPS.
- Il veut : ouvrir son jeu, changer des niveaux, récupérer une ROM qui marche et
  y jouer.

Ceci implique que l'interface doit **expliquer ce qu'elle fait**, pas assumer une
culture ROM hacking. Les concepts techniques doivent rester invisibles quand c'est
possible, et être expliqués en langage naturel quand c'est nécessaire.

### Principe structurant : vocabulaire UI métier, pas jargon ROM

Toutes les étiquettes, titres de section, messages d'erreur et libellés de l'UI
doivent utiliser du **langage compréhensible par un joueur qui n'a jamais édité
un niveau SMB2**, pas les noms internes du format ROM ou du vieux tool C++.

Exemples de traduction (à finaliser en planning, forme tentative) :

| Terme ROM / vieux tool | Label UI proposé |
|------------------------|------------------|
| Ground Set / Ground Type | "Décor du niveau" / "Style du décor" |
| Object Type | "Type de niveau" (biome principal) |
| World routing table | "Carte des niveaux" / "Ordre des niveaux" |
| Pointer item | "Porte" ou "Transition" |
| Palette | "Palette de couleurs" (nommée par monde) |
| Shared enemy data | "Ennemis partagés avec [Niveau X]" |

**Pas de 'mode avancé' qui cache des features.** Toutes les fonctionnalités sont
visibles au même niveau, mais avec un nommage qui ne demande pas de connaissance
ROM préalable. Un utilisateur n'a pas à lire de doc externe pour deviner ce que
fait un bouton.

**Pas de saisie hexadécimale, pas d'index numérique brut.** Tout se sélectionne
par preview visuelle (palettes, tilesets, ennemis) ou par nom lisible (musiques,
styles). Le vieux tool expose parfois des indices numériques ; on les cache.

## 3. Parcours utilisateur cible (happy path)

1. L'utilisateur arrive sur le site.
2. Il clique "Charger ma ROM" et sélectionne son fichier `.nes`.
3. L'éditeur vérifie que c'est bien SMB2 USA PRG0. Si non, message d'erreur clair
   indiquant quelle version est attendue.
4. L'éditeur décode la ROM et affiche la liste des niveaux avec un aperçu visuel.
5. Il sélectionne un niveau. Le canvas affiche le niveau en vue 2D, avec à côté
   une bibliothèque d'éléments (tiles, objets, ennemis).
6. Il glisse-dépose des éléments sur le canvas, déplace ou supprime ceux existants.
7. Il peut modifier les propriétés du niveau (musique, couleurs, longueur, etc.)
   via un panneau dédié.
8. Il peut passer à un autre niveau et itérer.
9. Il clique "Télécharger la ROM modifiée" et obtient un fichier `.nes` qu'il peut
   charger dans son émulateur préféré.

Aucune authentification, aucun stockage serveur, aucun partage en ligne — tout
reste dans son navigateur.

## 4. Scope fonctionnel v1

**Horizon v1 : parité complète** avec les capacités d'édition de
`loginsinex/smb2` (sections 4.1 à 4.7). C'est la cible finale.

**Mais on livre par jalons successifs**, pas en un seul big bang, pour réduire
le risque d'abandon identifié par la review (projet solo, greenfield,
reconstruction d'un outil C++ de 3 ans). Chaque jalon est un produit
indépendamment utile et indépendamment shippable.

### Jalons

| Jalon | Contenu | Preuve de viabilité |
|-------|---------|---------------------|
| **v0.1 — Foundation** | Upload ROM + validation checksum (4.6 validation + section 7) ; décodage complet des niveaux et ennemis ; test round-trip octet-identique vert ; affichage read-only d'un niveau en 2D avec assets pré-rendus (4.1 rendering) ; bouton "Télécharger la ROM" qui re-serialize sans modification. | La ROM sort identique à l'entrée. Parse + serialize fonctionnent. |
| **v0.2 — Édition layout** | 4.1 (drag-and-drop layout, sans multi-select rectangulaire) + 4.3 (propriétés de niveau en UI). Ship un éditeur qui peut déjà modifier le layout et la musique. | Premier vrai éditeur utilisable pour un lambda. |
| **v0.3 — Ennemis** | 4.2 complet, y compris gestion UI des ennemis partagés. | Feature flagship ajoutée. |
| **v0.4 — Intégrité** | Reste du 4.6 (budget ROM en live, confirmations destructives) + 4.7 partiel (undo/redo + export de projet). | Robustesse production-ready. |
| **v0.5 — Palettes & Liens** | 4.4 (palettes globales) + 4.5 (pointeurs in-level + table de routage en vue liste). | Parité étendue. |
| **v1.0 — Finitions** | Multi-select rectangulaire (4.1), auto-save localStorage (4.7), vue graphe optionnelle pour 4.5.b si budget le permet. | Parité complète atteinte. |

**Principe :** à tout moment après v0.1, arrêter le projet donne un outil qui
marche partiellement plutôt qu'un projet qui marche pas du tout. Chaque jalon
est testable, publiable, et utile à un lambda même si plus limité qu'un outil
complet.

### Liste des capacités (l'ensemble = horizon v1)

### 4.1 Édition du layout des niveaux — ESSENTIEL
- Grille visuelle du niveau avec rendu 2D des tiles. **Stratégie de rendering :
  assets pré-rendus bundlés** (parité avec le vieux tool). Un script de build
  extrait une fois pour toutes les tiles de la ROM canonique SMB2 USA PRG0 et
  les livre en PNG dans le bundle de l'app. Le runtime affiche simplement ces
  PNG aux bonnes positions, sans décoder le CHR à la volée. Valide parce que
  v1 n'accepte que cette unique ROM canonique (section 7).
- Bibliothèque d'éléments à gauche (tiles de base, objets spéciaux, portes,
  végétaux, plateformes).
- Drag-and-drop : glisser un élément de la bibliothèque vers le canvas.
- Sélection, déplacement, suppression des éléments existants.
- Sélection multiple (au moins rectangulaire) pour déplacements groupés.

### 4.2 Placement des ennemis — ESSENTIEL
- Vue combinée ou toggle avec la vue des tiles (voir ennemis en même temps que
  le layout).
- Bibliothèque d'ennemis disponibles (Shy Guy, Ninji, Birdo, Mouser, etc.).
- Position X/Y, page, type éditables en drag-and-drop.
- **Gestion des ennemis partagés entre niveaux — parité stricte avec le vieux
  tool.** Dans la ROM SMB2 originale livrée par Nintendo, plusieurs slots de
  niveau pointent souvent vers le même bloc physique de données ennemis (pour
  tenir dans les ~16 Ko de la région de données du jeu). Cette contrainte est
  inhérente à la ROM, pas un choix du vieux tool.
  - L'éditeur doit afficher explicitement quand un niveau partage ses données
    ennemis avec d'autres : badge ou libellé type "Ennemis partagés avec
    Niveau 1-2, 1-3".
  - Éditer les ennemis d'un niveau partagé change automatiquement tous les
    niveaux liés — comme dans le vieux tool.
  - Bouton "Rendre indépendant" (équivalent du détachage via reference count
    dans le C++) pour copier les données et libérer ce niveau du partage, au
    coût de l'usage mémoire ROM. L'UI doit avertir l'user que cette opération
    consomme du budget mémoire (voir 4.6 budget ROM).
  - Le message UI doit expliquer la raison en langage naturel ("Certains
    niveaux du jeu original partagent les mêmes ennemis pour économiser de la
    place — modifier l'un modifie les autres"), pas en jargon ("reference
    count", "shared pointer").

### 4.3 Propriétés de niveau — ESSENTIEL
Panneau dédié pour chaque niveau, édition via contrôles UI avec preview visuelle
chaque fois que possible. Pas de saisie hexadécimale, pas d'index numérique brut.

Le vieux tool expose 8 champs utilisateur modifiables (vérifié dans
`clevelinfodlg.cpp` de `loginsinex/smb2` ; les 13 positions du bitfield
incluent 5 bits réservés de padding, non exposés). Chacun est renommé en
langage UI (voir tableau de traduction section 2) :

| Champ ROM | Label UI (tentative) | Contrôle UI |
|-----------|----------------------|-------------|
| Length | "Longueur du niveau" | Slider ou input numérique avec preview |
| Direction | "Direction" | Toggle "horizontal / vertical" |
| Music | "Musique" | Sélecteur avec nom de musique (ex : "Overworld", "Boss"), avec bouton de lecture |
| Palette | "Palette du niveau" | Grille de palettes avec preview appliquée |
| Enemy color | "Couleur des ennemis" | Sélecteur visuel de palette ennemis |
| Ground Set | "Décor du niveau" | Preview visuelle des tilesets (désert, jungle, etc.) |
| Ground Type | "Style du décor" | Variantes visuelles dans le décor choisi |
| Object Type | "Type de niveau" | Preview visuelle du biome (hors-sol, sous-sol, etc.) |

Note : les sémantiques exactes de `Ground Set`, `Ground Type`, et `Object Type`
ne sont pas toutes évidentes depuis la doc Data Crystal seule ; les labels UI
définitifs seront à valider pendant le portage du code C++ en planning, avec
possibilité de fusion si deux champs s'avèrent redondants pour l'utilisateur.

### 4.4 Palettes — ESSENTIEL
- Éditeur de palettes pour les mondes et l'écran de sélection.
- Color picker visuel, palette NES (56 couleurs disponibles) présentée comme
  une grille cliquable, pas comme une liste d'index.

### 4.5 Liens entre niveaux — ESSENTIEL
Le vieux tool traite deux concepts distincts sous cette catégorie, à ne pas
confondre :

**4.5.a Pointeurs d'entrée dans les niveaux (in-level pointer items)**
- Items NLI `nliPtr` de 3 octets qui contrôlent les transitions de zones dans le
  flux de données d'un niveau (ex : quelle zone on charge en passant une porte).
- Édition dans le contexte du niveau lui-même, comme un objet parmi d'autres.

**4.5.b Table de routage des niveaux (world routing table)**
- Mapping global entre les 210 slots de niveau du jeu et les blocs de données
  de niveau / ennemis effectivement chargés. Plusieurs slots peuvent pointer vers
  le même bloc (voir note sur les données partagées en 4.2).
- Équivalent du dialog `CWorldsDataDlg` / `CWorldsLevelsDlg` du vieux tool.
- Représentation à choisir en planning : liste tabulaire (simple, suffisant pour
  la parité) ou graphe visuel (plus riche mais complexe à implémenter).

### 4.6 Intégrité et robustesse — ESSENTIEL
Ces éléments gardent le fichier ROM de sortie valide et les données utilisateur
en sécurité. Sans ces fondations, le critère de succès "ROM de sortie valide"
(section 8) ne peut pas être garanti.

- **Validation au chargement** — c'est l'étape 3 du happy path, pas un
  nice-to-have : détection de la version de ROM via checksum du PRG-ROM (après
  stripping de l'en-tête iNES + trainer éventuel si présent), message d'erreur
  explicite si mauvaise ROM. Ne jamais rejeter une ROM valide à cause d'une
  variation d'en-tête iNES ; la vérité canonique est le contenu PRG.
- **Budget mémoire ROM** — le vieux tool implémente `GetMemoryStatus()` pour
  tracker l'usage des ~16 Ko de la région `NES_PTR_START`–`NES_PTR_EOF` qui
  contient tous les niveaux + ennemis + pointeurs. L'éditeur v2 doit afficher
  cet usage en temps réel et **empêcher** toute sauvegarde qui dépasserait la
  capacité (sinon la ROM exportée est corrompue).
- **Nom de fichier de sortie différencié** — le fichier téléchargé ne doit
  jamais avoir le même nom que la ROM d'origine (ex : suffixe `-edited` ou
  timestamp), pour ne pas écraser la ROM originale de l'utilisateur. Un
  utilisateur lambda ne sait pas qu'il faut garder l'original.
- **Confirmation avant opérations destructives** (reset niveau, etc.).

### 4.7 Ergonomie moderne — ESSENTIEL
Ces éléments ne sont pas dans le vieux tool mais sont requis pour un éditeur
web moderne crédible :

- **Undo / Redo** avec raccourcis clavier standards (Ctrl+Z / Ctrl+Shift+Z).
- **Auto-save best-effort dans le navigateur** (via `localStorage` ou
  équivalent) — reprendre où on en était après fermeture du navigateur, sans
  avoir à ré-uploader la ROM. Important : cette persistence est **locale au
  navigateur et à l'appareil**, pas synchronisée dans le cloud, et peut être
  effacée par le navigateur (clear cookies, mode privé, éviction après
  inactivité prolongée). C'est un **confort, pas une garantie**.
- **Export / Import de projet** — bouton explicite qui télécharge un fichier
  de projet (format à définir en planning, ex : `.smb2proj`) que l'user peut
  stocker durablement et re-uploader plus tard pour reprendre son travail.
  C'est le filet de sécurité contre la perte de l'auto-save. Le contenu du
  fichier projet est à trancher en planning (ROM complète encodée, ou état
  d'édition + référence ROM), mais l'existence du bouton est requise en v1.
- Après N minutes d'édition sans export de projet, l'éditeur affiche une
  invitation douce ("Pense à sauvegarder ton projet"), sans être bloquante.

## 5. Hors scope v1 (non-goals explicites)

Décisions prises de ne PAS inclure dans v1 :

- **Émulateur NES intégré.** L'utilisateur teste sur son propre émulateur.
  Ajouter un émulateur (jsnes, nes-rust-wasm) multiplie la complexité et la
  surface de bugs. Envisageable en v2.
- **Édition des graphismes CHR (sprites, tiles).** Le vieux tool ne le fait pas
  non plus. Projet dans le projet.
- **Édition de la musique.** Hors scope.
- **Édition de l'écran titre.** Hors scope.
- **Plateforme communautaire** (comptes, partage, classements, téléchargement de
  hacks). On fait un éditeur, pas un site communautaire.
- **Collaboration temps réel.**
- **Support multi-ROM** : pas d'Europe, pas de Japan / Doki Doki Panic en v1.
  USA PRG0 uniquement.
- **Patches IPS/BPS.** On livre une ROM complète modifiée — plus simple pour un
  lambda. Comme la ROM ne quitte jamais le navigateur de l'utilisateur, la
  question de la redistribution ne se pose pas : on rend à l'utilisateur son
  propre fichier modifié.

## 6. Architecture (décisions produit, pas techniques)

- **SPA Vue 100% client.** Aucun backend, aucun serveur d'application, aucune
  base de données. Le parsing de la ROM, l'édition, la génération du fichier
  modifié se font intégralement dans le navigateur.
- **Hébergement statique** (GitHub Pages, Netlify, Vercel ou équivalent).
- **La ROM ne quitte jamais le navigateur de l'utilisateur.** Pas d'upload
  serveur, pas de télémétrie sur le contenu de la ROM.

Les détails techniques (librairie de parsing, choix Canvas vs HTML/SVG, stack
de build, lib de drag-and-drop) sont à trancher en phase de planning.

## 7. ROM supportée

- **Super Mario Bros. 2 (USA) PRG0** uniquement.
- **Stratégie de validation :** calculer un checksum (CRC32 ou MD5) sur le
  contenu PRG-ROM **après** stripping de l'en-tête iNES (16 octets) et d'un
  éventuel trainer (512 octets si bit trainer du header iNES levé). Accepter
  toute ROM dont le PRG-ROM matche le checksum de référence de SMB2 USA PRG0,
  quel que soit le format d'en-tête du fichier sur disque. Ne pas rejeter une
  ROM PRG0 légitime au prétexte que son en-tête n'a pas la forme attendue.
- Message d'erreur explicite (en langage naturel, pas en jargon ROM) si la ROM
  fournie est d'une autre version, non-SMB2, corrompue, ou manifestement pas
  une ROM NES (taille incohérente).

## 8. Critères de succès

Le v1 est un succès si :

1. **Parité fonctionnelle** — un utilisateur pourrait remplacer `loginsinex/smb2`
   par cet éditeur pour toutes les opérations que le vieux tool permet.
2. **Utilisable par un lambda** — une personne qui n'a jamais fait de ROM hacking
   peut ouvrir sa ROM, modifier un niveau visuellement et en tester le résultat
   sur un émulateur sans lire de doc externe.
3. **ROM de sortie valide** — le fichier `.nes` exporté par l'éditeur boote
   sans corruption dans les émulateurs NES courants (FCEUX, Mesen, Nestopia).
   Prérequis de planning : un test round-trip octet-identique
   (parse → re-serialize d'une ROM non modifiée produit un fichier
   byte-identique à l'original) est une pré-condition à toute feature
   d'édition. Sans ce test vert, on ne peut pas garantir la non-corruption.
4. **Pas de perte de données involontaire** — undo/redo fiable, export de projet
   explicite disponible à tout moment, auto-save localStorage best-effort comme
   filet secondaire (pas comme unique persistence), pas de crash sur
   drag-and-drop inhabituel, nom de fichier de ROM exportée différencié pour ne
   pas écraser la ROM originale.
5. **Zéro install, zéro compte.** Ouvrir une URL suffit.

## 9. Références

- Vieux projet source d'inspiration (parité fonctionnelle visée) :
  [loginsinex/smb2](https://github.com/loginsinex/smb2) — C++/Win32, 2014–2017,
  MIT.
- Documentation du format ROM :
  - [Data Crystal ROM map](https://datacrystal.tcrf.net/wiki/Super_Mario_Bros._2_(NES)/ROM_map)
  - [Data Crystal RAM map](https://datacrystal.tcrf.net/wiki/Super_Mario_Bros._2:RAM_map)
- Concurrents abandonnés (pour inspiration UX) : SMB2 Discombobulator (acmlm),
  SMB2 Transmogrificator.

## 10. Questions ouvertes pour le planning

Points à trancher en phase de planning, pas ici :

- **Langue de l'UI.** Français uniquement ? Français + anglais (i18n dès v1) ?
  À trancher avant le début de l'implémentation.
- **Stratégie de rendu des tiles** (Canvas 2D, HTML absolute, SVG, WebGL ?).
- **Librairie de parsing NES** : en réutiliser une JS existante ou porter la
  logique du C++ de `loginsinex/smb2` directement en TypeScript.
- ~~**Gestion du CHR** : extraction dynamique depuis la ROM vs pré-extraction bundlée.~~ *(résolu : pré-extraction bundlée, voir 4.1)*
- **Format exact de l'auto-save localStorage** (diff vs ROM complète encodée).
- **Modèle de données des niveaux en mémoire** (structure intermédiaire entre le
  format ROM bit-packed et l'UI).
- **Stratégie de tests** (fixture ROMs, snapshot du round-trip parse/serialize).

## 11. Prérequis légaux et éthiques

- L'utilisateur doit posséder sa propre ROM. L'éditeur ne fournit jamais de ROM.
- L'éditeur ne stocke jamais la ROM côté serveur (par construction : il n'y a
  pas de serveur).
- La ROM modifiée étant produite localement à partir du fichier de l'utilisateur,
  on ne redistribue rien.
