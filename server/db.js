const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'data.sqlite'));
db.pragma('journal_mode = WAL');

// Toutes les tables (sauf `users` elle-meme) portent une colonne user_id et
// TOUTES les requetes ci-dessous filtrent explicitement dessus : c'est la
// seule barriere qui isole les donnees de deux personnes sur un meme
// deploiement. Ne jamais ajouter de requete qui omette ce filtre.

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_salt TEXT NOT NULL,
  password_canary TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER,
  key TEXT,
  value TEXT,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY,               -- powens connection id
  user_id INTEGER,
  connector_name TEXT,
  label TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,               -- powens account id
  user_id INTEGER,
  connection_id INTEGER,
  name TEXT,
  type TEXT,
  currency TEXT,
  balance REAL,
  iban TEXT,
  updated_at TEXT,
  perf_amount REAL,
  perf_percent REAL,
  regions_json TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,               -- powens transaction id
  user_id INTEGER,
  account_id INTEGER,
  date TEXT,
  label TEXT,
  amount REAL,
  category TEXT
);

CREATE TABLE IF NOT EXISTS networth_snapshots (
  user_id INTEGER,
  date TEXT,
  total REAL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  user_id INTEGER,
  account_id INTEGER,
  date TEXT,
  balance REAL,
  PRIMARY KEY (user_id, account_id, date)
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT,
  value REAL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT,
  principal REAL,
  annual_rate REAL,
  term_months INTEGER,
  start_date TEXT,
  property_id INTEGER
);

CREATE TABLE IF NOT EXISTS investments (
  id TEXT PRIMARY KEY,    -- account_id:code
  user_id INTEGER,
  account_id INTEGER,
  label TEXT,
  code TEXT,
  quantity REAL,
  unitvalue REAL,
  valuation REAL,
  diff REAL,
  diff_percent REAL,
  regions_json TEXT,
  updated_at TEXT
);
`);

function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
// Migration douce si data.sqlite vient d'une version mono-utilisateur
// anterieure : ajoute user_id partout ou il manquerait encore.
for (const t of ['connections', 'accounts', 'transactions', 'properties', 'loans', 'investments']) {
  ensureColumn(t, 'user_id', 'INTEGER');
}

// --- Utilisateurs -----------------------------------------------------

function createUser(username, saltHex, canary) {
  const info = db
    .prepare(
      'INSERT INTO users (username, password_salt, password_canary) VALUES (?, ?, ?)'
    )
    .run(username, saltHex, canary);
  return info.lastInsertRowid;
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

// --- Reglages par utilisateur (remplace l'ancienne table settings globale) --

function getUserSetting(userId, key) {
  const row = db
    .prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?')
    .get(userId, key);
  return row ? row.value : null;
}

function setUserSetting(userId, key, value) {
  db.prepare(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
  ).run(userId, key, value);
}

function getEncryptedToken(userId) {
  return getUserSetting(userId, 'powens_access_token_enc');
}

function setEncryptedToken(userId, value) {
  setUserSetting(userId, 'powens_access_token_enc', value);
}

const DEFAULT_PROJECTION_CONFIG = {
  monthly_dca: 0,
  annual_return: 5,
  property_appreciation: 2,
};

function getProjectionConfig(userId) {
  const raw = getUserSetting(userId, 'projection_config');
  if (!raw) return DEFAULT_PROJECTION_CONFIG;
  try {
    return { ...DEFAULT_PROJECTION_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    return DEFAULT_PROJECTION_CONFIG;
  }
}

function saveProjectionConfig(userId, config) {
  const merged = { ...getProjectionConfig(userId), ...config };
  setUserSetting(userId, 'projection_config', JSON.stringify(merged));
  return merged;
}

// --- Connexions / comptes ------------------------------------------------

function upsertConnection(userId, conn) {
  db.prepare(
    `INSERT INTO connections (id, user_id, connector_name, label) VALUES (@id, @user_id, @connector_name, @label)
     ON CONFLICT(id) DO UPDATE SET connector_name = excluded.connector_name`
  ).run({ ...conn, user_id: userId });
}

function renameConnection(userId, id, label) {
  db.prepare('UPDATE connections SET label = ? WHERE id = ? AND user_id = ?').run(
    label,
    id,
    userId
  );
}

function upsertAccount(userId, acc) {
  db.prepare(
    `INSERT INTO accounts (id, user_id, connection_id, name, type, currency, balance, iban, updated_at)
     VALUES (@id, @user_id, @connection_id, @name, @type, @currency, @balance, @iban, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       connection_id = excluded.connection_id,
       name = excluded.name,
       type = excluded.type,
       currency = excluded.currency,
       balance = excluded.balance,
       iban = excluded.iban,
       updated_at = excluded.updated_at`
  ).run({ ...acc, user_id: userId });
}

function updateAccountPerformance(userId, accountId, perfAmount, perfPercent) {
  db.prepare(
    'UPDATE accounts SET perf_amount = ?, perf_percent = ? WHERE id = ? AND user_id = ?'
  ).run(perfAmount, perfPercent, accountId, userId);
}

function updateAccountRegions(userId, accountId, regionsObj) {
  db.prepare('UPDATE accounts SET regions_json = ? WHERE id = ? AND user_id = ?').run(
    JSON.stringify(regionsObj),
    accountId,
    userId
  );
}

function pruneStale(userId, currentConnectionIds, currentAccountIds) {
  if (!currentAccountIds.length && !currentConnectionIds.length) return;

  if (currentAccountIds.length) {
    const placeholders = currentAccountIds.map(() => '?').join(',');
    db.prepare(
      `DELETE FROM transactions WHERE user_id = ? AND account_id NOT IN (${placeholders})`
    ).run(userId, ...currentAccountIds);
    db.prepare(
      `DELETE FROM account_snapshots WHERE user_id = ? AND account_id NOT IN (${placeholders})`
    ).run(userId, ...currentAccountIds);
    db.prepare(
      `DELETE FROM investments WHERE user_id = ? AND account_id NOT IN (${placeholders})`
    ).run(userId, ...currentAccountIds);
    db.prepare(`DELETE FROM accounts WHERE user_id = ? AND id NOT IN (${placeholders})`).run(
      userId,
      ...currentAccountIds
    );
  }

  if (currentConnectionIds.length) {
    const placeholders = currentConnectionIds.map(() => '?').join(',');
    db.prepare(
      `DELETE FROM connections WHERE user_id = ? AND id NOT IN (${placeholders})`
    ).run(userId, ...currentConnectionIds);
  }
}

function upsertTransaction(userId, tx) {
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, date, label, amount, category)
     VALUES (@id, @user_id, @account_id, @date, @label, @amount, @category)
     ON CONFLICT(id) DO UPDATE SET
       date = excluded.date,
       label = excluded.label,
       amount = excluded.amount,
       category = excluded.category`
  ).run({ ...tx, user_id: userId });
}

