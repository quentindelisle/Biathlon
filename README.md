# Biathlon 5 s – N'EPS numérique (CA1)

PWA de suivi de performance élèves — sprint 5 s / lancer long. By Quentin Delisle & Gwilherm Rocher.

## Mise en ligne
Publier ce dossier sur GitHub Pages (HTTPS obligatoire pour la caméra et l'installation).
iPad : Safari → Partager → « Sur l'écran d'accueil ». Android : Chrome → « Installer l'application ».
Fonctionne ensuite hors-ligne ; les données restent sur chaque appareil.

## Mesure : 1 point par plot atteint
- Sprint 5 s : plot 1 = 15 km/h (20,8 m), +1 km/h par plot, jusqu'à 25 km/h (plot 11).
- Lancer long : plot 1 à 4 m, un plot tous les 2 m ; 8 plots (réglable jusqu'à 12).
- Leçon 1 = test : le meilleur plot atteint devient la cible (sprint et lancer).
- Facile / difficile : écart réglable en plots (défaut : sprint 2 plots ≈ 2,8 m, lancer 1 plot = 2 m).

## Déroulement d'une leçon
1. Enseignant (code par défaut 0000) : Cycle & leçons → leçon en cours, titres, tentatives (base + curseur par leçon), plots.
2. Appel, cibles, chasubles.
3. QR tablettes → « Afficher le QR de la leçon » ; chaque tablette : Accueil → « Recevoir la leçon (QR) ».
4. Élèves : Saisie → tuile de l'élève observé → une molette par tentative (0 → nb de plots).
5. Fin de leçon : chaque tablette « Envoyer mes saisies (QR) » ; l'enseignant « Scanner une tablette ».
6. Export / Réglages → Export Excel.

Mise à jour : changer `CACHE` dans `sw.js` pour forcer le rechargement sur les tablettes.
