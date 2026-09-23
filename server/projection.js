const loanMath = require('./loan-math');

// Valeur future d'un capital de depart + versements mensuels constants,
// avec un taux de rendement annuel compose mensuellement.
function futureValueWithContributions(presentValue, monthlyContribution, annualRatePercent, months) {
  const r = annualRatePercent / 100 / 12;
  if (r === 0) return presentValue + monthlyContribution * months;
  const growth = Math.pow(1 + r, months);
  return presentValue * growth + monthlyContribution * ((growth - 1) / r);
}

// Projette le patrimoine total a horizon donne (en annees). Les actifs
// financiers (comptes) beneficient du rendement + DCA choisis ; l'immobilier
// suit son propre taux d'appreciation ; les credits suivent leur vrai
// echeancier d'amortissement (pas une simple extrapolation).
function projectAt(state, config, years) {
  const months = Math.round(years * 12);
  const financial = futureValueWithContributions(
    state.financialTotal,
    config.monthly_dca,
    config.annual_return,
    months
  );
  const properties = state.propertiesTotal * Math.pow(1 + config.property_appreciation / 100, years);

  const asOf = new Date();
  asOf.setMonth(asOf.getMonth() + months);
  const loansRemaining = state.loans.reduce((s, l) => s + loanMath.remainingBalance(l, asOf), 0);

  return {
    year: years,
    financial: round2(financial),
    properties: round2(properties),
    loans: round2(loansRemaining),
    total: round2(financial + properties - loansRemaining),
  };
}

// Genere une serie annuelle (annee 0 a maxYears) pour tracer une courbe.
function projectSeries(state, config, maxYears = 15) {
  const series = [];
  for (let y = 0; y <= maxYears; y++) {
    series.push(projectAt(state, config, y));
  }
  return series;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { futureValueWithContributions, projectAt, projectSeries };