function getAllAccountsWithConnection(userId) {
  return db
    .prepare(
      `SELECT a.*, c.connector_name, c.label AS connection_label
       FROM accounts a
       LEFT JOIN connections c ON c.id = a.connection_id AND c.user_id = a.user_id
       WHERE a.user_id = ?
       ORDER BY c.label, a.name`
    )
    .all(userId);
}

function getTransactionsForAccount(userId, accountId, limit = 50) {
  return db
    .prepare(
      'SELECT * FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY date DESC LIMIT ?'
    )
    .all(userId, accountId, limit);
}

function getTransactionsSince(userId, isoDate) {
  return db
    .prepare('SELECT * FROM transactions WHERE user_id = ? AND date >= ? ORDER BY date ASC')
    .all(userId, isoDate);
}

function getAccountsByType(userId, type) {
  return db.prepare('SELECT * FROM accounts WHERE user_id = ? AND type = ?').all(userId, type);
}

// --- Historique / snapshots ------------------------------------------------

function recordNetworthSnapshot(userId, total) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO networth_snapshots (user_id, date, total) VALUES (?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET total = excluded.total`
  ).run(userId, today, total);
}

function getNetworthHistory(userId, limit = 90) {
  return db
    .prepare('SELECT * FROM networth_snapshots WHERE user_id = ? ORDER BY date ASC LIMIT ?')
    .all(userId, limit);
}

function recordAccountSnapshot(userId, accountId, balance) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO account_snapshots (user_id, account_id, date, balance) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, account_id, date) DO UPDATE SET balance = excluded.balance`
  ).run(userId, accountId, today, balance);
}

