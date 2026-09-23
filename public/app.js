const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

let currentAccountId = null;

async function boot() {
  const session = await fetch('/api/session').then((r) => r.json());

  if (session.state === 'locked') {
    show('auth-screen');
    wireAuthScreen(session.signup_open);
    if (new URLSearchParams(location.search).get('relogin')) {
      const subtitle = document.getElementById('auth-subtitle');
      subtitle.textContent =
        'Ta session a expiré (ou le service vient de redémarrer) — reconnecte-toi.';
    }
    return;
  }

  const status = await fetch('/api/status').then((r) => r.json());

  if (!status.configured) {
    show('setup-screen');
    return;
  }
  if (!status.connected) {
    show('connect-screen');
    return;
  }

  const accounts = await fetch('/api/accounts').then((r) => r.json());
  if (!accounts.length) {
    show('connect-screen');
    return;
  }

  show('app-screen');
  renderSidebar(accounts);
  loadHistory();
  loadInsights();
  loadPatrimony();
  loadAllocation();
  loadProjection();

  currentAccountId = accounts[0].id;
  markActiveAccount(currentAccountId);
  loadLedger(accounts[0]);

  document.getElementById('sync-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Synchronisation…';
    try {
      await fetch('/api/sync', { method: 'POST' });
    } finally {
      location.reload();
    }
  });

  document.getElementById('lock-btn').addEventListener('click', async () => {
    await fetch('/api/auth/lock', { method: 'POST' });
    location.reload();
  });

  document.getElementById('add-property-btn').addEventListener('click', () => openPropertyModal());
  document.getElementById('add-loan-btn').addEventListener('click', () => openLoanModal());

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.tabPanel === tab));
}

// Ecran unique login/inscription, avec un lien pour basculer de l'un a
// l'autre. Le code d'invitation n'est demande que si le serveur l'exige
// (variable SIGNUP_CODE definie cote deploiement).
function wireAuthScreen(signupOpen) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const toggle = document.getElementById('auth-toggle');
  const subtitle = document.getElementById('auth-subtitle');
  const errorEl = document.getElementById('auth-error');
  const signupCodeInput = document.getElementById('register-signup-code');

  if (!signupOpen) signupCodeInput.classList.remove('hidden');

  let mode = 'login';
  function render() {
    loginForm.classList.toggle('hidden', mode !== 'login');
    registerForm.classList.toggle('hidden', mode !== 'register');
    subtitle.textContent =
      mode === 'login' ? 'Connecte-toi pour acceder a tes comptes.' : 'Cree ton compte pour commencer.';
    toggle.textContent = mode === 'login' ? "Pas encore de compte ? Cree-en un." : "Deja un compte ? Connecte-toi.";
    errorEl.classList.add('hidden');
  }
  render();

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    mode = mode === 'login' ? 'register' : 'login';
    render();
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      location.reload();
    } else {
      errorEl.textContent = data.error || 'Erreur';
      errorEl.classList.remove('hidden');
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('register-username').value,
        password: document.getElementById('register-password').value,
        signup_code: signupCodeInput.value,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      location.reload();
    } else {
      errorEl.textContent = data.error || 'Erreur';
      errorEl.classList.remove('hidden');
    }
  });
}

