const db = require('./db');

const BAGUETTE_PRICE = 1.2; // prix moyen indicatif d'une baguette de pain en France

function isoMonthStart(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function daysElapsedInMonth(date = new Date()) {
  return date.getDate(); // jour du mois courant = nb de jours ecoules
}

// Calcule un petit paquet d'indicateurs ludiques et utiles a partir des
// transactions et des soldes deja synchronises. Rien n'est appele en externe :
// tout vient des donnees deja recuperees via Powens.
function computeInsights(userId) {
  const monthStart = isoMonthStart();
  const monthTx = db.getTransactionsSince(userId, monthStart);

  let income = 0;
  let expenses = 0;
  let biggestExpense = null;

  for (const t of monthTx) {
    if (t.amount >= 0) {
      income += t.amount;
    } else {
      expenses += -t.amount;
      if (!biggestExpense || t.amount < biggestExpense.amount) biggestExpense = t;
    }
  }

  const savingsRate = income > 0 ? ((income - expenses) / income) * 100 : null;
  const baguettes = Math.round(expenses / BAGUETTE_PRICE);
  const days = daysElapsedInMonth();
  const dailyBurn = days > 0 ? expenses / days : 0;

  // Autonomie estimee du compte courant au rythme de depense actuel
  let runwayDays = null;
  const checkingAccounts = db.getAccountsByType(userId, 'checking');
  if (checkingAccounts.length && dailyBurn > 0) {
    const totalChecking = checkingAccounts.reduce((s, a) => s + (a.balance || 0), 0);
    runwayDays = Math.max(0, Math.round(totalChecking / dailyBurn));
  }

  return {
    month_income: round2(income),
    month_expenses: round2(expenses),
    savings_rate: savingsRate != null ? Math.round(savingsRate) : null,
    biggest_expense: biggestExpense
      ? { label: biggestExpense.label, amount: biggestExpense.amount, date: biggestExpense.date }
      : null,
    baguettes,
    daily_burn: round2(dailyBurn),
    runway_days: runwayDays,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { computeInsights };
