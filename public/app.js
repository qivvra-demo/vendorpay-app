// VendorPay web client: a thin UI over the REST API. No framework, no build step.
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLE_LABEL = { FINANCE_OPS: 'Finance Ops', FINANCE_APPROVER: 'Finance Approver', PROCUREMENT: 'Procurement', AUDITOR: 'Auditor' };
let session = null;

function loadSession() {
  try { session = JSON.parse(sessionStorage.getItem('vendorpay-session') || 'null'); } catch { session = null; }
}
function saveSession(s) {
  session = s;
  try { s ? sessionStorage.setItem('vendorpay-session', JSON.stringify(s)) : sessionStorage.removeItem('vendorpay-session'); } catch { /* storage unavailable */ }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session) { saveSession(null); showSignIn('Your session has ended. Sign in again.'); }
  if (!res.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: res.status, data });
  return data;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}
const can = (...roles) => session && roles.includes(session.user.role);
const today = () => new Date().toISOString().slice(0, 10);
const dt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/* ---------- Sign-in ---------- */
function showSignIn(message) {
  $('#app').hidden = true; $('#signin').hidden = false;
  $('#signin-error').textContent = message || '';
  $('#username').focus();
}
$('#signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#username').value.trim(), password = $('#password').value;
  if (!username || !password) { $('#signin-error').textContent = 'Enter your username and password.'; return; }
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    saveSession({ token: data.token, user: data.user });
    $('#password').value = '';
    startApp();
  } catch (err) {
    $('#signin-error').textContent = err.status === 401 ? 'Username or password is incorrect.' : 'Sign-in failed. Try again.';
  }
});
$('#signout').addEventListener('click', () => { saveSession(null); location.hash = ''; showSignIn('You have signed out.'); });

/* ---------- Shell ---------- */
async function startApp() {
  $('#signin').hidden = true; $('#app').hidden = false;
  $('#me-name').textContent = session.user.displayName;
  $('#me-role').textContent = ROLE_LABEL[session.user.role] || session.user.role;
  document.querySelectorAll('#nav a').forEach((a) => {
    const roles = a.dataset.roles; a.hidden = !!roles && !roles.split(' ').includes(session.user.role);
  });
  try {
    const v = await api('/version');
    $('#build').textContent = `VendorPay ${v.version} · ${v.environment} · commit ${v.gitSha}`;
  } catch { /* version is informational */ }
  route();
}
window.addEventListener('hashchange', () => session && route());

function route() {
  const [view, id] = (location.hash.replace('#', '') || 'suppliers').split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === view || (view === 'supplier' && a.dataset.view === 'suppliers')));
  const views = { suppliers: viewSuppliers, supplier: () => viewSupplier(id), payments: viewPayments, changes: viewChanges, audit: viewAudit };
  (views[view] || viewSuppliers)().catch((err) => {
    $('#view').innerHTML = `<div class="card empty">${err.status === 403 ? 'Your role does not have access to this page.' : esc(err.message)}</div>`;
  });
}

