require('dotenv').config();
const path = require('path');
const https = require('https');
const express = require('express');
const db = require('./db');
const powens = require('./powens');
const auth = require('./crypto-auth');
const sessions = require('./sessions');
const insights = require('./insights');
const loanMath = require('./loan-math');
const allocation = require('./allocation');
const etfCatalog = require('./etf-catalog');
const projection = require('./projection');
const { getOrCreateCertificate, getLanAddresses } = require('./https-cert');

const app = express();
const PORT = process.env.PORT || 3000;
const REDIRECT_URI = process.env.POWENS_REDIRECT_URI || `https://localhost:${PORT}/callback`;
const SIGNUP_CODE = process.env.SIGNUP_CODE || null; // si defini, requis pour creer un compte

const SESSION_COOKIE = 'gl_session';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 1000;
let failedAttempts = 0;
let lockoutUntil = 0;

app.use(express.json());

// --- Cookies minimalistes (pas de dependance externe) -------------------

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res, sessionId) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${4 * 60 * 60}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

function getSessionFromReq(req) {
  const cookies = parseCookies(req);
  return sessions.getSession(cookies[SESSION_COOKIE]);
}

// Verrouille l'acces aux routes sensibles tant que la personne n'est pas
// connectee dans cette session serveur. req.userId / req.encryptionKey sont
// ensuite utilises par CHAQUE route pour ne lire/ecrire que ses propres
// donnees -- c'est la frontiere qui isole deux comptes sur un meme deploiement.
function requireUnlocked(req, res, next) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ ok: false, error: 'locked' });
  req.userId = session.userId;
  req.encryptionKey = session.key;
  next();
}

// Variante pour les routes atteintes par un clic sur un lien classique
// (navigation plein-page : "Relier un compte", "Gerer les connexions",
// retour de callback Powens), pas par un appel fetch(). Si la session a
// expire ou a ete perdue (ex: redemarrage du service apres mise en veille
// sur le plan gratuit Render), on renvoie proprement vers l'ecran de
// connexion plutot que d'afficher un JSON brut illisible dans le navigateur.
function requireUnlockedOrRedirect(req, res, next) {
  const session = getSessionFromReq(req);
  if (!session) return res.redirect('/?relogin=1');
  req.userId = session.userId;
  req.encryptionKey = session.key;
  next();
}

app.use('/', express.static(path.join(__dirname, '..', 'public')));

// --- Routes : inscription / connexion -------------------------------------

app.get('/api/session', (req, res) => {
  const session = getSessionFromReq(req);
  res.json({ state: session ? 'unlocked' : 'locked', signup_open: !SIGNUP_CODE });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, signup_code } = req.body;

  if (SIGNUP_CODE && signup_code !== SIGNUP_CODE) {
    return res.status(403).json({ ok: false, error: "Code d'inscription incorrect." });
  }
  if (!username || String(username).trim().length < 3) {
    return res.status(400).json({ ok: false, error: "Nom d'utilisateur trop court (3 caracteres min.)" });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ ok: false, error: 'Mot de passe trop court (8 caracteres min.)' });
  }
  if (db.getUserByUsername(username.trim())) {
    return res.status(409).json({ ok: false, error: "Ce nom d'utilisateur est deja pris." });
  }

  const { saltHex, canary, key } = auth.setupPin(String(password));
  const userId = db.createUser(username.trim(), saltHex, canary);

  const sessionId = sessions.createSession(userId, key);
  setSessionCookie(res, sessionId);
  res.json({ ok: true });
});

app.post('/api/auth/login', (req, res) => {
  const now = Date.now();
  if (now < lockoutUntil) {
    const waitSec = Math.ceil((lockoutUntil - now) / 1000);
    return res.status(429).json({ ok: false, error: `Trop de tentatives, reessaie dans ${waitSec}s` });
  }

  const { username, password } = req.body;
  const user = username ? db.getUserByUsername(String(username).trim()) : null;
  const key = user && password
    ? auth.verifyPin(String(password), user.password_salt, user.password_canary)
    : null;

  if (!key) {
    failedAttempts += 1;
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      lockoutUntil = Date.now() + LOCKOUT_MS * Math.pow(2, failedAttempts - MAX_FAILED_ATTEMPTS);
    }
    return res.status(401).json({ ok: false, error: 'Identifiant ou mot de passe incorrect' });
  }

  failedAttempts = 0;
  lockoutUntil = 0;
  const sessionId = sessions.createSession(user.id, key);
  setSessionCookie(res, sessionId);
  res.json({ ok: true });
});