function show(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function groupByConnection(accounts) {
  const groups = new Map();
  for (const a of accounts) {
    const key = a.connection_id != null ? a.connection_id : 'other';
    if (!groups.has(key)) {
      groups.set(key, { connectionId: a.connection_id, label: a.connection_label || 'Autre', accounts: [] });
    }
    groups.get(key).accounts.push(a);
  }
  return groups;
}

async function renameConnection(connectionId, currentLabel) {
  const next = prompt('Renommer cette connexion :', currentLabel);
  if (!next || !next.trim() || next.trim() === currentLabel) return;
  await fetch(`/api/connections/${connectionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: next.trim() }),
  });
  location.reload();
}

function renderSidebar(accounts) {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = '';
  const groups = groupByConnection(accounts);

  for (const { connectionId, label, accounts: accs } of groups.values()) {
    const group = document.createElement('div');
    group.className = 'sidebar-group';

    const title = document.createElement('div');
    title.className = 'sidebar-group-title';
    title.textContent = label;
    if (connectionId != null) {
      const editBtn = document.createElement('span');
      editBtn.className = 'rename-btn';
      editBtn.textContent = ' ✎';
      editBtn.title = 'Renommer';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameConnection(connectionId, label);
      });
      title.appendChild(editBtn);
    }
    group.appendChild(title);

    for (const a of accs) {
      const row = document.createElement('div');
      row.className = 'account-row';
      row.dataset.accountId = a.id;
      row.innerHTML = `
        <span class="account-name">${escapeHtml(a.name)}</span>
        <span class="account-balance">${fmt.format(a.balance || 0)}</span>
      `;
      row.addEventListener('click', () => {
        currentAccountId = a.id;
        markActiveAccount(a.id);
        loadLedger(a);
        switchTab('transactions');
      });
      group.appendChild(row);
    }

    sidebar.appendChild(group);
  }
}

function markActiveAccount(id) {
  document.querySelectorAll('.account-row').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.accountId) === Number(id));
  });
}

async function loadPatrimony() {
  const [accounts, summary] = await Promise.all([
    fetch('/api/accounts').then((r) => r.json()),
    fetch('/api/summary').then((r) => r.json()),
  ]);
  document.getElementById('networth-total').textContent = fmt.format(summary.total);
  renderBalanceSheet(accounts, summary);
}

function renderBalanceSheet(accounts, summary) {
  // --- Actif : financier ---
  const financialList = document.getElementById('financial-list');
  if (financialList) {
    financialList.innerHTML = '';
    const groups = groupByConnection(accounts);
    for (const { label, accounts: accs } of groups.values()) {
      for (const a of accs) {
        const row = document.createElement('div');
        row.className = 'balance-row';
        row.innerHTML = `
          <div>
            <div class="row-name">${escapeHtml(a.name)}</div>
            <div class="row-sub">${escapeHtml(label)}</div>
          </div>
          <span class="row-value">${fmt.format(a.balance || 0)}</span>
        `;
        financialList.appendChild(row);
      }
    }
    if (!accounts.length) {
      financialList.innerHTML = '<p class="empty-note">Aucun compte relié pour l\'instant.</p>';
    }
  }

  // --- Actif : immobilier & autres ---
  const propsList = document.getElementById('properties-list');
  if (propsList) {
    propsList.innerHTML = '';
    for (const p of summary.properties) {
      const row = document.createElement('div');
      row.className = 'balance-row';
      row.innerHTML = `
        <div>
          <div class="row-name">🏠 ${escapeHtml(p.name)}</div>
          <div class="row-sub">Bien immobilier</div>
        </div>
        <div class="row-actions">
          <span class="row-value">${fmt.format(p.value)}</span>
          <span class="rename-btn" data-edit-property="${p.id}" title="Modifier la valeur">✎</span>
          <span class="rename-btn" data-delete-property="${p.id}" title="Supprimer">✕</span>
        </div>
      `;
      propsList.appendChild(row);
    }
    if (!summary.properties.length) {
      propsList.innerHTML = '<p class="empty-note">Aucun bien ajouté.</p>';
    }
    propsList.querySelectorAll('[data-edit-property]').forEach((el) => {
      el.addEventListener('click', () => openPropertyModal(summary.properties.find((p) => String(p.id) === el.dataset.editProperty)));
    });
    propsList.querySelectorAll('[data-delete-property]').forEach((el) => {
      el.addEventListener('click', () => deleteProperty(el.dataset.deleteProperty));
    });
  }

  // --- Passif : credits ---
  const loansList = document.getElementById('loans-list');
  if (loansList) {
    loansList.innerHTML = '';
    for (const l of summary.loans) {
      const row = document.createElement('div');
      row.className = 'balance-row';
      row.innerHTML = `
        <div>
          <div class="row-name">🏦 ${escapeHtml(l.name)}</div>
          <div class="row-sub">Reste ${l.months_remaining} mois · mensualité ${fmt.format(l.monthly_payment)} · ${l.progress_percent}% remboursé</div>
        </div>
        <div class="row-actions">
          <span class="row-value negative">-${fmt.format(l.remaining_balance)}</span>
          <span class="rename-btn" data-delete-loan="${l.id}" title="Supprimer">✕</span>
        </div>
      `;
      loansList.appendChild(row);
    }
    if (!summary.loans.length) {
      loansList.innerHTML = '<p class="empty-note">Aucun crédit ajouté.</p>';
    }
    loansList.querySelectorAll('[data-delete-loan]').forEach((el) => {
      el.addEventListener('click', () => deleteLoan(el.dataset.deleteLoan));
    });
  }

  const actifTotal = summary.accounts_total + summary.properties_total;
  document.getElementById('actif-total').textContent = fmt.format(actifTotal);
  document.getElementById('passif-total').textContent = `-${fmt.format(summary.loans_total)}`;
}

// --- Modale generique -------------------------------------------------

function openModal(title, fieldsHtml, onSubmit) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = fieldsHtml;
  document.getElementById('modal-error').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');

  const submitBtn = document.getElementById('modal-submit');
  const newSubmitBtn = submitBtn.cloneNode(true); // retire les anciens listeners
  submitBtn.replaceWith(newSubmitBtn);
  newSubmitBtn.addEventListener('click', async () => {
    try {
      await onSubmit();
      closeModal();
    } catch (e) {
      const errEl = document.getElementById('modal-error');
      errEl.textContent = e.message || 'Erreur';
      errEl.classList.remove('hidden');
    }
  });
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// Accepte "3,2" ou "3.2" (clavier francais vs point decimal) et les espaces
// utilises comme separateurs de milliers.
function parseNumber(str) {
  if (str == null || str === '') return NaN;
  return Number(String(str).replace(/\s/g, '').replace(',', '.'));
}

function openPropertyModal(existing) {
  const isEdit = !!existing;
  openModal(
    isEdit ? 'Modifier la valeur du bien' : 'Ajouter un bien',
    `
      <div class="modal-field">
        <label>Nom</label>
        <input type="text" id="mf-name" value="${isEdit ? escapeHtml(existing.name) : ''}" ${isEdit ? 'disabled' : ''} placeholder="Appartement Lyon" />
      </div>
      <div class="modal-field">
        <label>Valeur estimée actuelle (€)</label>
        <input type="text" inputmode="decimal" id="mf-value" value="${isEdit ? existing.value : ''}" placeholder="250000" />
      </div>
    `,
    async () => {
      const value = parseNumber(document.getElementById('mf-value').value);
      if (isNaN(value)) throw new Error('Valeur invalide.');

      if (isEdit) {
        await fetch(`/api/properties/${existing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
      } else {
        const name = document.getElementById('mf-name').value.trim();
        if (!name) throw new Error('Le nom est requis.');
        await fetch('/api/properties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, value }),
        });
      }
      loadPatrimony();
    }
  );
}

