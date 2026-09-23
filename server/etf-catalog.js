// Repartition geographique typique des ETF/fonds les plus courants, pour
// pre-remplir une suggestion quand on reconnait l'ISIN -- l'utilisateur doit
// toujours confirmer avant que ce soit enregistre (voir server.js /
// app.js : jamais applique en silence). Ces chiffres sont approximatifs et
// evoluent dans le temps (rebalancements d'indice) : ils servent de point de
// depart a ajuster, pas une verite absolue. Pour un fonds mondial
// diversifie (type MSCI ACWI / FTSE All-World) dont la ventilation precise
// pays par pays n'apporte pas grand-chose, on utilise le seau "International"
// plutot que de forcer une fausse precision.

const CATALOG = {
  // --- MSCI World (grandes capitalisations, marches developpes) ---
  IE00B4L5Y983: { 'Etats-Unis': 70, Europe: 14, Japon: 6, 'Autres developpes': 10 }, // iShares Core MSCI World
  IE00BJ0KDQ92: { 'Etats-Unis': 70, Europe: 14, Japon: 6, 'Autres developpes': 10 }, // iShares Core MSCI World (acc, autre ligne)
  LU0274208692: { 'Etats-Unis': 70, Europe: 14, Japon: 6, 'Autres developpes': 10 }, // Xtrackers MSCI World
  FR0011550185: { 'Etats-Unis': 70, Europe: 14, Japon: 6, 'Autres developpes': 10 }, // Amundi MSCI World

  // --- S&P 500 / Nasdaq (100% Etats-Unis) ---
  IE00B5BMR087: { 'Etats-Unis': 100 }, // iShares Core S&P 500
  IE00B3YCGJ38: { 'Etats-Unis': 100 }, // iShares Core S&P 500 (Acc)
  LU1681038243: { 'Etats-Unis': 100 }, // Amundi Nasdaq-100

  // --- Europe (100% Europe) ---
  FR0010296061: { Europe: 100 }, // Lyxor CAC 40
  LU0908500753: { Europe: 100 }, // Amundi Stoxx Europe 600
  IE00B4K48X80: { Europe: 100 }, // iShares Core MSCI Europe

  // --- Marches emergents (100% Emergents) ---
  IE00BKM4GZ66: { Emergents: 100 }, // iShares Core MSCI EM IMI
  LU1781541179: { Emergents: 100 }, // Amundi MSCI Emerging Markets

  // --- Fonds monde tres diversifies : categorise en "International" plutot
  // qu'une ventilation pays par pays artificiellement precise ---
  IE00BK5BQT80: { International: 100 }, // Vanguard FTSE All-World
  IE00BFY0GT14: { International: 100 }, // SPDR MSCI ACWI IMI
  IE00B44Z5B48: { International: 100 }, // iShares MSCI ACWI
};

// Cherche une suggestion connue pour un code ISIN. Renvoie null si inconnu :
// dans ce cas, il faut demander a l'utilisateur plutot que de deviner.
function lookup(code) {
  if (!code) return null;
  return CATALOG[code.toUpperCase()] || null;
}

module.exports = { lookup };
