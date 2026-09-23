const fetch = require('node-fetch');

const DOMAIN = process.env.POWENS_DOMAIN;
const CLIENT_ID = process.env.POWENS_CLIENT_ID;
const CLIENT_SECRET = process.env.POWENS_CLIENT_SECRET;

if (!DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
  console.warn(
    '[powens] Variables POWENS_DOMAIN / POWENS_CLIENT_ID / POWENS_CLIENT_SECRET manquantes dans .env'
  );
}

const BASE_URL = `https://${DOMAIN}.biapi.pro/2.0`;

async function apiRequest(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Reponse Powens non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = json.error_description || json.error || res.statusText;
    throw new Error(`Powens API ${method} ${path} -> ${res.status}: ${msg}`);
  }
  return json;
}

// Cree un nouvel utilisateur Powens et renvoie un access token permanent.
// A appeler UNE SEULE FOIS (ensuite le token est stocke en base).
async function initPermanentToken() {
  const data = await apiRequest('/auth/init', {
    method: 'POST',
    body: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
  });
  return data.auth_token;
}

// Genere un code temporaire a usage unique pour ouvrir le Webview en toute securite.
async function getTemporaryCode(permanentToken) {
  const data = await apiRequest('/auth/token/code', { token: permanentToken });
  return data.code;
}

function buildWebviewUrl(temporaryCode, redirectUri) {
  const params = new URLSearchParams({
    domain: DOMAIN,
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code: temporaryCode,
  });
  return `https://webview.powens.com/connect?${params.toString()}`;
}

function buildManageWebviewUrl(temporaryCode, redirectUri) {
  const params = new URLSearchParams({
    domain: DOMAIN,
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code: temporaryCode,
  });
  return `https://webview.powens.com/manage?${params.toString()}`;
}

async function getConnections(token) {
  const data = await apiRequest('/users/me/connections', { token });
  return data.connections || [];
}

async function getAccounts(token) {
  const data = await apiRequest('/users/me/accounts', { token });
  return data.accounts || [];
}

async function getTransactions(token, accountId, { limit = 200 } = {}) {
  const data = await apiRequest(
    `/users/me/accounts/${accountId}/transactions?limit=${limit}`,
    { token }
  );
  return data.transactions || [];
}

// Renvoie le detail des positions (titres, ETF...) d'un compte titres/PEA,
// avec la vraie performance (gain/perte en euros et en %) fournie par Powens
// -- pas une variation de solde, qui melangerait versements et gains reels.
// Renvoie [] pour un compte qui n'a pas d'investissements (compte courant,
// livret, etc.) plutot que de faire echouer tout le sync.
async function getInvestments(token, accountId) {
  try {
    const data = await apiRequest(`/users/me/accounts/${accountId}/investments`, { token });
    return data.investments || [];
  } catch (e) {
    return [];
  }
}

module.exports = {
  initPermanentToken,
  getTemporaryCode,
  buildWebviewUrl,
  buildManageWebviewUrl,
  getConnections,
  getAccounts,
  getTransactions,
  getInvestments,
};
