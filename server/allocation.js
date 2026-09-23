// Repartitions du patrimoine. Tout ce qui peut etre deduit fiablement des
// donnees Powens l'est automatiquement (classe d'actif via le type de
// compte, devise via le compte) ; la repartition geographique des
// sous-jacents n'est pas fournie par Powens et reste donc une saisie
// manuelle, compte par compte (voir updateAccountRegions).

const INVESTMENT_TYPES = new Set(['market', 'pea', 'lifeinsurance', 'life_insurance', 'securities']);

function isInvestmentAccount(account) {
  return account.perf_percent != null || INVESTMENT_TYPES.has(account.type);
}

function assetAllocation(accounts, properties) {
  const buckets = { Liquidités: 0, Épargne: 0, 'Actions & titres': 0, Immobilier: 0, Autre: 0 };

  for (const a of accounts) {
    const balance = a.balance || 0;
    if (isInvestmentAccount(a)) buckets['Actions & titres'] += balance;
    else if (a.type === 'checking') buckets['Liquidités'] += balance;
    else if (a.type === 'savings') buckets['Épargne'] += balance;
    else buckets['Autre'] += balance;
  }

  buckets['Immobilier'] = properties.reduce((s, p) => s + (p.value || 0), 0);

  return toSegments(buckets);
}

function currencyAllocation(accounts) {
  const buckets = {};
  for (const a of accounts) {
    const cur = a.currency || 'EUR';
    buckets[cur] = (buckets[cur] || 0) + (a.balance || 0);
  }
  return toSegments(buckets);
}

// Repartition geographique a partir des LIGNES individuelles (chaque titre/ETF
// dans un compte-titres), pas du compte entier : un PEA melangeant plusieurs
// ETF avec des expositions differentes est ainsi correctement ventile.
// accounts : necessaire pour le filet de securite ci-dessous (compte-titres
// dont Powens ne renvoie AUCUNE position detaillee -- ca arrive, certains
// connecteurs n'exposent que le solde global sans le detail des lignes).
// Dans ce cas on permet de taguer le compte entier plutot que de laisser
// l'utilisateur sans aucun moyen de le classer.
function geoAllocation(investments, accounts = []) {
  const buckets = {};
  let unclassified = 0;
  const accountsWithPositions = new Set(investments.map((i) => i.account_id));

  for (const inv of investments) {
    const valuation = inv.valuation || 0;
    let regions = null;
    if (inv.regions_json) {
      try {
        regions = JSON.parse(inv.regions_json);
      } catch (e) {
        regions = null;
      }
    }

    if (!regions || !Object.keys(regions).length) {
      unclassified += valuation;
      continue;
    }

    const totalWeight = Object.values(regions).reduce((s, w) => s + w, 0) || 1;
    for (const [region, weight] of Object.entries(regions)) {
      buckets[region] = (buckets[region] || 0) + (valuation * weight) / totalWeight;
    }
  }

  for (const a of accounts) {
    if (!isInvestmentAccount(a) || accountsWithPositions.has(a.id)) continue;
    const balance = a.balance || 0;
    let regions = null;
    if (a.regions_json) {
      try {
        regions = JSON.parse(a.regions_json);
      } catch (e) {
        regions = null;
      }
    }

    if (!regions || !Object.keys(regions).length) {
      unclassified += balance;
      continue;
    }

    const totalWeight = Object.values(regions).reduce((s, w) => s + w, 0) || 1;
    for (const [region, weight] of Object.entries(regions)) {
      buckets[region] = (buckets[region] || 0) + (balance * weight) / totalWeight;
    }
  }

  if (unclassified > 0) buckets['Non classé'] = (buckets['Non classé'] || 0) + unclassified;
  return toSegments(buckets);
}

function toSegments(buckets) {
  const entries = Object.entries(buckets).filter(([, v]) => Math.abs(v) > 0.01);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return entries
    .map(([label, value]) => ({
      label,
      value: Math.round(value * 100) / 100,
      percent: total ? Math.round((value / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

module.exports = { assetAllocation, currencyAllocation, geoAllocation, isInvestmentAccount };