function getAccountHistory(userId, accountId, limit = 180) {
  return db
    .prepare(
      'SELECT * FROM account_snapshots WHERE user_id = ? AND account_id = ? ORDER BY date ASC LIMIT ?'
    )
    .all(userId, accountId, limit);
}

// --- Investissements (positions individuelles) -----------------------------

function upsertInvestment(userId, inv) {
  db.prepare(
    `INSERT INTO investments (id, user_id, account_id, label, code, quantity, unitvalue, valuation, diff, diff_percent, updated_at)
     VALUES (@id, @user_id, @account_id, @label, @code, @quantity, @unitvalue, @valuation, @diff, @diff_percent, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       code = excluded.code,
       quantity = excluded.quantity,
       unitvalue = excluded.unitvalue,
       valuation = excluded.valuation,
       diff = excluded.diff,
       diff_percent = excluded.diff_percent,
       updated_at = excluded.updated_at`
  ).run({ ...inv, user_id: userId });
}

function getInvestmentsForAccount(userId, accountId) {
  return db
    .prepare(
      'SELECT * FROM investments WHERE user_id = ? AND account_id = ? ORDER BY valuation DESC'
    )
    .all(userId, accountId);
}

function getAllInvestments(userId) {
  return db.prepare('SELECT * FROM investments WHERE user_id = ?').all(userId);
}

function updateInvestmentRegions(userId, id, regionsObj) {
  db.prepare('UPDATE investments SET regions_json = ? WHERE id = ? AND user_id = ?').run(
    JSON.stringify(regionsObj),
    id,
    userId
  );
}

function pruneInvestments(userId, accountId, currentIds) {
  if (!currentIds.length) {
    db.prepare('DELETE FROM investments WHERE user_id = ? AND account_id = ?').run(
      userId,
      accountId
    );
    return;
  }
  const placeholders = currentIds.map(() => '?').join(',');
  db.prepare(
    `DELETE FROM investments WHERE user_id = ? AND account_id = ? AND id NOT IN (${placeholders})`
  ).run(userId, accountId, ...currentIds);
}

// --- Biens immobiliers ---

function getProperties(userId) {
  return db.prepare('SELECT * FROM properties WHERE user_id = ? ORDER BY id').all(userId);
}

function addProperty(userId, name, value) {
  const info = db
    .prepare('INSERT INTO properties (user_id, name, value) VALUES (?, ?, ?)')
    .run(userId, name, value);
  return info.lastInsertRowid;
}

function updatePropertyValue(userId, id, value) {
  db.prepare(
    "UPDATE properties SET value = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(value, id, userId);
}

function deleteProperty(userId, id) {
  db.prepare('DELETE FROM properties WHERE id = ? AND user_id = ?').run(id, userId);
  db.prepare('UPDATE loans SET property_id = NULL WHERE property_id = ? AND user_id = ?').run(
    id,
    userId
  );
}

// --- Credits ---

function getLoans(userId) {
  return db.prepare('SELECT * FROM loans WHERE user_id = ? ORDER BY id').all(userId);
}

function addLoan(userId, loan) {
  const info = db
    .prepare(
      `INSERT INTO loans (user_id, name, principal, annual_rate, term_months, start_date, property_id)
       VALUES (@user_id, @name, @principal, @annual_rate, @term_months, @start_date, @property_id)`
    )
    .run({ ...loan, user_id: userId });
  return info.lastInsertRowid;
}

function deleteLoan(userId, id) {
  db.prepare('DELETE FROM loans WHERE id = ? AND user_id = ?').run(id, userId);
}

module.exports = {
  db,
  createUser,
  getUserByUsername,
  getUserSetting,
  setUserSetting,
  getEncryptedToken,
  setEncryptedToken,
  getProjectionConfig,
  saveProjectionConfig,
  upsertConnection,
  renameConnection,
  upsertAccount,
  updateAccountPerformance,
  updateAccountRegions,
  pruneStale,
  upsertTransaction,
  getAllAccountsWithConnection,
  getTransactionsForAccount,
  getTransactionsSince,
  getAccountsByType,
  recordNetworthSnapshot,
  getNetworthHistory,
  recordAccountSnapshot,
  getAccountHistory,
  upsertInvestment,
  getInvestmentsForAccount,
  getAllInvestments,
  updateInvestmentRegions,
  pruneInvestments,
  getProperties,
  addProperty,
  updatePropertyValue,
  deleteProperty,
  getLoans,
  addLoan,
  deleteLoan,
};