async function deleteProperty(id) {
  if (!confirm('Supprimer ce bien ?')) return;
  await fetch(`/api/properties/${id}`, { method: 'DELETE' });
  loadPatrimony();
}

function openLoanModal() {
  const today = new Date().toISOString().slice(0, 10);
  openModal(
    'Ajouter un crédit',
    `
      <div class="modal-field">
        <label>Nom</label>
        <input type="text" id="mf-name" placeholder="Prêt appartement Lyon" />
      </div>
      <div class="modal-field">
        <label>Montant emprunté initial (€)</label>
        <input type="text" inputmode="decimal" id="mf-principal" placeholder="200000" />
      </div>
      <div class="modal-field">
        <label>Taux d'intérêt annuel (%)</label>
        <input type="text" inputmode="decimal" id="mf-rate" placeholder="3,2" />
      </div>
      <div class="modal-field">
        <label>Durée (années)</label>
        <input type="text" inputmode="decimal" id="mf-years" placeholder="20" />
      </div>
      <div class="modal-field">
        <label>Date de la 1ère mensualité</label>
        <input type="date" id="mf-start" value="${today}" />
      </div>
    `,
    async () => {
      const name = document.getElementById('mf-name').value.trim();
      const principal = parseNumber(document.getElementById('mf-principal').value);
      const rate = parseNumber(document.getElementById('mf-rate').value);
      const years = parseNumber(document.getElementById('mf-years').value);
      const start_date = document.getElementById('mf-start').value;

      if (!name) throw new Error('Le nom est requis.');
      if (isNaN(principal) || principal <= 0) throw new Error('Montant emprunté invalide.');
      if (isNaN(rate) || rate < 0) throw new Error("Taux d'intérêt invalide.");
      if (isNaN(years) || years <= 0) throw new Error('Durée invalide.');
      if (!start_date) throw new Error('Date requise.');

      const res = await fetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          principal,
          annual_rate: rate,
          term_months: Math.round(years * 12),
          start_date,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Impossible d'ajouter le crédit.");
      loadPatrimony();
      loadProjection();
    }
  );
}