/* ---------- Suppliers (VP-181, VP-182) ---------- */
async function viewSuppliers() {
  const { suppliers } = await api('/api/suppliers');
  $('#view').innerHTML = `
    <div class="head"><div><h1>Suppliers</h1><p class="muted">Bank details are always shown masked.</p></div></div>
    ${can('PROCUREMENT') ? `
    <form id="supplier-form" class="card form" novalidate>
      <div><label for="s-name">Supplier name</label><input id="s-name" name="name"><div class="field-error" data-for="name"></div></div>
      <div><label for="s-acct">Bank account number</label><input id="s-acct" name="accountNumber" inputmode="numeric"><div class="field-error" data-for="accountNumber"></div></div>
      <div><label for="s-ifsc">IFSC</label><input id="s-ifsc" name="ifsc" placeholder="HDFC0001234"><div class="field-error" data-for="ifsc"></div></div>
      <div class="actions"><button class="primary" type="submit">Onboard supplier</button></div>
    </form>` : ''}
    <table class="tbl" data-testid="suppliers-table">
      <thead><tr><th>Supplier</th><th>Name</th><th>Bank account</th><th>IFSC</th><th>Status</th></tr></thead>
      <tbody>${suppliers.map((s) => `
        <tr class="clickable" data-href="#supplier/${esc(s.id)}">
          <td class="mono">${esc(s.id)}</td><td><b>${esc(s.name)}</b></td>
          <td class="mono">${esc(s.bankAccount ? s.bankAccount.account : '—')}</td><td class="mono">${esc(s.bankAccount ? s.bankAccount.ifsc : '')}</td>
          <td><span class="pill ${esc(s.status)}">${esc(s.status.replace('_', ' '))}</span></td></tr>`).join('')}
      </tbody></table>`;
  bindRows();
  const form = $('#supplier-form');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    form.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
    try {
      const { supplier } = await api('/api/suppliers', { method: 'POST', body });
      toast(`${supplier.id} onboarded. Its bank account now needs Finance verification.`);
      viewSuppliers();
    } catch (err) {
      const d = (err.data && err.data.details) || {};
      Object.entries(d).forEach(([k, v]) => { const el = form.querySelector(`[data-for="${k}"]`); if (el) el.textContent = v; });
      if (!Object.keys(d).length) toast(err.message);
    }
  });
}

