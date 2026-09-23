// Calculs d'amortissement a mensualites constantes (le cas standard d'un pret
// immobilier francais). Le capital restant du est recalcule a la volee a
// partir de la date de depart : pas besoin de "mettre a jour" quoi que ce
// soit chaque mois, c'est toujours exact au jour pres.

function monthsElapsed(startDate, asOf = new Date()) {
  const start = new Date(startDate);
  let months = (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth());
  if (asOf.getDate() < start.getDate()) months -= 1; // mensualite pas encore prelevee ce mois-ci
  return months;
}

function monthlyPayment(loan) {
  const r = loan.annual_rate / 100 / 12;
  const n = loan.term_months;
  if (r === 0) return loan.principal / n;
  return (loan.principal * r) / (1 - Math.pow(1 + r, -n));
}

function remainingBalance(loan, asOf = new Date()) {
  const elapsed = Math.max(0, Math.min(monthsElapsed(loan.start_date, asOf), loan.term_months));
  const r = loan.annual_rate / 100 / 12;
  const n = loan.term_months;
  const P = loan.principal;

  if (elapsed >= n) return 0;
  if (r === 0) return P * (1 - elapsed / n);

  const remaining =
    (P * (Math.pow(1 + r, n) - Math.pow(1 + r, elapsed))) / (Math.pow(1 + r, n) - 1);
  return Math.max(0, remaining);
}

function summarize(loan, asOf = new Date()) {
  const remaining = remainingBalance(loan, asOf);
  const payment = monthlyPayment(loan);
  const elapsed = Math.max(0, Math.min(monthsElapsed(loan.start_date, asOf), loan.term_months));
  return {
    ...loan,
    remaining_balance: Math.round(remaining * 100) / 100,
    monthly_payment: Math.round(payment * 100) / 100,
    months_elapsed: elapsed,
    months_remaining: loan.term_months - elapsed,
    progress_percent: Math.round((elapsed / loan.term_months) * 1000) / 10,
  };
}

module.exports = { monthlyPayment, remainingBalance, summarize };