async function deleteLoan(id) {
  if (!confirm('Supprimer ce crédit ?')) return;
  await fetch(`/api/loans/${id}`, { method: 'DELETE' });
  loadPatrimony();
  loadProjection();
}

async function loadHistory() {
  const history = await fetch('/api/networth-history').then((r) => r.json());
  drawChart(history);
  renderPerfRow('networth-perf', history, 'total');
}

// Calcule les variations sur 7j / 30j / depuis le debut a partir d'un
// historique [{date, [key]: valeur}], et les affiche dans le conteneur donne.
function renderPerfRow(containerId, history, key) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!history || history.length < 2) {
    el.innerHTML = '';
    return;
  }

  const byDate = (daysAgo) => {
    const target = new Date();
    target.setDate(target.getDate() - daysAgo);
    const targetStr = target.toISOString().slice(0, 10);
    // le premier point dont la date est >= a la date cible
    return history.find((h) => h.date >= targetStr) || history[0];
  };

  const latest = history[history.length - 1][key];
  const points = [
    { label: '7j', ref: byDate(7)[key] },
    { label: '30j', ref: byDate(30)[key] },
    { label: 'Depuis le debut', ref: history[0][key] },
  ];

  el.innerHTML = points
    .map((p) => {
      if (p.ref === 0 || p.ref == null) return '';
      // Si le point de reference est minuscule par rapport a la valeur
      // actuelle (ex: compte relie il y a peu, solde quasi nul au debut du
      // suivi), le pourcentage devient mathematiquement correct mais
      // absurde (+5000%...) et n'a aucun sens comme "performance". On le
      // masque plutot que d'afficher un chiffre trompeur.
      if (Math.abs(p.ref) < Math.abs(latest) * 0.05) return '';
      const pct = ((latest - p.ref) / Math.abs(p.ref)) * 100;
      const dir = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat';
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·';
      return `<span class="perf-item">${p.label} : <span class="value ${dir}">${arrow} ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span></span>`;
    })
    .join('');
}