async function viewSupplier(id) {
  const { supplier: s } = await api(`/api/suppliers/${encodeURIComponent(id)}`);
  const [{ payments }, { requests }] = await Promise.all([
    api(`/api/payments?supplierId=${encodeURIComponent(id)}`),
    api(`/api/bank-change-requests?supplierId=${encodeURIComponent(id)}`),
  ]);
  const open = requests.find((r) => r.status === 'requested');
  const canRequest = can('PROCUREMENT', 'FINANCE_APPROVER') && s.status === 'active' && !open;
  $('#view').innerHTML = `
    <div class="head"><div><a href="#suppliers" class="muted">← Suppliers</a><h1>${esc(s.name)}</h1><p class="muted mono">${esc(s.id)}</p></div>
      <span class="pill ${esc(s.status)}">${esc(s.status.replace('_', ' '))}</span></div>
    <div class="grid">
      <div class="card"><h3>Bank accounts</h3>
        ${s.bankAccounts.map((a) => `<dl class="kv">
          <dt>Account</dt><dd class="mono">${esc(a.account)}</dd><dt>IFSC</dt><dd class="mono">${esc(a.ifsc)}</dd>
          <dt>Status</dt><dd><span class="pill ${esc(a.status)}">${esc(a.status)}</span></dd>
          <dt>Added by</dt><dd>${esc(a.createdBy)}</dd><dt>Verified by</dt><dd>${esc(a.verifiedBy || '—')}</dd></dl>
          ${a.status === 'pending' && can('FINANCE_APPROVER') ? `<p><button class="primary" data-verify="${a.id}">Verify bank account</button></p>` : ''}`).join('<hr>')}
      </div>
      <div class="card"><h3>Payments</h3><dl class="kv"><dt>Scheduled</dt><dd>${s.payments.scheduled}</dd><dt>Released</dt><dd>${s.payments.released}</dd></dl></div>
    </div>
    <div class="card"><h3>Bank account changes</h3>
      ${requests.length ? changesTable(requests, false) : '<p class="muted">No bank account changes yet.</p>'}
      ${canRequest ? `
      <form id="change-form" class="form" novalidate>
        <div><label for="c-acct">New bank account number</label><input id="c-acct" name="accountNumber" inputmode="numeric"><div class="field-error" data-for="accountNumber"></div></div>
        <div><label for="c-ifsc">IFSC</label><input id="c-ifsc" name="ifsc" placeholder="HDFC0001234"><div class="field-error" data-for="ifsc"></div></div>
        <div><label for="c-reason">Reason</label><input id="c-reason" name="reason" placeholder="Supplier moved banks"><div class="field-error" data-for="reason"></div></div>
        <div class="actions"><button class="primary" type="submit">Request bank change</button></div>
      </form>` : ''}
    </div>
    ${paymentsTable(payments)}`;
  bindChangeForm(id, () => viewSupplier(id));
  bindDecisions(() => viewSupplier(id));
  document.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/suppliers/${encodeURIComponent(id)}/bank-accounts/${b.dataset.verify}/verify`, { method: 'POST' }); toast('Bank account verified. The supplier is now active.'); viewSupplier(id); }
    catch (err) { toast(err.message); }
  }));
  bindRelease(() => viewSupplier(id));
}

/* ---------- Payments (VP-183) ---------- */
function paymentsTable(payments) {
  if (!payments.length) return '<div class="card empty">No payments yet.</div>';
  return `<table class="tbl" data-testid="payments-table">
    <thead><tr><th>Payment</th><th>Supplier</th><th>Amount</th><th>Destination</th><th>Scheduled for</th><th>Status</th><th></th></tr></thead>
    <tbody>${payments.map((p) => `<tr>
      <td class="mono">${esc(p.id)}</td><td>${esc(p.supplierName)}</td><td>${esc(p.currency)} ${esc(p.amount)}</td>
      <td class="mono">${esc(p.destination.account)}</td><td>${esc(p.scheduledFor)}</td>
      <td><span class="pill ${esc(p.status)}">${esc(p.status)}</span></td>
      <td>${p.status === 'scheduled' && can('FINANCE_APPROVER') ? `<button data-release="${esc(p.id)}">Release</button>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
}
function bindRelease(refresh) {
  document.querySelectorAll('[data-release]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/payments/${b.dataset.release}/release`, { method: 'POST' }); toast(`${b.dataset.release} released.`); refresh(); }
    catch (err) { toast(err.message); }
  }));
}
async function viewPayments() {
  const [{ payments }, { suppliers }] = await Promise.all([api('/api/payments'), api('/api/suppliers')]);
  const active = suppliers.filter((s) => s.status === 'active');
  $('#view').innerHTML = `
    <div class="head"><div><h1>Payments</h1><p class="muted">A payment always goes to the bank account that was active when it was scheduled.</p></div></div>
    ${can('FINANCE_OPS') ? `
    <form id="payment-form" class="card form" novalidate>
      <div><label for="p-supplier">Supplier</label><select id="p-supplier" name="supplierId">${active.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.bankAccount.account)})</option>`).join('')}</select><div class="field-error" data-for="supplierId"></div></div>
      <div><label for="p-amount">Amount (INR)</label><input id="p-amount" name="amount" inputmode="decimal"><div class="field-error" data-for="amount"></div></div>
      <div><label for="p-date">Scheduled for</label><input id="p-date" name="scheduledFor" type="date" min="${today()}" value="${today()}"><div class="field-error" data-for="scheduledFor"></div></div>
      <div class="actions"><button class="primary" type="submit">Schedule payment</button></div>
    </form>` : ''}
    ${paymentsTable(payments)}`;
  bindRelease(viewPayments);
  const form = $('#payment-form');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    form.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
    try {
      const { payment } = await api('/api/payments', { method: 'POST', body: { supplierId: f.supplierId, amount: Number(f.amount), scheduledFor: f.scheduledFor } });
      toast(`${payment.id} scheduled to ${payment.destination.account}.`);
      viewPayments();
    } catch (err) {
      const d = (err.data && err.data.details) || {};
      Object.entries(d).forEach(([k, v]) => { const el = form.querySelector(`[data-for="${k}"]`); if (el) el.textContent = v; });
      if (!Object.keys(d).length) toast(err.message);
    }
  });
}

/* ---------- Bank account changes (VP-184) ---------- */
function changesTable(requests, withSupplier) {
  return `<table class="tbl" data-testid="changes-table">
    <thead><tr><th>Request</th>${withSupplier ? '<th>Supplier</th>' : ''}<th>Change</th><th>Reason</th><th>Requested by</th><th>Status</th><th>Decided by</th><th></th></tr></thead>
    <tbody>${requests.map((r) => `<tr>
      <td class="mono">${esc(r.id)}</td>${withSupplier ? `<td><a href="#supplier/${esc(r.supplierId)}">${esc(r.supplierName)}</a></td>` : ''}
      <td class="mono">${esc(r.previousAccount.account)} <span class="arrow">→</span> ${esc(r.newAccount.account)}</td>
      <td>${esc(r.reason)}</td><td>${esc(r.requestedBy)}</td>
      <td><span class="pill ${esc(r.status)}">${esc(r.status)}</span></td><td>${esc(r.decidedBy || '—')}</td>
      <td>${r.status === 'requested' && can('FINANCE_APPROVER') ? `<button class="primary" data-approve="${esc(r.id)}">Approve</button> <button data-reject="${esc(r.id)}">Reject</button>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
}
function bindChangeForm(supplierId, refresh) {
  const form = $('#change-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    form.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
    try {
      const { request } = await api(`/api/suppliers/${encodeURIComponent(supplierId)}/bank-change-requests`, { method: 'POST', body });
      toast(`${request.id} submitted. A Finance Approver must approve it.`);
      refresh();
    } catch (err) {
      const d = (err.data && err.data.details) || {};
      Object.entries(d).forEach(([k, v]) => { const el = form.querySelector(`[data-for="${k}"]`); if (el) el.textContent = v; });
      if (!Object.keys(d).length) toast(err.message);
    }
  });
}
function bindDecisions(refresh) {
  document.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    try { const { request } = await api(`/api/bank-change-requests/${b.dataset.approve}/approve`, { method: 'POST' }); toast(`${request.id} approved. ${request.newAccount.account} is now the active account.`); refresh(); }
    catch (err) { toast(err.message); }
  }));
  document.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
    const note = prompt('Why is this change rejected?');
    if (!note) return;
    try { await api(`/api/bank-change-requests/${b.dataset.reject}/reject`, { method: 'POST', body: { note } }); toast(`${b.dataset.reject} rejected.`); refresh(); }
    catch (err) { toast(err.message); }
  }));
}
async function viewChanges() {
  const { requests } = await api('/api/bank-change-requests');
  const open = requests.filter((r) => r.status === 'requested');
  $('#view').innerHTML = `
    <div class="head"><div><h1>Bank account changes</h1><p class="muted">${open.length} waiting for a Finance Approver. Open a supplier to request a change.</p></div></div>
    ${requests.length ? changesTable(requests, true) : '<div class="card empty">No bank account changes yet.</div>'}`;
  bindDecisions(viewChanges);
}

/* ---------- Audit trail (VP-185) ---------- */
async function viewAudit() {
  const { events } = await api('/api/audit-events?limit=200');
  $('#view').innerHTML = `
    <div class="head"><div><h1>Audit trail</h1><p class="muted">Every supplier and payment change, newest first.</p></div></div>
    <table class="tbl" data-testid="audit-table"><thead><tr><th>When</th><th>Event</th><th>Actor</th><th>Record</th><th>Details</th></tr></thead>
    <tbody>${events.map((e) => `<tr><td>${esc(dt(e.createdAt))}</td><td class="mono">${esc(e.type)}</td><td>${esc(e.actor)}</td>
      <td class="mono">${esc(e.entityId)}</td><td class="mono">${esc(JSON.stringify(e.details))}</td></tr>`).join('')}</tbody></table>`;
}

function bindRows() {
  document.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
}

loadSession();
if (session) startApp(); else showSignIn();