app.post('/api/auth/lock', (req, res) => {
  const cookies = parseCookies(req);
  sessions.destroySession(cookies[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// --- Helpers Powens (necessitent la cle de session pour dechiffrer) -----

async function getOrCreatePermanentToken(userId, encryptionKey) {
  const encrypted = db.getEncryptedToken(userId);
  if (encrypted) return auth.decrypt(encrypted, encryptionKey);
  const token = await powens.initPermanentToken();
  db.setEncryptedToken(userId, auth.encrypt(token, encryptionKey));
  return token;
}

async function syncEverything(userId, encryptionKey) {
  const token = await getOrCreatePermanentToken(userId, encryptionKey);

  const connections = await powens.getConnections(token);
  for (const c of connections) {
    db.upsertConnection(userId, {
      id: c.id,
      connector_name: c.connector && c.connector.name ? c.connector.name : String(c.id_connector || ''),
      label: c.connector && c.connector.name ? c.connector.name : `Connexion ${c.id}`,
    });
  }

  const accounts = await powens.getAccounts(token);
  let accountsTotal = 0;
  for (const a of accounts) {
    db.upsertAccount(userId, {
      id: a.id,
      connection_id: a.id_connection,
      name: a.name || a.original_name || 'Compte',
      type: a.type || 'unknown',
      currency: a.currency && a.currency.id ? a.currency.id : 'EUR',
      balance: a.balance != null ? a.balance : 0,
      iban: a.iban || null,
      updated_at: a.last_update || new Date().toISOString(),
    });
    accountsTotal += a.balance != null ? a.balance : 0;
    db.recordAccountSnapshot(userId, a.id, a.balance != null ? a.balance : 0);

    try {
      const txs = await powens.getTransactions(token, a.id, { limit: 200 });
      for (const t of txs) {
        db.upsertTransaction(userId, {
          id: t.id,
          account_id: a.id,
          date: t.date || t.rdate,
          label: t.wording || t.original_wording || t.simplified_wording || 'Operation',
          amount: t.value != null ? t.value : 0,
          category: t.category && t.category.name ? t.category.name : null,
        });
      }
    } catch (e) {
      console.warn(`[sync] Impossible de recuperer les transactions du compte ${a.id}:`, e.message);
    }

    try {
      const investments = await powens.getInvestments(token, a.id);
      if (investments.length) {
        const diffValues = investments.map((i) => i.diff);
        const hasDiffData = diffValues.some((d) => d != null);

        if (hasDiffData) {
          const totalDiff = diffValues.reduce((s, d) => s + (d || 0), 0);
          const totalValuation = investments.reduce((s, i) => s + (i.valuation || 0), 0);
          const costBasis = totalValuation - totalDiff;
          const perfPercent = costBasis ? (totalDiff / costBasis) * 100 : null;
          db.updateAccountPerformance(userId, a.id, totalDiff, perfPercent);
        } else {
          db.updateAccountPerformance(userId, a.id, null, null);
        }

        const investmentIds = [];
        for (const inv of investments) {
          const code = inv.code || inv.stock_symbol || null;
          const id = `${a.id}:${code || inv.label || 'unknown'}`;
          investmentIds.push(id);
          db.upsertInvestment(userId, {
            id,
            account_id: a.id,
            label: inv.label || inv.original_label || code || 'Position',
            code,
            quantity: inv.quantity != null ? inv.quantity : null,
            unitvalue: inv.unitvalue != null ? inv.unitvalue : null,
            valuation: inv.valuation != null ? inv.valuation : 0,
            diff: inv.diff != null ? inv.diff : null,
            diff_percent: inv.diff_percent != null ? inv.diff_percent : null,
            updated_at: new Date().toISOString(),
          });
        }
        db.pruneInvestments(userId, a.id, investmentIds);
      } else {
        db.updateAccountPerformance(userId, a.id, null, null);
        db.pruneInvestments(userId, a.id, []);
      }
    } catch (e) {
      console.warn(`[sync] Pas de performance disponible pour le compte ${a.id}:`, e.message);
    }
  }

  db.pruneStale(
    userId,
    connections.map((c) => c.id),
    accounts.map((a) => a.id)
  );

  const propertiesTotal = db.getProperties(userId).reduce((s, p) => s + (p.value || 0), 0);
  const loansTotal = db
    .getLoans(userId)
    .reduce((s, l) => s + loanMath.remainingBalance(l), 0);

  const total = accountsTotal + propertiesTotal - loansTotal;
  db.recordNetworthSnapshot(userId, total);
  return { connections: connections.length, accounts: accounts.length, total };
}

// --- Routes : statut / configuration -----------------------------------

app.get('/api/status', requireUnlocked, (req, res) => {
  const hasToken = !!db.getEncryptedToken(req.userId);
  const configured = !!(process.env.POWENS_DOMAIN && process.env.POWENS_CLIENT_ID && process.env.POWENS_CLIENT_SECRET);
  res.json({ configured, connected: hasToken });
});

// --- Routes : flux de connexion bancaire (Webview Powens) --------------

app.get('/connect', requireUnlockedOrRedirect, async (req, res) => {
  try {
    const token = await getOrCreatePermanentToken(req.userId, req.encryptionKey);
    const code = await powens.getTemporaryCode(token);
    const url = powens.buildWebviewUrl(code, REDIRECT_URI);
    res.redirect(url);
  } catch (e) {
    console.error(e);
    res.status(500).send(`Erreur lors de l'ouverture du Webview Powens: ${e.message}`);
  }
});

app.get('/manage', requireUnlockedOrRedirect, async (req, res) => {
  try {
    const token = await getOrCreatePermanentToken(req.userId, req.encryptionKey);
    const code = await powens.getTemporaryCode(token);
    const url = powens.buildManageWebviewUrl(code, REDIRECT_URI);
    res.redirect(url);
  } catch (e) {
    console.error(e);
    res.status(500).send(`Erreur lors de l'ouverture du Webview de gestion: ${e.message}`);
  }
});

app.get('/callback', requireUnlockedOrRedirect, async (req, res) => {
  const { connection_id, error, error_description } = req.query;

  if (error) {
    return res.redirect(`/?error=${encodeURIComponent(error_description || error)}`);
  }

  try {
    await syncEverything(req.userId, req.encryptionKey);
  } catch (e) {
    console.error('[callback] echec de synchronisation:', e.message);
    return res.redirect(`/?error=${encodeURIComponent(e.message)}`);
  }

  res.redirect(`/?connected=${connection_id || '1'}`);
});

// --- Routes : donnees pour le dashboard (protegees) ----------------------

app.post('/api/sync', requireUnlocked, async (req, res) => {
  try {
    const result = await syncEverything(req.userId, req.encryptionKey);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/connections/:id', requireUnlocked, (req, res) => {
  const { label } = req.body;
  if (!label || !label.trim()) {
    return res.status(400).json({ ok: false, error: 'label manquant' });
  }
  db.renameConnection(req.userId, req.params.id, label.trim());
  res.json({ ok: true });
});

app.get('/api/accounts', requireUnlocked, (req, res) => {
  res.json(db.getAllAccountsWithConnection(req.userId));
});

app.get('/api/accounts/:id/transactions', requireUnlocked, (req, res) => {
  res.json(db.getTransactionsForAccount(req.userId, req.params.id));
});

app.get('/api/accounts/:id/history', requireUnlocked, (req, res) => {
  res.json(db.getAccountHistory(req.userId, req.params.id));
});

app.get('/api/accounts/:id/investments', requireUnlocked, (req, res) => {
  res.json(
    db.getInvestmentsForAccount(req.userId, req.params.id).map((i) => ({
      ...i,
      regions: i.regions_json ? JSON.parse(i.regions_json) : null,
    }))
  );
});

app.patch('/api/investments/:id/regions', requireUnlocked, (req, res) => {
  const { regions } = req.body;
  if (!regions || typeof regions !== 'object') {
    return res.status(400).json({ ok: false, error: 'regions (objet) requis' });
  }
  db.updateInvestmentRegions(req.userId, req.params.id, regions);
  res.json({ ok: true });
});

app.patch('/api/accounts/:id/regions', requireUnlocked, (req, res) => {
  const { regions } = req.body;
  if (!regions || typeof regions !== 'object') {
    return res.status(400).json({ ok: false, error: 'regions (objet) requis' });
  }
  db.updateAccountRegions(req.userId, req.params.id, regions);
  res.json({ ok: true });
});

app.get('/api/isin-lookup/:code', requireUnlocked, (req, res) => {
  const regions = etfCatalog.lookup(req.params.code);
  res.json({ known: !!regions, regions });
});

app.get('/api/networth-history', requireUnlocked, (req, res) => {
  res.json(db.getNetworthHistory(req.userId));
});

app.get('/api/insights', requireUnlocked, (req, res) => {
  try {
    res.json(insights.computeInsights(req.userId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Routes : biens immobiliers et credits (saisie manuelle) --------------

app.get('/api/properties', requireUnlocked, (req, res) => {
  res.json(db.getProperties(req.userId));
});

app.post('/api/properties', requireUnlocked, (req, res) => {
  const { name, value } = req.body;
  if (!name || value == null) {
    return res.status(400).json({ ok: false, error: 'name et value requis' });
  }
  const id = db.addProperty(req.userId, name.trim(), Number(value));
  res.json({ ok: true, id });
});

app.patch('/api/properties/:id', requireUnlocked, (req, res) => {
  const { value } = req.body;
  if (value == null) return res.status(400).json({ ok: false, error: 'value requis' });
  db.updatePropertyValue(req.userId, req.params.id, Number(value));
  res.json({ ok: true });
});

app.delete('/api/properties/:id', requireUnlocked, (req, res) => {
  db.deleteProperty(req.userId, req.params.id);
  res.json({ ok: true });
});

app.get('/api/loans', requireUnlocked, (req, res) => {
  res.json(db.getLoans(req.userId).map((l) => loanMath.summarize(l)));
});

app.post('/api/loans', requireUnlocked, (req, res) => {
  const { name, principal, annual_rate, term_months, start_date, property_id } = req.body;
  if (!name || !principal || annual_rate == null || !term_months || !start_date) {
    return res.status(400).json({
      ok: false,
      error: 'name, principal, annual_rate, term_months et start_date sont requis',
    });
  }
  const id = db.addLoan(req.userId, {
    name: name.trim(),
    principal: Number(principal),
    annual_rate: Number(annual_rate),
    term_months: Number(term_months),
    start_date,
    property_id: property_id || null,
  });
  res.json({ ok: true, id });
});

app.delete('/api/loans/:id', requireUnlocked, (req, res) => {
  db.deleteLoan(req.userId, req.params.id);
  res.json({ ok: true });
});

app.get('/api/summary', requireUnlocked, (req, res) => {
  const accounts = db.getAllAccountsWithConnection(req.userId);
  const properties = db.getProperties(req.userId);
  const loans = db.getLoans(req.userId).map((l) => loanMath.summarize(l));

  const accountsTotal = accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const propertiesTotal = properties.reduce((s, p) => s + (p.value || 0), 0);
  const loansTotal = loans.reduce((s, l) => s + l.remaining_balance, 0);

  res.json({
    accounts_total: accountsTotal,
    properties_total: propertiesTotal,
    loans_total: loansTotal,
    total: accountsTotal + propertiesTotal - loansTotal,
    properties,
    loans,
  });
});

// --- Routes : allocations (actifs / devises / geographie) -----------------

app.get('/api/allocation', requireUnlocked, (req, res) => {
  const accounts = db.getAllAccountsWithConnection(req.userId);
  const properties = db.getProperties(req.userId);
  const investments = db.getAllInvestments(req.userId);
  res.json({
    asset: allocation.assetAllocation(accounts, properties),
    currency: allocation.currencyAllocation(accounts),
    geo: allocation.geoAllocation(investments, accounts),
  });
});

// --- Routes : projecteur de patrimoine -------------------------------------

app.get('/api/projection', requireUnlocked, (req, res) => {
  const accounts = db.getAllAccountsWithConnection(req.userId);
  const properties = db.getProperties(req.userId);
  const loans = db.getLoans(req.userId);
  const config = db.getProjectionConfig(req.userId);

  const state = {
    financialTotal: accounts.reduce((s, a) => s + (a.balance || 0), 0),
    propertiesTotal: properties.reduce((s, p) => s + (p.value || 0), 0),
    loans,
  };

  res.json({
    config,
    milestones: [5, 10, 15].map((y) => projection.projectAt(state, config, y)),
    series: projection.projectSeries(state, config, 15),
  });
});

app.post('/api/projection/config', requireUnlocked, (req, res) => {
  const { monthly_dca, annual_return, property_appreciation } = req.body;
  const patch = {};
  if (monthly_dca != null) patch.monthly_dca = Number(monthly_dca);
  if (annual_return != null) patch.annual_return = Number(annual_return);
  if (property_appreciation != null) patch.property_appreciation = Number(property_appreciation);
  const config = db.saveProjectionConfig(req.userId, patch);
  res.json({ ok: true, config });
});

// --- Demarrage : HTTP simple sur Render (qui termine le HTTPS lui-meme,
// avec un vrai certificat, cote proxy), HTTPS auto-signe en local ----------

const isHostedPlatform = process.env.RENDER === 'true';

if (isHostedPlatform) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Patrimoine app disponible sur le port ${PORT} (HTTPS gere par Render)`);
  });
} else {
  const { cert, key } = getOrCreateCertificate();

  https.createServer({ cert, key }, app).listen(PORT, '0.0.0.0', () => {
    console.log(`Patrimoine app disponible sur https://localhost:${PORT}`);
    console.log('(Le navigateur va avertir "connexion non privee/non securisee" au premier');
    console.log(' acces : c\'est normal pour un certificat auto-signe local, clique sur');
    console.log(' "Avance" puis "Continuer" pour l\'accepter.)');
    const lan = getLanAddresses();
    if (lan.length) {
      console.log('Accessible depuis ton telephone (meme reseau wifi) via :');
      lan.forEach((ip) => console.log(`  -> https://${ip}:${PORT}`));
    } else {
      console.log('Impossible de detecter une adresse IP locale automatiquement.');
    }
  });
}