async function loadInsights() {
  let data;
  try {
    data = await fetch('/api/insights').then((r) => r.json());
  } catch (e) {
    return;
  }
  const grid = document.getElementById('insights-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const cards = [];

  if (data.savings_rate != null) {
    cards.push({
      label: "Taux d'épargne ce mois",
      value: `${data.savings_rate}%`,
      sub: `${fmt.format(data.month_income)} encaissés · ${fmt.format(data.month_expenses)} dépensés`,
    });
  }

  if (data.biggest_expense) {
    cards.push({
      label: 'Plus grosse dépense du mois',
      value: fmt.format(Math.abs(data.biggest_expense.amount)),
      sub: `${data.biggest_expense.label} · ${fmtDate(data.biggest_expense.date)}`,
    });
  }

  cards.push({
    label: 'Dépenses du mois, en baguettes 🥖',
    value: `${data.baguettes}`,
    sub: 'à 1,20 € la baguette (estimation)',
  });

  if (data.runway_days != null) {
    cards.push({
      label: 'Autonomie au rythme actuel',
      value: `${data.runway_days} j`,
      sub: 'compte courant / dépense moyenne quotidienne',
    });
  }

  for (const c of cards) {
    const div = document.createElement('div');
    div.className = 'insight-card';
    div.innerHTML = `
      <div class="insight-label">${c.label}</div>
      <div class="insight-value">${c.value}</div>
      <div class="insight-sub">${c.sub}</div>
    `;
    grid.appendChild(div);
  }
}

function drawChart(history) {
  const svg = document.getElementById('networth-chart');
  if (history.length < 2) {
    svg.innerHTML = '';
    return;
  }
  const values = history.map((h) => h.total);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 600, h = 100, pad = 10;

  const points = history.map((pt, i) => {
    const x = pad + (i / (history.length - 1)) * (w - pad * 2);
    const y = h - pad - ((pt.total - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });

  svg.innerHTML = `
    <polyline points="${points.join(' ')}" fill="none" stroke="#c6a15b" stroke-width="2" />
  `;
}

async function loadLedger(account) {
  document.getElementById('ledger-title').textContent = account.name;
  document.getElementById('ledger-balance').textContent = fmt.format(account.balance || 0);

  const [txs, history, positions] = await Promise.all([
    fetch(`/api/accounts/${account.id}/transactions`).then((r) => r.json()),
    fetch(`/api/accounts/${account.id}/history`).then((r) => r.json()),
    fetch(`/api/accounts/${account.id}/investments`).then((r) => r.json()),
  ]);
  renderPerfRow('account-perf', history, 'balance');
  renderRealPerf(account);
  renderPositions(positions, account);

  const body = document.getElementById('ledger-body');
  const empty = document.getElementById('ledger-empty');
  body.innerHTML = '';

  if (!txs.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const t of txs) {
    const tr = document.createElement('tr');
    const amountClass = t.amount >= 0 ? 'amount-positive' : 'amount-negative';
    tr.innerHTML = `
      <td>${fmtDate(t.date)}</td>
      <td>${escapeHtml(t.label || '')}</td>
      <td class="muted">${escapeHtml(t.category || '—')}</td>
      <td class="num ${amountClass}">${fmt.format(t.amount || 0)}</td>
    `;
    body.appendChild(tr);
  }
}

const INVESTMENT_TYPES = new Set(['market', 'pea', 'lifeinsurance', 'life_insurance', 'securities']);
function looksLikeInvestmentAccount(account) {
  return account.perf_percent != null || INVESTMENT_TYPES.has(account.type);
}

// Detail des positions d'un compte-titres (PEA, portefeuille...). Chaque
// ligne peut recevoir sa propre repartition geographique, reprise ensuite
// dans le donut "Zone geographique" de l'onglet Bilan. Si Powens ne renvoie
// aucune position detaillee pour ce compte (ca arrive selon le connecteur),
// on propose de taguer le compte entier a la place.
function renderPositions(positions, account) {
  const block = document.getElementById('positions-block');
  const body = document.getElementById('positions-body');
  if (!block || !body) return;

  if (!positions.length) {
    if (!looksLikeInvestmentAccount(account)) {
      block.classList.add('hidden');
      return;
    }
    block.classList.remove('hidden');
    const regions = account.regions_json ? JSON.parse(account.regions_json) : null;
    const regionsLabel = regions ? Object.keys(regions).join(', ') : 'non classé';
    body.innerHTML = `
      <tr>
        <td colspan="5" class="muted">
          Aucune position détaillée disponible pour ce compte (Powens n'en fournit pas pour ce connecteur).
        </td>
        <td>
          <span class="rename-btn" id="tag-whole-account" title="Modifier la zone géographique du compte entier">
            ✎ ${escapeHtml(regionsLabel)}
          </span>
        </td>
      </tr>
    `;
    document.getElementById('tag-whole-account').addEventListener('click', () => editAccountRegions(account));
    return;
  }
  block.classList.remove('hidden');
  body.innerHTML = '';

  for (const p of positions) {
    const tr = document.createElement('tr');
    const perfClass = p.diff_percent == null ? '' : p.diff_percent >= 0 ? 'amount-positive' : 'amount-negative';
    const perfText = p.diff_percent == null ? '—' : `${p.diff_percent >= 0 ? '+' : ''}${p.diff_percent.toFixed(1)}%`;
    const regionsLabel = p.regions
      ? Object.keys(p.regions).join(', ')
      : 'non classé';
    tr.innerHTML = `
      <td>${escapeHtml(p.label)}</td>
      <td class="num">${p.quantity != null ? p.quantity : '—'}</td>
      <td class="num">${p.unitvalue != null ? fmt.format(p.unitvalue) : '—'}</td>
      <td class="num">${fmt.format(p.valuation || 0)}</td>
      <td class="num ${perfClass}">${perfText}</td>
      <td>
        <span class="rename-btn" data-edit-investment-regions="${p.id}" data-investment-label="${escapeHtml(p.label)}" title="Modifier la zone géographique">
          ✎ ${escapeHtml(regionsLabel)}
        </span>
      </td>
    `;
    body.appendChild(tr);
  }

  body.querySelectorAll('[data-edit-investment-regions]').forEach((el) => {
    el.addEventListener('click', () =>
      editInvestmentRegions(el.dataset.editInvestmentRegions, el.dataset.investmentLabel, positions)
    );
  });
}

async function editAccountRegions(account) {
  const current = account.regions_json ? JSON.parse(account.regions_json) : null;
  const currentStr = current
    ? Object.entries(current).map(([k, v]) => `${k}:${v}`).join(', ')
    : '';
  const input = prompt(
    `Répartition géographique de "${account.name}" — compte entier, faute de détail par ligne (zone:pourcentage, ex : Etats-Unis:100) :`,
    currentStr
  );
  if (input == null) return;

  const regions = {};
  for (const part of input.split(',')) {
    const [k, v] = part.split(':').map((s) => s.trim());
    if (k && v && !isNaN(parseNumber(v))) regions[k] = parseNumber(v);
  }
  if (!Object.keys(regions).length) return;

  await fetch(`/api/accounts/${account.id}/regions`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regions }),
  });

  account.regions_json = JSON.stringify(regions);
  renderPositions([], account);
  loadAllocation();
}

async function editInvestmentRegions(investmentId, label, positions) {
  const current = positions.find((p) => p.id === investmentId);
  let message = `Répartition géographique de "${label}" (zone:pourcentage séparés par des virgules, ex : Etats-Unis:60, Europe:25, Emergents:15, International:100) :`;
  let defaultStr = current && current.regions
    ? Object.entries(current.regions).map(([k, v]) => `${k}:${v}`).join(', ')
    : '';

  // Si aucune zone n'est deja renseignee pour cette ligne, on regarde si on
  // reconnait l'ISIN dans notre petit catalogue d'ETF courants. Si oui, on
  // ne fait QUE suggerer une valeur par defaut modifiable : rien n'est
  // jamais enregistre sans confirmation explicite via ce prompt. Si l'ISIN
  // est inconnu, on le dit clairement plutot que de deviner.
  if (!defaultStr && current && current.code) {
    const lookup = await fetch(`/api/isin-lookup/${encodeURIComponent(current.code)}`).then((r) => r.json());
    if (lookup.known) {
      defaultStr = Object.entries(lookup.regions).map(([k, v]) => `${k}:${v}`).join(', ');
      message = `Répartition géographique de "${label}" — suggestion trouvée pour l'ISIN ${current.code} (à vérifier/ajuster puis valider) :`;
    } else {
      message = `Répartition géographique de "${label}" — ISIN ${current.code} non reconnu automatiquement, merci de la renseigner toi-même (utilise "International:100" pour un fonds mondial très diversifié) :`;
    }
  }

  const input = prompt(message, defaultStr);
  if (input == null) return;

  const regions = {};
  for (const part of input.split(',')) {
    const [k, v] = part.split(':').map((s) => s.trim());
    if (k && v && !isNaN(parseNumber(v))) regions[k] = parseNumber(v);
  }
  if (!Object.keys(regions).length) return;

  await fetch(`/api/investments/${investmentId}/regions`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regions }),
  });

  const account = { id: currentAccountId };
  const [refreshed] = await Promise.all([
    fetch(`/api/accounts/${account.id}/investments`).then((r) => r.json()),
  ]);
  renderPositions(refreshed);
  loadAllocation();
}

// Performance reelle (gain/perte sur les positions, fournie par Powens),
// a ne pas confondre avec renderPerfRow qui ne fait que suivre le solde
// (et melangerait versements/retraits avec la performance des placements).
function renderRealPerf(account) {
  const el = document.getElementById('account-real-perf');
  if (!el) return;
  if (account.perf_percent == null) {
    el.innerHTML = '';
    return;
  }
  const dir = account.perf_percent > 0.05 ? 'up' : account.perf_percent < -0.05 ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·';
  const sign = account.perf_amount >= 0 ? '+' : '';
  el.innerHTML = `<span class="perf-item">Performance réelle (positions) : <span class="value ${dir}">${arrow} ${sign}${account.perf_percent.toFixed(1)}% (${sign}${fmt.format(account.perf_amount)})</span></span>`;
}

// --- Allocation (donuts + edition des zones geographiques) ---------------

const CHART_COLORS = [
  '#c6a15b', '#6fa895', '#7c9cbf', '#a68bbf',
  '#c1705f', '#8a93a3', '#d9c48f', '#5f8a94',
];

// Dessine un donut SVG (technique stroke-dasharray sur un cercle) et sa
// legende, dans le conteneur donne. segments = [{label, value, percent}].
function renderDonut(containerId, segments) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';

  if (!segments.length) {
    el.innerHTML = '<p class="muted" style="font-size:13px;">Pas encore de donnees.</p>';
    return;
  }

  const size = 120, r = 46, cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  const arcs = segments
    .map((s, i) => {
      const len = (s.percent / 100) * circumference;
      const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${CHART_COLORS[i % CHART_COLORS.length]}" stroke-width="16" stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += len;
      return circle;
    })
    .join('');

  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}</svg>`;

  const legend = segments
    .map(
      (s, i) => `
      <div class="legend-row">
        <span class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
        <span class="legend-label">${escapeHtml(s.label)}</span>
        <span class="legend-percent">${s.percent}%</span>
      </div>`
    )
    .join('');

  el.innerHTML = `${svg}<div class="donut-legend">${legend}</div>`;
}

async function loadAllocation() {
  const data = await fetch('/api/allocation').then((r) => r.json());
  renderDonut('alloc-asset', data.asset);
  renderDonut('alloc-currency', data.currency);
  renderDonut('alloc-geo', data.geo);

  const editRow = document.getElementById('geo-edit-row');
  if (editRow) {
    editRow.innerHTML =
      '<p class="muted" style="font-size:12px;">Pour renseigner la zone géographique, ouvre l\'onglet "Transactions" sur un compte-titres : chaque ligne du tableau "Positions" peut être taguée individuellement.</p>';
  }
}

// --- Projecteur de patrimoine ---------------------------------------------

async function loadProjection() {
  const data = await fetch('/api/projection').then((r) => r.json());

  document.getElementById('proj-dca').value = data.config.monthly_dca;
  document.getElementById('proj-return').value = data.config.annual_return;
  document.getElementById('proj-appreciation').value = data.config.property_appreciation;

  renderMilestones(data.milestones);
  drawProjectionChart(data.series);

  ['proj-dca', 'proj-return', 'proj-appreciation'].forEach((id) => {
    const input = document.getElementById(id);
    input.oninput = debounce(saveProjectionConfig, 500);
  });
}

function renderMilestones(milestones) {
  const row = document.getElementById('milestones-row');
  if (!row) return;
  row.innerHTML = milestones
    .map(
      (m) => `
      <div class="milestone-card">
        <div class="milestone-label">Dans ${m.year} ans</div>
        <div class="milestone-value">${fmt.format(m.total)}</div>
        <div class="milestone-sub">Financier ${fmt.format(m.financial)} · Immo ${fmt.format(m.properties)} · Crédits restants ${fmt.format(m.loans)}</div>
      </div>`
    )
    .join('');
}

function drawProjectionChart(series) {
  const svg = document.getElementById('projection-chart');
  if (!svg || series.length < 2) return;
  const values = series.map((s) => s.total);
  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 600, h = 120, pad = 10;

  const points = series.map((s, i) => {
    const x = pad + (i / (series.length - 1)) * (w - pad * 2);
    const y = h - pad - ((s.total - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });

  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = `<polyline points="${points.join(' ')}" fill="none" stroke="#c6a15b" stroke-width="2" />`;
}

async function saveProjectionConfig() {
  const monthly_dca = Number(document.getElementById('proj-dca').value) || 0;
  const annual_return = Number(document.getElementById('proj-return').value) || 0;
  const property_appreciation = Number(document.getElementById('proj-appreciation').value) || 0;

  await fetch('/api/projection/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthly_dca, annual_return, property_appreciation }),
  });

  const data = await fetch('/api/projection').then((r) => r.json());
  renderMilestones(data.milestones);
  drawProjectionChart(data.series);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
