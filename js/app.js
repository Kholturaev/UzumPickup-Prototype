// Presentation layer: screens for the operator, customer and seller, in English, Uzbek and Russian.

const store = new DataStore('uzum-pickup-prototype-v3');
store.load(seedData);

const notifier = new NotificationService(store, [new SmsChannel(), new WhatsAppChannel(), new PushChannel()]);
const gateway = new TerminalGateway();
const connection = new ConnectionMonitor(store);
const verifier = new PickupCodeVerifier(store);
const offline = new OfflineCacheService(store);
const queue = new SyncQueue(store);
const eligibility = new ReturnEligibilityChecker(store);
const returns = new ReturnService(store, eligibility, new RefundService(store), notifier);
const receiving = new ParcelReceivingService(store, notifier);
const handover = new HandoverService(store, gateway, notifier);
const sync = new SyncService(store, queue, new ConflictResolver(), handover, returns, offline);
const disputes = new DisputeService();
const insights = new ReturnInsightService(store);

let LANG = 'en';
let HINTS = true;
try { HINTS = localStorage.getItem('uzum-pickup-hints') !== '0'; } catch (e) { /* default */ }
try { LANG = localStorage.getItem('uzum-pickup-lang') || 'en'; } catch (e) { /* default */ }

const ui = {
  role: 'operator', operator: null, screen: 'dashboard', loginError: '',
  recv: { id: '', damaged: false, photos: [], result: null },
  hand: null, handError: null, handDone: null,
  ret: null, retResult: null,
  evidenceId: null, evidenceError: '',
  customerId: 'C1', cuTab: 'all', cuOpen: {},
  sellerId: 'S1', sellerTab: 'returns', sellerEvidence: null, sellerLogged: false, spLoginError: false, spSub: 'all',
  toast: '', swMin: false, hints: HINTS
};

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function t(key, vars = {}) {
  let s = (I18N[LANG] && I18N[LANG][key]) ?? I18N.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}
const LOCALE = { en: 'en-GB', uz: 'uz-Latn-UZ', ru: 'ru-RU' };
const money = n => `${Number(n).toLocaleString('ru-RU')} ${t('money')}`;
// Uzbek month and weekday names are written out here because many browsers lack Uzbek date data.
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const UZ_DAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];
const pad = n => String(n).padStart(2, '0');
const time = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const day = ts => { const d = new Date(ts); return LANG === 'uz' ? `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}` : d.toLocaleDateString(LOCALE[LANG], { day: 'numeric', month: 'short' }); };
const when = ts => `${day(ts)}, ${time(ts)}`;
const longDate = ts => { const d = new Date(ts); return LANG === 'uz' ? `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}, ${UZ_DAYS[d.getDay()]}` : d.toLocaleDateString(LOCALE[LANG], { weekday: 'long', day: 'numeric', month: 'long' }); };
const pname = id => t('p.' + id);
const cond = note => (I18N.en['cond.' + note] ? t('cond.' + note) : note);
const pp = () => store.pickupPoint(ui.operator ? ui.operator.pickupPointId : 'PP-CH12');
const save = () => store.save();
const isOffline = () => !connection.online;
const chipFor = s => ({ AT_PICKUP_POINT: 'violet', COLLECTED: 'green', RETURNED: 'amber', PARTLY_RETURNED: 'amber', CANCELLED: 'red' }[s] || '');
const statusChip = s => `<span class="chip ${chipFor(s)}">${esc(t('st.' + s))}</span>`;
const cellTag = code => `<div class="cell-tag pop" role="img" aria-label="${esc(t('cell'))} ${esc(code)}"><span class="lbl">${esc(t('cell'))}</span><span class="num">${esc(code)}</span></div>`;
const noteText = h => h.noteKey ? t(h.noteKey, { ...h.noteVars, product: h.noteVars.product ? pname(h.noteVars.product) : '', reason: h.noteVars.reason ? t('reason.' + h.noteVars.reason) : '' }) : '';
const photosHtml = ps => ps && ps.length ? `<div class="photos">${ps.map(p => `<img src="${p.dataUrl}" alt="${esc(t('photo'))}">`).join('')}</div>` : '';
const err = (key, vars) => `<p class="notice error" role="alert">${esc(t(key, vars || {}))}</p>`;

// ---------- presenter switcher (demo controls only, floats above the apps) ----------
const hint = html => (ui.hints ? html : '');
const langSelect = (cls = '') => `<select class="lang-select ${cls}" data-action="sp-lang" aria-label="${esc(t('sw.lang'))}">${[['en', 'English'], ['uz', 'Oʻzbekcha'], ['ru', 'Русский']].map(([c, l]) => `<option value="${c}" ${LANG === c ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

function renderSwitcher() {
  if (ui.swMin) return `<button class="sw-dot" data-action="sw-toggle" aria-label="${esc(t('sw.open'))}" title="${esc(t('sw.open'))}"><span></span><span></span><span></span></button>`;
  const r = ui.role;
  const roleBtn = (id) => `<button data-action="role" data-role="${id}" aria-pressed="${r === id}">${esc(t('role.' + id))}</button>`;
  const canOutage = r === 'operator' && ui.operator;
  return `<div class="sw" role="toolbar" aria-label="${esc(t('sw.label'))}">
    <div class="sw-roles">${roleBtn('operator')}${roleBtn('customer')}${roleBtn('seller')}</div>
    ${canOutage ? `<button class="sw-btn ${connection.online ? '' : 'warn'}" data-action="connection">${esc(connection.online ? t('conn.goOffline') : t('conn.reconnect'))}</button>` : ''}
    <label class="sw-check"><input type="checkbox" data-action="sw-hints" ${ui.hints ? 'checked' : ''}> ${esc(t('sw.hints'))}</label>
    <button class="sw-btn" data-action="reset">${esc(t('reset'))}</button>
    <button class="sw-btn icon" data-action="sw-toggle" aria-label="${esc(t('sw.hide'))}" title="${esc(t('sw.hide'))}">–</button>
  </div>`;
}

// ---------- operator shell ----------
function renderLogin() {
  const op = store.state.operators[0];
  return `<div class="login"><form class="panel" data-form="login">
    <div class="app-brand"><span class="brand-mark" aria-hidden="true">U</span><span>${esc(t('app.operator'))}</span></div>
    <div><h1>${esc(t('login.title'))}</h1><p class="muted">${esc(t('login.sub'))}</p></div>
    <label class="field">${esc(t('login.point'))}<input class="input" value="${esc(pp().name)}" disabled></label>
    <label class="field">${esc(t('login.operator'))}<input class="input" value="${esc(op.name)}" disabled></label>
    <label class="field">PIN<input class="input" id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="••••"></label>
    ${ui.loginError ? err(ui.loginError) : ''}
    <button class="btn big" type="submit">${esc(t('login.button'))}</button>
    ${hint(`<p class="muted small">${esc(t('login.demo'))}</p>`)}
    <label class="field">${esc(t('sw.lang'))}${langSelect('input')}</label>
  </form></div>`;
}

function connectionPill() {
  return connection.online
    ? `<span class="conn online"><span class="dot"></span>${esc(t('conn.online'))}</span>`
    : `<span class="conn offline"><span class="dot"></span>${esc(t('conn.offlineSince', { time: time(connection.since) }))}</span>`;
}

function opNav() {
  const p = pp();
  const arriving = store.orders().filter(o => o.pickupPointId === p.id && o.status === OrderStatus.IN_TRANSIT).length;
  const queued = queue.actions.length;
  const item = (id, label, badge) => `<button data-action="screen" data-screen="${id}" ${ui.screen === id ? 'aria-current="page"' : ''}>${esc(label)}${badge ? `<span class="count">${badge}</span>` : ''}</button>`;
  return `<aside class="rail">
    <div class="app-brand"><span class="brand-mark" aria-hidden="true">U</span><span>${esc(t('app.operator'))}</span></div>
    <div class="who"><strong>${esc(ui.operator.name)}</strong><div class="muted small">${esc(t('point', { name: p.name }))}</div><div style="margin-top:8px">${connectionPill()}</div></div>
    ${item('dashboard', t('nav.dashboard'))}
    ${item('receive', t('nav.receive'), arriving || '')}
    ${item('handover', t('nav.handover'))}
    ${item('return', t('nav.return'))}
    <hr class="rail-sep">
    ${item('sync', t('nav.sync'), queued || '')}
    ${item('evidence', t('nav.evidence'))}
    <div class="bottom">
      ${langSelect('input')}
      <button class="link-btn small" data-action="logout">${esc(t('logout'))}</button>
    </div>
  </aside>`;
}

function offlineBanner() {
  if (connection.online) return '';
  return `<div class="banner" role="status"><strong>${esc(t('banner.title'))}</strong> ${esc(t('banner.text', { time: time(offline.cache.savedAt), n: queue.actions.length }))}</div>`;
}

function head(title, sub) {
  return `${offlineBanner()}<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div></div>`;
}

// ---------- dashboard ----------
function renderDashboard() {
  const p = pp();
  const mine = store.orders().filter(o => o.pickupPointId === p.id);
  const arriving = mine.filter(o => o.status === OrderStatus.IN_TRANSIT).length;
  const stored = mine.filter(o => o.status === OrderStatus.AT_PICKUP_POINT);
  const unpaid = stored.filter(o => !o.isPaid()).length;
  const cache = offline.cache;
  const ageH = Math.floor((Date.now() - cache.savedAt) / 3600000);
  const damaged = mine.filter(o => o.evidence.some(e => e.damaged && e.stage === EvidenceStage.RECEIPT) && o.status === OrderStatus.AT_PICKUP_POINT);
  const recentReturns = store.state.returns.filter(r => r.accepted && Date.now() - r.createdAt < 7 * DAY).length;
  return `${head(t('dash.hello', { name: ui.operator.name.split(' ')[0] }), longDate(Date.now()))}
  <div class="stats">
    <div class="stat"><b>${arriving}</b><span>${esc(t('dash.arriving'))}</span></div>
    <div class="stat"><b>${stored.length}</b><span>${esc(t('dash.stored'))}</span></div>
    <div class="stat"><b>${unpaid}</b><span>${esc(t('dash.unpaid'))}</span></div>
  </div>
  <div class="grid2">
    <section class="panel feature">
      <h2>${esc(t('sol1.title'))}</h2>
      <p class="muted">${esc(t('sol1.text'))}</p>
      <div class="kv"><span>${esc(t('dash.listSaved'))}</span><b>${time(cache.savedAt)}${ageH >= 3 ? ` <span class="chip amber">${esc(t('dash.listOld', { h: ageH }))}</span>` : ''}</b></div>
      <div class="kv"><span>${esc(t('dash.listOrders'))}</span><b>${cache.entries.length}</b></div>
      <div class="kv"><span>${esc(t('dash.queued'))}</span><b>${queue.actions.length}</b></div>
      <div class="actions"><button class="btn secondary" data-action="refresh-list" ${isOffline() ? 'disabled' : ''}>${esc(t('dash.refresh'))}</button><button class="btn secondary" data-action="screen" data-screen="sync">${esc(t('nav.sync'))}</button></div>
    </section>
    <section class="panel feature">
      <h2>${esc(t('sol2.title'))}</h2>
      <p class="muted">${esc(t('sol2.text'))}</p>
      ${damaged.map(o => `<div class="kv"><span><span class="chip red">${esc(t('dash.damaged'))}</span> ${esc(o.id)}</span><button class="link-btn" data-action="open-evidence" data-id="${esc(o.id)}">${esc(t('dash.viewEvidence'))}</button></div>`).join('')}
      <div class="kv"><span>${esc(t('dash.returnsWeek'))}</span><b>${recentReturns}</b></div>
      <div class="actions"><button class="btn secondary" data-action="screen" data-screen="evidence">${esc(t('nav.evidence'))}</button></div>
    </section>
  </div>
  <section class="panel" style="margin-top:16px"><h3>${esc(t('dash.tasks'))}</h3>
    <div class="task-row">
      <button class="btn" data-action="screen" data-screen="handover">${esc(t('nav.handover'))}</button>
      <button class="btn secondary" data-action="screen" data-screen="receive">${esc(t('nav.receive'))}</button>
      <button class="btn secondary" data-action="screen" data-screen="return">${esc(t('nav.return'))}</button>
    </div></section>`;
}

// ---------- receive ----------
function renderReceive() {
  const p = pp();
  const expected = store.orders().filter(o => o.pickupPointId === p.id && o.status === OrderStatus.IN_TRANSIT);
  const r = ui.recv;
  if (isOffline()) return `${head(t('nav.receive'), t('recv.sub'))}<section class="panel"><p class="notice warn" style="margin-top:0">${esc(t('recv.offline'))}</p></section>`;
  let result = '';
  if (r.result && r.result.ok) {
    const o = r.result.order, c = store.customer(o.customerId);
    result = `<section class="panel result"><div class="cell-row">${cellTag(r.result.cell.code)}<div>
      <h2>${esc(t('recv.putIn', { order: o.id, cell: r.result.cell.code }))}</h2>
      <p class="muted">${esc(t('recv.deadline', { date: when(o.deadline), days: r.result.days }))}</p>
      <p class="notice ok">${esc(t('recv.notified', { name: c.name, channels: r.result.sent.map(s => t('ch.' + s)).join(', ') }))}</p>
      ${o.evidence[o.evidence.length - 1].damaged ? `<p class="notice warn">${esc(t('recv.damageSaved'))}</p>` : ''}
    </div></div></section>`;
  }
  return `${head(t('nav.receive'), t('recv.sub'))}
  <div class="grid-work">
    <section class="panel">
      <form data-form="receive" class="form">
        <ol class="steps-inline"><li><b>1</b>${esc(t('recv.s1'))}</li><li><b>2</b>${esc(t('recv.s2'))}</li><li><b>3</b>${esc(t('recv.s3'))}</li></ol>
        <label class="field">${esc(t('recv.number'))}<input class="input code-input" id="parcelId" value="${esc(r.id)}" placeholder="UZ-10421" autocomplete="off"></label>
        <fieldset class="field"><legend>${esc(t('recv.condition'))}</legend>
          <div class="choice">
            <label><input type="radio" name="cond" value="ok" ${!r.damaged ? 'checked' : ''} data-action="recv-cond"> ${esc(t('recv.ok'))}</label>
            <label><input type="radio" name="cond" value="damaged" ${r.damaged ? 'checked' : ''} data-action="recv-cond"> ${esc(t('recv.damaged'))}</label>
          </div></fieldset>
        ${r.damaged ? `<label class="field">${esc(t('recv.photo'))}<input class="input" type="file" id="recvPhotos" accept="image/*" multiple></label>${photosHtml(r.photos)}` : ''}
        <button class="btn big" type="submit">${esc(t('recv.button'))}</button>
      </form>
      ${r.result && !r.result.ok ? err(r.result.key) : ''}
    </section>
    <section class="panel"><h2>${esc(t('recv.expected'))}</h2>
      ${expected.length ? `<ul class="list">${expected.map(o => `<li><span class="grow"><b>${esc(o.id)}</b><br><span class="muted small">${o.lines.map(l => esc(pname(l.productId))).join(', ')}</span></span><button class="btn secondary" data-action="pick-parcel" data-id="${esc(o.id)}">${esc(t('recv.select'))}</button></li>`).join('')}</ul>`
        : `<p class="muted" style="margin-top:10px">${esc(t('recv.allDone'))}</p>`}
      ${hint(`<p class="muted small" style="margin-top:12px">${esc(t('recv.tryWrong'))}</p>`)}
    </section>
  </div>${result}`;
}

// ---------- handover ----------
function stepper(active) {
  const steps = ['ho.s1', 'ho.s2', 'ho.s3', 'ho.s4'];
  return `<ol class="stepper">${steps.map((k, i) => `<li class="${i < active ? 'done' : i === active ? 'now' : ''}"><span>${i + 1}</span>${esc(t(k))}</li>`).join('')}</ol>`;
}

function demoCodes() {
  const list = isOffline()
    ? offline.cache.entries.map(e => e.code)
    : store.orders().filter(o => o.pickupPointId === 'PP-CH12' && [OrderStatus.AT_PICKUP_POINT].includes(o.status)).map(o => o.pickupCode.value).concat(['104552', '900311']);
  return `<p class="muted small" style="margin-top:14px">${esc(t('ho.demoCodes'))}</p><div class="demo-codes">${list.map(c => `<button type="button" data-action="fill-code" data-code="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
}

function renderHandover() {
  if (ui.handDone) {
    const d = ui.handDone, o = store.order(d.orderId);
    return `${head(t('ho.doneTitle'))}${stepper(4)}<section class="panel">
      ${d.offline ? `<p class="notice warn" style="margin-top:0">${esc(t('ho.doneOffline', { order: o.id }))}</p>` : `<p class="notice ok" style="margin-top:0">${esc(t('ho.done', { order: o.id, name: store.customer(o.customerId).name }))}</p>`}
      ${d.rejected.length ? `<p class="notice info">${esc(t('ho.rejectedNote', { n: d.rejected.length }))}</p><div class="actions"><button class="btn" data-action="start-return" data-id="${esc(o.id)}" data-line="${esc(d.rejected[0])}" data-reason="NOT_AS_DESCRIBED">${esc(t('ho.toReturn'))}</button></div>` : ''}
      <div class="actions"><button class="btn secondary" data-action="hand-reset">${esc(t('ho.next'))}</button></div></section>`;
  }
  const h = ui.hand;
  if (!h) {
    return `${head(t('nav.handover'), isOffline() ? t('ho.subOffline') : t('ho.sub'))}${stepper(0)}
    <section class="panel narrow"><form data-form="verify" class="form">
      <label class="field">${esc(t('ho.code'))}<input class="input code-input" id="code" inputmode="numeric" maxlength="12" placeholder="000000" autocomplete="off"></label>
      <button class="btn big" type="submit">${esc(t('ho.check'))}</button></form>
      ${ui.handError ? err(ui.handError.key, ui.handError.vars ? { time: when(ui.handError.vars.time) } : {}) : ''}
      ${hint(demoCodes())}</section>`;
  }
  const o = store.order(h.orderId), cust = store.customer(o.customerId);
  const kept = o.lines.filter(l => h.decisions[l.id] !== 'reject');
  const due = o.isPaid() ? 0 : kept.reduce((s, l) => s + l.subtotal(), 0);
  const needsPay = due > 0 && !h.paid;
  const stepNow = needsPay ? 2 : 3;
  return `${head(t('nav.handover'), isOffline() ? t('ho.checkedOffline') : t('ho.checked'))}${stepper(stepNow)}
  <div class="grid-work">
    <section class="panel">
      <div class="cell-row">${cellTag(o.cellCode)}<div><h2>${esc(o.id)}</h2><p>${esc(t('ho.askName'))} <b>${esc(cust.name)}</b></p>
      ${o.evidence.some(e => e.damaged) ? `<span class="chip red">${esc(t('ho.damagedOnArrival'))}</span>` : ''}</div></div>
      <h3 style="margin-top:20px">${esc(t('ho.inspect'))}</h3><p class="muted small">${esc(t('ho.inspectHelp'))}</p>
      <div class="items">${o.lines.map(l => { const d = h.decisions[l.id] || 'keep';
        return `<div class="item"><span class="grow">${esc(pname(l.productId))}<br><span class="muted small">${money(l.subtotal())}</span></span>
        <span class="toggle" role="group"><button class="keep" data-action="decide" data-line="${esc(l.id)}" data-val="keep" aria-pressed="${d === 'keep'}">${esc(t('ho.keeps'))}</button><button class="reject" data-action="decide" data-line="${esc(l.id)}" data-val="reject" aria-pressed="${d === 'reject'}">${esc(t('ho.rejects'))}</button></span></div>`; }).join('')}</div>
    </section>
    <section class="panel">
      <h3>${esc(t('ho.payment'))}</h3>
      ${o.isPaid() ? `<p class="notice ok">${esc(t('ho.paidAlready', { method: t('pay.' + o.payment.method) }))}</p>`
        : due === 0 ? `<p class="notice ok">${esc(t('ho.nothingToPay'))}</p>`
        : h.paid ? `<p class="notice ok">${esc(t('ho.paidNow', { amount: money(due), method: t('pay.' + h.paid) }))}</p>`
        : `<p class="amount">${money(due)}</p>
          <div class="pay-options"><button class="btn secondary" data-action="pay" data-method="CASH">${esc(t('ho.cash'))}</button>
          <button class="btn secondary" data-action="pay" data-method="COUNTER_CARD" ${isOffline() ? 'disabled' : ''}>${esc(t('ho.card'))}</button></div>
          ${isOffline() ? `<p class="muted small" style="margin-top:8px">${esc(t('ho.cardOffline'))}</p>` : hint(`<label class="check small" style="margin-top:10px"><input type="checkbox" id="declineNext" data-action="toggle-decline" ${gateway.declineNext ? 'checked' : ''}> ${esc(t('ho.simDecline'))}</label>`)}
          ${h.payError ? err(h.payError) : ''}`}
      <div class="actions" style="margin-top:18px"><button class="btn big" data-action="confirm" ${needsPay ? 'disabled' : ''}>${esc(t('ho.confirm'))}</button>
      <button class="btn secondary" data-action="hand-reset">${esc(t('cancel'))}</button></div>
    </section>
  </div>`;
}

// ---------- returns ----------
const CONDITIONS = ['unusedTags', 'usedNoDamage', 'itemDamaged', 'differsFromPhoto'];

function renderReturn() {
  const sub = t('ret.sub');
  if (ui.retResult) {
    const r = ui.retResult;
    let body;
    if (r.queued) body = `<p class="notice warn" style="margin-top:0">${esc(t('ret.queued'))}</p>`;
    else if (r.accepted) body = `<p class="notice ok" style="margin-top:0">${esc(t('ret.accepted', { product: pname(store.order(r.returnRequest.orderId).lines.find(l => l.id === r.returnRequest.lineId).productId) }))}</p>
      <div class="kv"><span>${esc(t('ret.refund'))}</span><b>${esc(t(r.policy.key))}</b></div>
      ${r.refund.status === 'COMPLETED' ? '' : `<div class="kv"><span>${esc(t('ret.expected'))}</span><b>${day(r.refund.expectedAt)}</b></div>`}
      <p class="muted" style="margin-top:10px">${esc(t('ret.sellerSees'))}</p>
      <div class="actions"><button class="btn secondary" data-action="open-evidence" data-id="${esc(r.returnRequest.orderId)}">${esc(t('dash.viewEvidence'))}</button></div>`;
    else body = err(r.key, r.vars ? { category: t('cat.' + r.vars.category) } : {}) + `<p class="muted" style="margin-top:10px">${esc(t('ret.stays'))}</p>`;
    return `${head(t('nav.return'), sub)}<section class="panel narrow">${body}<div class="actions"><button class="btn secondary" data-action="ret-reset">${esc(t('ret.next'))}</button></div></section>`;
  }
  const r = ui.ret;
  if (r && r.orderId) {
    const o = store.order(r.orderId);
    const line = o.lines.find(l => l.id === r.lineId) || o.lines.find(l => !l.returned);
    const check = eligibility.check(o, line, r.reason);
    return `${head(t('nav.return'), sub)}
    <section class="panel narrow"><h2>${esc(o.id)}</h2><p class="muted">${esc(store.customer(o.customerId).name)} · ${esc(o.isPaid() ? t('pay.' + o.payment.method) : t('ret.notPaid'))}${o.collectedAt() ? ' · ' + esc(t('ret.collectedOn', { date: day(o.collectedAt()) })) : ''}</p>
      <form data-form="return" class="form" style="margin-top:16px">
        <label class="field">${esc(t('ret.item'))}<select class="input" id="retLine" data-action="ret-change">${o.lines.map(l => `<option value="${esc(l.id)}" ${line && l.id === line.id ? 'selected' : ''} ${l.returned ? 'disabled' : ''}>${esc(pname(l.productId))}${l.returned ? ' (' + esc(t('st.RETURNED')) + ')' : ''}</option>`).join('')}</select></label>
        <label class="field">${esc(t('ret.reason'))}<select class="input" id="retReason" data-action="ret-change">${Object.keys(ReturnReason).map(k => `<option value="${k}" ${k === r.reason ? 'selected' : ''}>${esc(t('reason.' + k))}</option>`).join('')}</select></label>
        <label class="field">${esc(t('ret.condition'))}<select class="input" id="retCond" data-action="ret-change">${CONDITIONS.map(c => `<option value="${c}" ${c === r.condition ? 'selected' : ''}>${esc(t('cond.' + c))}</option>`).join('')}</select></label>
        <label class="field">${esc(t('ret.photos'))}<input class="input" type="file" id="retPhotos" accept="image/*" multiple></label>
        ${photosHtml(r.photos)}
        ${r.photoError ? err('err.returnPhoto') : ''}
        ${check.ok ? `<p class="notice ok" style="margin-top:0">${esc(t('ret.eligible'))}</p>` : err(check.key, check.vars ? { category: t('cat.' + check.vars.category) } : {})}
        <button class="btn big" type="submit">${esc(t('ret.submit'))}</button>
      </form></section>`;
  }
  const recent = store.orders().filter(o => o.pickupPointId === pp().id && [OrderStatus.COLLECTED, OrderStatus.PARTLY_RETURNED].includes(o.status) && o.collectedAt() && Date.now() - o.collectedAt() < 15 * DAY).sort((a, b) => b.collectedAt() - a.collectedAt()).slice(0, 5);
  return `${head(t('nav.return'), sub)}<div class="grid-work">
    <section class="panel"><form data-form="find-return" class="form">
      <label class="field">${esc(t('ret.find'))}<input class="input code-input" id="retFind" placeholder="UZ-10377" autocomplete="off"></label>
      <button class="btn big" type="submit">${esc(t('ret.findBtn'))}</button></form>
      ${r && r.error ? err(r.error) : ''}</section>
    <section class="panel"><h2>${esc(t('ret.recent'))}</h2><ul class="list">${recent.map(o => `<li><span class="grow"><b>${esc(o.id)}</b><br><span class="muted small">${esc(t('ret.collectedOn', { date: day(o.collectedAt()) }))}</span></span><button class="btn secondary" data-action="start-return" data-id="${esc(o.id)}">${esc(t('recv.select'))}</button></li>`).join('')}</ul>
      ${hint(`<p class="muted small" style="margin-top:10px">${esc(t('ret.tryOld'))}</p>`)}</section></div>`;
}

// ---------- evidence (Headline 2) ----------
function evidenceView(o, readOnly = false) {
  const v = disputes.summary(o);
  const tone = ['verdict.none', 'verdict.noRecords'].includes(v.key) ? 'ok' : 'warn';
  const recs = o.evidence.slice().sort((a, b) => a.at - b.at);
  return `<div class="verdict ${tone}"><span class="verdict-label">${esc(t('ev.finding'))}</span><p>${esc(t(v.key))}</p></div>
    <ol class="evidence">${recs.map(r => {
      const line = r.lineId ? o.lines.find(l => l.id === r.lineId) : null;
      return `<li class="${r.damaged ? 'bad' : 'good'}"><div class="ev-head"><b>${esc(t('stage.' + r.stage))}</b><span class="chip ${r.damaged ? 'red' : 'green'}">${esc(r.damaged ? t('ev.problem') : t('ev.ok'))}</span></div>
        <p class="small">${line ? esc(pname(line.productId)) + ' · ' : ''}${esc(cond(r.note))}</p>
        <p class="muted small">${when(r.at)} · ${esc(r.recordedBy)}</p>${photosHtml(r.photos)}</li>`; }).join('')}</ol>`;
}

function renderEvidence() {
  const o = ui.evidenceId ? store.order(ui.evidenceId) : null;
  const cases = store.orders().filter(x => x.pickupPointId === pp().id && x.evidence.some(e => e.damaged || e.stage === EvidenceStage.RETURN))
    .sort((a, b) => b.history[b.history.length - 1].at - a.history[a.history.length - 1].at).slice(0, 6);
  return `${head(t('nav.evidence'), t('ev.sub'))}
  <div class="grid-work">
    <section class="panel">${o ? `<div class="page-head" style="margin-bottom:12px"><h2>${esc(o.id)}</h2>${statusChip(o.status)}</div>${evidenceView(o)}`
      : `<p class="muted">${esc(t('ev.pick'))}</p>`}</section>
    <section class="panel"><form data-form="find-evidence" class="form"><label class="field">${esc(t('ev.find'))}<input class="input" id="evFind" placeholder="UZ-10407" autocomplete="off"></label><button class="btn" type="submit">${esc(t('ev.open'))}</button></form>
      ${ui.evidenceError ? err(ui.evidenceError) : ''}
      <h3 style="margin-top:18px">${esc(t('ev.cases'))}</h3><ul class="list">${cases.map(c => `<li><span class="grow"><b>${esc(c.id)}</b><br><span class="muted small">${esc(t(disputes.summary(c).key + '.short'))}</span></span><button class="btn secondary" data-action="open-evidence" data-id="${esc(c.id)}">${esc(t('ev.open'))}</button></li>`).join('')}</ul></section>
  </div>`;
}

// ---------- sync centre (Headline 1) ----------
function renderSync() {
  const cache = offline.cache, log = store.state.syncLog;
  const actionLabel = a => t('act.' + a.type, { order: a.orderId });
  const outcome = { SYNCED: 'green', CONFLICT: 'red', REJECTED: 'amber' };
  return `${head(t('nav.sync'), t('sync.sub'))}
  <div class="grid2">
    <section class="panel"><h3>${esc(t('sync.list'))}</h3>
      <div class="kv"><span>${esc(t('dash.listSaved'))}</span><b>${when(cache.savedAt)}</b></div>
      <div class="kv"><span>${esc(t('dash.listOrders'))}</span><b>${cache.entries.length}</b></div>
      <div class="kv"><span>${esc(t('sync.usedOffline'))}</span><b>${cache.entries.filter(e => e.used).length}</b></div>
      <ul class="list">${cache.entries.map(e => `<li><span class="grow"><b>${esc(e.cellCode)}</b> ${esc(e.orderId)} · ${esc(e.customerName)}</span>${e.used ? `<span class="chip amber">${esc(t('sync.handedOffline'))}</span>` : ''}</li>`).join('')}</ul>
    </section>
    <section class="panel"><h3>${esc(t('sync.queue'))}</h3>
      ${queue.actions.length ? `<ul class="list">${queue.actions.map(a => `<li><span class="grow">${esc(actionLabel(a))}</span><span class="muted small">${time(a.at)}</span></li>`).join('')}</ul>` : `<p class="muted" style="margin-top:8px">${esc(t('sync.empty'))}</p>`}
      ${log ? `<h3 style="margin-top:18px">${esc(t('sync.lastSync', { time: when(log.at) }))}</h3>
        ${log.results.length ? `<ul class="list">${log.results.map(r => `<li class="result-row"><span class="chip ${outcome[r.outcome]}">${esc(t('out.' + r.outcome))}</span><span class="grow small">${esc(t(r.messageKey, { ...r.vars, cancelledAt: r.vars.cancelledAt ? time(r.vars.cancelledAt) : '', handedAt: r.vars.handedAt ? time(r.vars.handedAt) : '', amount: r.vars.amount ? money(r.vars.amount) : '', reasonKey: r.vars.reasonKey ? t(r.vars.reasonKey) : '' }))}</span></li>`).join('')}</ul>` : `<p class="muted">${esc(t('sync.nothing'))}</p>`}` : ''}
    </section>
  </div>`;
}

function renderOperator() {
  if (!ui.operator) return renderLogin();
  const screens = { dashboard: renderDashboard, receive: renderReceive, handover: renderHandover, return: renderReturn, evidence: renderEvidence, sync: renderSync };
  return `<div class="op">${opNav()}<main class="main">${screens[ui.screen]()}</main></div>`;
}

// ---------- customer (web page in the style of the marketplace's "My orders") ----------
const ICON = {
  pin: '<path d="M12 21s-6-5.6-6-10a6 6 0 1 1 12 0c0 4.4-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1.2-3.6 4-5.2 7-5.2s5.8 1.6 7 5.2"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  bag: '<path d="M5.5 8h13l-1 12h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
  shield: '<path d="M12 3l7 3v5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V6z"/><path d="M9 12l2 2 4-4"/>'
};
const icon = (name, size = 20) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

// Simple illustrated product pictures (own drawings)
function productThumb(pid, size = 72) {
  const art = {
    P1: ['#DCE6F2', '<path d="M22 18l8-4h12l8 4 9 8-7 7-5-4v28H25V29l-5 4-7-7z" fill="#6F8FBF"/><path d="M30 14q6 7 12 0" stroke="#3E5C8A" stroke-width="2" fill="none"/>'],
    P2: ['#E3E8F0', '<path d="M24 12h24l3 48h-11l-4-30-4 30H21z" fill="#3D5A80"/><path d="M24 18h24" stroke="#2A4060" stroke-width="2"/>'],
    P3: ['#F1E7DA', '<path d="M20 20l10-6h12l10 6 7 22-7 2-3-12v26H23V32l-3 12-7-2z" fill="#B5835A"/><path d="M23 50h26M23 46h26" stroke="#8E6040" stroke-width="2"/>'],
    P4: ['#ECE8F6', '<circle cx="26" cy="40" r="9" fill="#3B3650"/><circle cx="46" cy="40" r="9" fill="#3B3650"/><path d="M26 31q10-20 20 0" stroke="#3B3650" stroke-width="4" fill="none"/>'],
    P5: ['#E7F1EC', '<rect x="25" y="12" width="22" height="46" rx="6" fill="#2F8F6B"/><circle cx="31" cy="19" r="2.5" fill="#E7F1EC"/>'],
    P6: ['#EAF4E6', '<rect x="29" y="12" width="14" height="7" rx="2" fill="#7A9A5B"/><path d="M26 22h20l2 36H24z" fill="#98C07A"/><path d="M30 36q6-6 12 0" stroke="#fff" stroke-width="2" fill="none"/>'],
    P7: ['#F3EDF7', '<path d="M24 12h10v28l8 8-5 6-13-11z" fill="#6E4E8C"/><path d="M38 12h10v28l8 8-5 6-13-11z" fill="#9572B5"/>'],
    P8: ['#EEF0F2', '<path d="M26 14l6 2-2 30h-4z" fill="#9AA3AD"/><rect x="25" y="46" width="6" height="12" rx="2" fill="#3C3C3C"/><path d="M40 14l6 2-2 30h-4z" fill="#9AA3AD"/><rect x="39" y="46" width="6" height="12" rx="2" fill="#3C3C3C"/>']
  }[pid] || ['#EEE', ''];
  return `<svg class="thumb" width="${size}" height="${size}" viewBox="0 0 72 72" role="img" aria-label="${esc(pname(pid))}"><rect width="72" height="72" rx="8" fill="${art[0]}"/>${art[1]}</svg>`;
}

function fakeQr(code) {
  let h = 0; for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const n = 21, s = 7; let cells = '';
  const finder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let on;
    if (finder(x, y)) { const fx = x >= n - 7 ? x - (n - 7) : x, fy = y >= n - 7 ? y - (n - 7) : y; on = fx === 0 || fy === 0 || fx === 6 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4); }
    else { h = (h * 1103515245 + 12345) >>> 0; on = (h >> 16) & 1; }
    if (on) cells += `<rect x="${x * s}" y="${y * s}" width="${s}" height="${s}"/>`;
  }
  return `<svg width="148" height="148" viewBox="0 0 ${n * s} ${n * s}" role="img" aria-label="QR"><rect width="100%" height="100%" fill="#fff"/><g fill="#1D1B26">${cells}</g></svg>`;
}

const cuOpen = id => (ui.cuOpen[id] = ui.cuOpen[id] || {});
const ACTIVE = [OrderStatus.CONFIRMED, OrderStatus.IN_TRANSIT, OrderStatus.AT_PICKUP_POINT];

function deliveryLine(o) {
  const last = o.history[o.history.length - 1];
  if (o.status === OrderStatus.AT_PICKUP_POINT) return t('cu.when.AT_PICKUP_POINT', { date: when(o.deadline) });
  if (o.status === OrderStatus.IN_TRANSIT || o.status === OrderStatus.CONFIRMED) return t('cu.when.IN_TRANSIT');
  if (o.status === OrderStatus.COLLECTED) return t('cu.when.COLLECTED', { date: day(o.collectedAt()) });
  return t('cu.when.' + o.status, { date: day(last.at) });
}

function orderCard(o) {
  const st = cuOpen(o.id);
  const pp = store.pickupPoint(o.pickupPointId);
  const cust = store.customer(o.customerId);
  const placed = o.history[0].at;
  const rets = store.state.returns.filter(r => r.orderId === o.id && r.accepted);
  const canShowCode = o.status === OrderStatus.AT_PICKUP_POINT && o.pickupCode.isValid();
  const headBtn = canShowCode
    ? `<button class="cu-btn primary" data-action="cu-toggle" data-id="${esc(o.id)}" data-part="code">${icon('qr', 18)} ${esc(t(st.code ? 'cu.hideCode' : 'cu.showCode'))}</button>`
    : '';
  const products = o.lines.length;
  return `<article class="cu-card">
    <header class="cu-card-head">
      <div>
        <span class="cu-badge ${o.status === OrderStatus.AT_PICKUP_POINT ? 'ready' : o.status === OrderStatus.CANCELLED ? 'cancel' : ''}">${esc(t('st.' + o.status))}</span>
        <h3 class="cu-num">${esc(t('cu.order', { id: o.id }))} <button class="cu-icon-btn" data-action="cu-copy" data-id="${esc(o.id)}" title="${esc(t('cu.copy'))}" aria-label="${esc(t('cu.copy'))}">${icon('copy', 16)}</button></h3>
        <p class="cu-date">${esc(when(placed))}</p>
      </div>${headBtn}
    </header>
    ${st.code && canShowCode ? `<div class="cu-code">${fakeQr(o.pickupCode.value)}<div><p class="cu-code-num">${esc(o.pickupCode.value)}</p>
      <p>${esc(t('cust.showAt', { point: pp.name }))}</p><p class="muted">${esc(t('cust.collectBy', { date: when(o.deadline) }))}</p>
      ${!o.isPaid() ? `<p class="cu-pay">${esc(t('cust.payAtCounter', { amount: money(o.total()) }))}</p>` : ''}
      <p class="muted small" style="margin-top:8px">${icon('shield', 14)} ${esc(t('cu.codeOnce'))}</p>
      <button class="link-btn small" data-action="cust-cancel" data-id="${esc(o.id)}">${esc(t('cust.cancel'))}</button></div></div>` : ''}
    <div class="cu-body">
      <p class="cu-when">${esc(deliveryLine(o))}</p>
      <div class="cu-thumbs">${o.lines.map(l => productThumb(l.productId)).join('')}</div>
      <p class="cu-sum">${esc(t('cu.items', { n: products, amount: money(o.total()) }))}</p>
      <dl class="cu-grid">
        <dt>${esc(t('cu.pickupPoint'))}</dt><dd>${esc(pp.address)}<br><span class="muted small">${esc(pp.name)}${o.cellCode && o.status === OrderStatus.AT_PICKUP_POINT ? '' : ''}</span></dd>
        <dt>${esc(t('cu.recipient'))}</dt><dd>${esc(cust.name)}<br>${esc(cust.phone)}</dd>
        <dt>${esc(t('cu.total'))}</dt><dd>${money(o.total())}<br>
          <button class="cu-link" data-action="cu-toggle" data-id="${esc(o.id)}" data-part="details">${esc(t('cu.details'))} ${icon('chevron', 14)}</button>
          ${st.details ? `<div class="cu-details"><span>${esc(t('cu.payment'))}: ${esc(t('pay.' + o.payment.method))}</span><span>${esc(o.isPaid() ? t('cu.paid') : t('cu.toPay'))}</span></div>` : ''}</dd>
      </dl>
      ${rets.map(r => { const rf = store.state.refunds.find(f => f.returnId === r.id); const line = o.lines.find(l => l.id === r.lineId);
        return `<div class="cu-return"><div><b>${esc(t('cu.returnTitle'))}: ${esc(pname(line.productId))}</b><p class="small muted">${esc(t('reason.' + r.reason))}</p></div>
        ${rf ? `<div class="cu-refund"><span>${money(rf.amount)}</span> <span class="chip ${rf.status === 'COMPLETED' ? 'green' : 'violet'}">${esc(t('rf.' + rf.status))}</span><p class="small muted">${esc(t(rf.status === 'COMPLETED' ? 'cust.refunded' : 'cust.expectedBy', { date: day(rf.expectedAt) }))}</p></div>` : ''}</div>`; }).join('')}
      <div class="cu-links">
        <button class="cu-link" data-action="cu-toggle" data-id="${esc(o.id)}" data-part="history">${icon('clock', 16)} ${esc(t(st.history ? 'cu.hideHistory' : 'cu.history'))}</button>
        ${o.evidence.length ? `<button class="cu-link" data-action="cu-toggle" data-id="${esc(o.id)}" data-part="records">${icon('shield', 16)} ${esc(t(st.records ? 'cu.hideRecords' : 'cu.records'))}</button>` : ''}
      </div>
      ${st.history ? `<ul class="timeline">${o.history.slice().reverse().map(h => `<li><b>${esc(t('st.' + h.status))}</b><br><span class="muted small">${when(h.at)}${h.noteKey ? ' · ' + esc(noteText(h)) : ''}</span></li>`).join('')}</ul>` : ''}
      ${st.records ? `<div class="cu-records">${evidenceView(o, true)}</div>` : ''}
    </div>
    <section class="cu-products">
      <button class="cu-products-head" data-action="cu-toggle" data-id="${esc(o.id)}" data-part="products" aria-expanded="${!!st.products}">${esc(t('cu.products', { n: products }))} <span class="cu-chev ${st.products ? 'up' : ''}">${icon('chevron', 18)}</span></button>
      ${st.products ? o.lines.map(l => `<div class="cu-product">${productThumb(l.productId, 84)}
        <dl class="cu-grid compact"><dt>${esc(t('cu.name'))}</dt><dd>${esc(pname(l.productId))}</dd><dt>${esc(t('cu.qty'))}</dt><dd>${l.qty}</dd><dt>${esc(t('cu.price'))}</dt><dd>${money(l.subtotal())}</dd></dl>
        <span class="muted small cu-line-status">${esc(l.returned ? t('st.RETURNED') : t('st.' + o.status))}</span></div>`).join('') : ''}
    </section>
  </article>`;
}

function renderCustomer() {
  const c = store.customer(ui.customerId);
  const all = store.orders().filter(o => o.customerId === c.id).sort((a, b) => b.history[0].at - a.history[0].at);
  const lists = {
    all,
    unpaid: all.filter(o => !o.isPaid() && o.status !== OrderStatus.CANCELLED),
    active: all.filter(o => ACTIVE.includes(o.status))
  };
  const shown = lists[ui.cuTab];
  if (shown[0] && !Object.keys(ui.cuOpen).length) cuOpen(shown[0].id).products = true;   // first order opens expanded
  const tab = (id, key) => `<button class="cu-tab" data-action="cu-tab" data-tab="${id}" aria-pressed="${ui.cuTab === id}">${esc(t(key))}${id !== 'all' && lists[id].length ? ` <span class="cu-tab-n">${lists[id].length}</span>` : ''}</button>`;
  return `<div class="cu">
    <div class="cu-strip"><div class="cu-wrap"><span>${icon('pin', 16)} ${esc(t('cu.city'))}</span><span class="muted">${esc(t('cu.points'))}</span><span class="spacer"></span><span class="cu-strip-link">${esc(t('cu.myOrders'))}</span>${langSelect('cu-lang')}</div></div>
    <header class="cu-head"><div class="cu-wrap">
      <div class="cu-logo"><span class="brand-mark" aria-hidden="true">U</span><span>Uzum Market</span></div>
      <button class="cu-catalog">${icon('grid', 18)} ${esc(t('cu.catalog'))}</button>
      <label class="cu-search"><input placeholder="${esc(t('cu.search'))}" aria-label="${esc(t('cu.search'))}"><span>${icon('search', 20)}</span></label>
      <nav class="cu-nav"><span>${icon('user')} ${esc(c.name.split(' ')[0])}</span><span>${icon('heart')} ${esc(t('cu.favourites'))}</span><span>${icon('bag')} ${esc(t('cu.cart'))}</span></nav>
    </div></header>
    <main class="cu-wrap cu-main">
      <h1 class="cu-title">${esc(c.name)}</h1>
      <div class="cu-layout">
        <aside class="cu-side">
          <button class="cu-side-item active">${esc(t('cu.myOrders'))}</button>
          <button class="cu-side-item">${esc(t('cu.reviews'))}</button>
          <button class="cu-side-item">${esc(t('cu.myInfo'))}</button>
          ${hint(`<label class="field small cu-demo">${esc(t('cu.demo'))}<select class="input" data-action="cust-select">${store.state.customers.slice(0, 4).map(x => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`)}
        </aside>
        <section>
          <div class="cu-tabs" role="group">${tab('all', 'cu.tabAll')}${tab('unpaid', 'cu.tabUnpaid')}${tab('active', 'cu.tabActive')}</div>
          ${shown.length ? shown.map(orderCard).join('') : `<p class="cu-empty">${esc(t('cu.empty'))}</p>`}
        </section>
      </div>
    </main>
    <nav class="cu-bottom" aria-hidden="true"><span>${icon('grid')}${esc(t('cu.catalog'))}</span><span>${icon('bag')}${esc(t('cu.cart'))}</span><span>${icon('heart')}${esc(t('cu.favourites'))}</span><span class="on">${icon('user')}${esc(t('cu.profile'))}</span></nav>
  </div>`;
}

// ---------- seller panel (dark sidebar admin layout) ----------
const SICON = {
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  orders: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  ret: '<path d="M9 7L5 11l4 4"/><path d="M5 11h10a4 4 0 0 1 0 8h-3"/>',
  chart: '<path d="M5 19V5M5 19h14"/><path d="M9 16v-4M13 16V9M17 16v-6"/>',
  tag: '<path d="M4 12V5h7l9 9-7 7z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  wallet: '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M16 12h4"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
  chat: '<path d="M5 6h14v10H9l-4 3z"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1.2-3.6 4-5.2 7-5.2s5.8 1.6 7 5.2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  logout: '<path d="M14 5h4v14h-4"/><path d="M10 8l-4 4 4 4M6 12h9"/>'
};
const sicon = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SICON[n]}</svg>`;
const mask = (str, keep = 3) => str.length <= keep * 2 ? str : str.slice(0, keep) + '*'.repeat(Math.max(3, str.length - keep * 2)) + str.slice(-keep);
const langOptions = [['ru', 'Русский (RUS)', 'Russian'], ['uz', 'Oʻzbek (UZB)', 'Uzbek'], ['en', 'English (ENG)', 'English']];

function renderSellerLogin() {
  const s = store.seller(ui.sellerId);
  return `<div class="sp-login"><form class="sp-login-box" data-form="seller-login">
    <div class="app-brand"><span class="brand-mark" aria-hidden="true">U</span><span>Uzum Seller</span></div>
    <h1>${esc(t('sp.loginTitle'))}</h1>
    <p class="sp-login-sub">${esc(t('sp.loginSub'))}</p>
    <fieldset class="sp-field"><legend>${esc(t('sp.lang'))}</legend><p class="sp-hint">${esc(t('sp.langHint'))}</p>
      <div class="sp-lang-cards">${langOptions.map(([code, label]) => `<label class="sp-lang ${LANG === code ? 'on' : ''}"><span class="sp-lang-code">${code.toUpperCase()}</span><span>${esc(label)}</span><input type="radio" name="splang" value="${code}" data-action="sp-lang" ${LANG === code ? 'checked' : ''}></label>`).join('')}</div></fieldset>
    ${hint(`<label class="sp-field">${esc(t('sp.account'))}<select class="sp-input" data-action="seller-select">${store.state.sellers.map(x => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${esc(x.shopName)}</option>`).join('')}</select></label>`)}
    <label class="sp-field">${esc(t('sp.phone'))}<input class="sp-input" value="${esc(s.phone)}" readonly></label>
    <label class="sp-field">${esc(t('sp.password'))}<input class="sp-input ${ui.spLoginError ? 'bad' : ''}" id="spPass" type="password" placeholder="${esc(t('sp.password'))}" autocomplete="off">
      ${ui.spLoginError ? `<span class="sp-error">${esc(t('sp.wrongPass'))}</span>` : ''}</label>
    <button class="sp-btn wide" id="spContinue" type="submit" disabled>${esc(t('sp.continue'))}</button>
    ${hint(`<p class="sp-hint center">${esc(t('sp.demoPass'))}</p>`)}
  </form></div>`;
}

function spStatus(text, tone) { return `<span class="sp-status ${tone}">${esc(text)}</span>`; }

function spDrawer() {
  const r = store.state.returns.find(x => x.id === ui.sellerEvidence);
  if (!r) return '';
  const o = store.order(r.orderId);
  const line = o.lines.find(l => l.id === r.lineId);
  return `<div class="sp-backdrop" data-action="sp-close"></div>
  <aside class="sp-drawer" role="dialog" aria-label="${esc(t('cu.records'))}">
    <button class="sp-x" data-action="sp-close" aria-label="${esc(t('cancel'))}">${sicon('close', 22)}</button>
    <p class="sp-crumb">${esc(t('sp.return', { id: r.id }))}</p>
    <h2 class="sp-drawer-title">${esc(t('cu.records'))}</h2>
    <div class="sp-drawer-item">${productThumb(line.productId, 56)}<div><b>${esc(pname(line.productId))}</b><p class="sp-hint">${esc(t('cu.order', { id: o.id }))} · ${esc(t('reason.' + r.reason))}</p></div></div>
    ${evidenceView(o, true)}
    <div class="sp-drawer-foot"><button class="sp-btn ghost" data-action="sp-close">${esc(t('sp.close'))}</button></div>
  </aside>`;
}

function renderSeller() {
  if (!ui.sellerLogged) return renderSellerLogin();
  const s = store.seller(ui.sellerId);
  const myLines = [];
  store.orders().forEach(o => o.lines.forEach(l => { if (store.product(l.productId).sellerId === s.id) myLines.push({ o, l }); }));
  const page = ui.sellerTab;
  const nav = (id, ic, key, badge) => `<button class="sp-nav ${page === id ? 'on' : ''}" data-action="seller-tab" data-tab="${id}">${sicon(ic)}<span>${esc(t(key))}</span>${badge ? `<span class="sp-new">${esc(badge)}</span>` : ''}</button>`;
  const off = (ic, key) => `<span class="sp-nav off" title="${esc(t('sp.notInPrototype'))}">${sicon(ic)}<span>${esc(t(key))}</span></span>`;
  let title, tabs = '', body;

  if (page === 'returns') {
    const all = store.state.returns.filter(r => r.accepted && myLines.some(x => x.l.id === r.lineId)).sort((a, b) => b.createdAt - a.createdAt);
    const refundOf = r => store.state.refunds.find(f => f.returnId === r.id);
    const lists = { all, pending: all.filter(r => (refundOf(r) || {}).status === 'PENDING'), done: all.filter(r => (refundOf(r) || {}).status === 'COMPLETED') };
    const sub = ui.spSub in lists ? ui.spSub : 'all';
    title = t('sel.returns');
    tabs = `<nav class="sp-tabs">${[['all', 'sp.tabAll'], ['pending', 'sp.tabPending'], ['done', 'sp.tabDone']].map(([id, k]) => `<button data-action="sp-sub" data-sub="${id}" class="${sub === id ? 'on' : ''}">${esc(t(k))} <span>${lists[id].length}</span></button>`).join('')}</nav>`;
    body = `<div class="sp-banner"><div><h3>${esc(t('sp.bannerTitle'))}</h3><p>${esc(t('sp.bannerText'))}</p></div><span class="sp-banner-badge">${esc(t('sp.newBadge'))}</span></div>
      <div class="sp-section-head"><h2>${esc(t('sel.returns'))}</h2><span class="sp-hint">${esc(t('sel.returnsSub'))}</span></div>
      <div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>${esc(t('sel.status'))}</th><th>${esc(t('sp.number'))}</th><th>${esc(t('ret.item'))}</th><th>${esc(t('ret.reason'))}</th><th>${esc(t('ret.condition'))}</th><th>${esc(t('photo'))}</th><th>${esc(t('sp.date'))}</th><th>${esc(t('sp.amount'))}</th><th></th></tr></thead><tbody>
      ${lists[sub].map(r => { const x = myLines.find(y => y.l.id === r.lineId); const rf = refundOf(r);
        return `<tr><td>${rf ? spStatus(t('rf.' + rf.status), rf.status === 'COMPLETED' ? 'green' : 'amber') : ''}</td>
          <td class="nw"><b>${esc(r.id)}</b><br><span class="sp-hint">${esc(x.o.id)}</span></td>
          <td><div class="sp-prod">${productThumb(x.l.productId, 40)}<span>${esc(pname(x.l.productId))}</span></div></td>
          <td>${esc(t('reason.' + r.reason))}</td><td>${esc(cond(r.condition))}</td>
          <td>${r.photos.length ? `<div class="photos sp-photos">${r.photos.slice(0, 2).map(p => `<img src="${p.dataUrl}" alt="${esc(t('photo'))}">`).join('')}</div>` : '—'}</td>
          <td class="nw">${day(r.createdAt)}</td><td class="nw">${rf ? Number(rf.amount).toLocaleString('ru-RU') : ''}</td>
          <td><button class="sp-link" data-action="seller-evidence" data-id="${esc(r.id)}">${esc(t('cu.records'))}</button></td></tr>`; }).join('') || `<tr><td colspan="9" class="sp-empty">${esc(t('sel.noReturns'))}</td></tr>`}
      </tbody></table></div>`;
  } else if (page === 'insights') {
    const rows = insights.byProduct(s.id);
    const sold = rows.reduce((a, r) => a + r.sold, 0), returned = rows.reduce((a, r) => a + r.returns, 0);
    title = t('sp.analytics');
    tabs = `<nav class="sp-tabs"><button class="on">${esc(t('sel.insights'))}</button><span class="sp-tab-off">${esc(t('sp.salesTab'))}</span></nav>`;
    body = `<div class="sp-cards"><div class="sp-card"><span>${esc(t('ins.sold'))}</span><b>${sold}</b></div><div class="sp-card"><span>${esc(t('ins.returned'))}</span><b>${returned}</b></div><div class="sp-card"><span>${esc(t('ins.rate'))}</span><b>${sold ? Math.round(returned / sold * 100) : 0}%</b></div></div>
      ${rows.filter(r => r.flagged).map(r => `<div class="sp-flag">${productThumb(r.product.id, 52)}<div><b>${esc(pname(r.product.id))}</b><p>${esc(t('ins.flag', { returned: r.returns, sold: r.sold, reason: t('reason.' + r.top) }))}</p><p class="sp-hint">${esc(t('ins.advice.' + r.top))}</p></div></div>`).join('')}
      <div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>${esc(t('ins.product'))}</th><th>${esc(t('ins.sold'))}</th><th>${esc(t('ins.returned'))}</th><th>${esc(t('ins.rate'))}</th><th>${esc(t('ins.top'))}</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><div class="sp-prod">${productThumb(r.product.id, 40)}<span>${esc(pname(r.product.id))}</span></div></td><td>${r.sold}</td><td>${r.returns}</td><td><div class="bar"><span style="width:${Math.round(r.rate * 100)}%" class="${r.flagged ? 'hot' : ''}"></span></div>${Math.round(r.rate * 100)}%</td><td>${r.top ? esc(t('reason.' + r.top)) : '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
  } else if (page === 'profile') {
    title = t('sp.accountTitle');
    const row = (label, value) => `<div class="sp-prow"><span class="sp-plabel">${esc(label)}</span><span class="sp-pvalue">${esc(value)}</span><span class="sp-pedit">${esc(t('sp.change'))}</span></div>`;
    body = `<div class="sp-profile"><section class="sp-box"><h2>${esc(t('sp.profile'))}</h2>
        ${row(t('sp.name'), s.name)}${row('Email', s.email.replace(/^(.{2})[^@]*(@.*)$/, '$1***$2'))}${row(t('sp.phone'), s.phone.replace(/\s/g, '').replace(/^(\+998)\d{6}/, '$1******'))}${row(t('sp.password'), '**************')}</section>
      <section class="sp-box"><h2>${esc(t('sp.lang'))}</h2>${langOptions.map(([code, label, sub]) => `<label class="sp-langrow"><span class="sp-lang-code">${code.toUpperCase()}</span><span class="grow">${esc(label)}<br><span class="sp-hint">${esc(sub)}</span></span><input type="radio" name="splang2" value="${code}" data-action="sp-lang" ${LANG === code ? 'checked' : ''}></label>`).join('')}</section>
      <button class="sp-btn ghost" data-action="sp-logout">${sicon('logout')} ${esc(t('logout'))}</button></div>`;
  } else {
    title = t('sel.orders');
    const recent = myLines.filter(x => Date.now() - x.o.history[x.o.history.length - 1].at < 12 * DAY).sort((a, b) => b.o.history[b.o.history.length - 1].at - a.o.history[a.o.history.length - 1].at);
    const tone = st => ({ COLLECTED: 'green', AT_PICKUP_POINT: 'violet', IN_TRANSIT: 'grey', RETURNED: 'amber', PARTLY_RETURNED: 'amber', CANCELLED: 'red' }[st] || 'grey');
    body = `<div class="sp-section-head"><h2>${esc(t('sel.orders'))}</h2><span class="sp-hint">${esc(t('sp.ordersSub'))}</span></div>
      <div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>${esc(t('sel.status'))}</th><th>${esc(t('sp.number'))}</th><th>${esc(t('ret.item'))}</th><th>${esc(t('sp.point'))}</th><th>${esc(t('sel.updated'))}</th><th>${esc(t('sp.amount'))}</th></tr></thead><tbody>
      ${recent.map(x => { const last = x.o.history[x.o.history.length - 1]; const st = x.l.returned ? 'RETURNED' : x.o.status;
        return `<tr><td>${spStatus(t('st.' + st), tone(st))}</td><td>${esc(x.o.id)}</td><td><div class="sp-prod">${productThumb(x.l.productId, 40)}<span>${esc(pname(x.l.productId))}</span></div></td><td>${esc(store.pickupPoint(x.o.pickupPointId).name)}</td><td class="nw">${when(last.at)}</td><td class="nw">${Number(x.l.subtotal()).toLocaleString('ru-RU')}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  }

  return `<div class="sp">
    <aside class="sp-side">
      <div class="sp-brand"><span class="brand-mark" aria-hidden="true">U</span><span>Uzum Seller</span></div>
      <div class="sp-shop">${productThumb(s.id === 'S2' ? 'P4' : s.id === 'S3' ? 'P8' : 'P1', 30)}<span>${esc(s.shopName)}</span></div>
      <nav class="sp-menu">
        ${off('box', 'sp.products')}
        ${nav('orders', 'orders', 'sel.orders')}
        ${nav('returns', 'ret', 'sel.returns', t('sp.newBadge'))}
        <hr>
        ${off('wallet', 'sp.finance')}
        ${nav('insights', 'chart', 'sp.analytics', t('sp.newBadge'))}
        <hr>
        ${off('star', 'sp.reviews')}
        ${off('chat', 'sp.chats')}
      </nav>
      <button class="sp-me ${page === 'profile' ? 'on' : ''}" data-action="seller-tab" data-tab="profile">${sicon('user')}<span>${esc(t('sp.myProfile'))}</span></button>
    </aside>
    <div class="sp-main">
      <header class="sp-top"><p class="sp-crumb">${esc(s.shopName)}</p><h1>${esc(title)}</h1>${tabs}</header>
      <div class="sp-content">${body}</div>
    </div>
    ${ui.sellerEvidence ? spDrawer() : ''}
  </div>`;
}

// ---------- render ----------
function render() {
  document.documentElement.lang = LANG;
  const view = ui.role === 'operator' ? renderOperator() : ui.role === 'customer' ? renderCustomer() : renderSeller();
  $('#app').innerHTML = view + renderSwitcher() + (ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : '');
}

function readPhotos(input) {
  return Promise.all([...input.files].slice(0, 4).map(file => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, 360 / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = img.width * k; cv.height = img.height * k; cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); resolve(new ReturnPhoto(file.name, cv.toDataURL('image/jpeg', 0.7))); }; img.onerror = () => resolve(null); img.src = reader.result; };
    reader.readAsDataURL(file);
  }))).then(list => list.filter(Boolean));
}

// ---------- actions ----------
function verifyCode(code) {
  ui.handError = null; ui.handDone = null;
  if (isOffline()) {
    const r = offline.verify(code);
    if (!r.ok) { ui.handError = r; render(); return; }
    ui.hand = { orderId: r.entry.orderId, entryCode: r.entry.code, decisions: {}, paid: null, payError: '' };
  } else {
    const r = verifier.verify(code, pp().id);
    if (!r.ok) { ui.handError = r; render(); return; }
    ui.hand = { orderId: r.order.id, decisions: {}, paid: null, payError: '' };
  }
  render();
}

const actions = {
  lang: el => { LANG = el.dataset.lang; try { localStorage.setItem('uzum-pickup-lang', LANG); } catch (e) { /* ignore */ } render(); },
  role: el => { ui.role = el.dataset.role; render(); },
  reset: () => { store.reset(seedData); Object.assign(ui, { recv: { id: '', damaged: false, photos: [], result: null }, hand: null, handError: null, handDone: null, ret: null, retResult: null, evidenceId: null, cuOpen: {}, sellerEvidence: null }); save(); render(); },
  screen: el => { ui.screen = el.dataset.screen; ui.recv.result = null; if (ui.screen !== 'handover') { ui.hand = null; ui.handError = null; ui.handDone = null; } if (ui.screen !== 'return') { ui.ret = null; ui.retResult = null; } render(); },
  logout: () => { ui.operator = null; render(); },
  connection: () => {
    if (connection.online) { connection.goOffline(); save(); render(); return; }
    connection.goOnline();
    sync.flush(pp(), ui.operator);
    ui.screen = 'sync'; ui.hand = null; ui.handDone = null; save(); render();
  },
  'refresh-list': () => { offline.refresh(pp().id); save(); render(); },
  'pick-parcel': el => { ui.recv.id = el.dataset.id; ui.recv.result = null; render(); const f = $('#parcelId'); if (f) f.focus(); },
  'fill-code': el => verifyCode(el.dataset.code),
  decide: el => { ui.hand.decisions[el.dataset.line] = el.dataset.val; ui.hand.paid = null; render(); },
  'toggle-decline': el => { gateway.declineNext = el.checked; },
  pay: el => {
    const o = store.order(ui.hand.orderId);
    const due = o.lines.filter(l => ui.hand.decisions[l.id] !== 'reject').reduce((s, l) => s + l.subtotal(), 0);
    if (isOffline()) { ui.hand.paid = 'CASH'; ui.hand.amount = due; render(); return; }
    const r = el.dataset.method === 'CASH' ? handover.payCash(o, due) : handover.chargeCard(o, due);
    ui.hand.payError = r.ok ? '' : r.key; ui.hand.paid = r.ok ? el.dataset.method : null; save(); render();
  },
  confirm: () => {
    const h = ui.hand, o = store.order(h.orderId);
    const rejected = o.lines.filter(l => h.decisions[l.id] === 'reject').map(l => l.id);
    if (isOffline()) {
      const entry = offline.cache.find(h.entryCode);
      offline.markUsed(entry);
      if (h.paid === 'CASH') queue.enqueue(new CashPaymentAction(o.id, Date.now(), { amount: h.amount }));
      queue.enqueue(new HandoverAction(o.id, Date.now(), { decisions: h.decisions }));
      ui.handDone = { orderId: o.id, rejected: [], offline: true };
    } else {
      handover.complete(o, pp(), ui.operator, h.decisions);
      ui.handDone = { orderId: o.id, rejected, offline: false };
    }
    ui.hand = null; save(); render();
  },
  'hand-reset': () => { ui.hand = null; ui.handError = null; ui.handDone = null; render(); },
  'start-return': el => { ui.screen = 'return'; ui.retResult = null; ui.handDone = null; ui.ret = { orderId: el.dataset.id, lineId: el.dataset.line || null, reason: el.dataset.reason || 'WRONG_SIZE', condition: el.dataset.reason ? 'differsFromPhoto' : 'unusedTags', photos: [] }; render(); },
  'ret-reset': () => { ui.ret = null; ui.retResult = null; render(); },
  'open-evidence': el => { ui.role = 'operator'; ui.screen = 'evidence'; ui.evidenceId = el.dataset.id; ui.evidenceError = ''; render(); },
  'sw-toggle': () => { ui.swMin = !ui.swMin; render(); },
  'cu-tab': el => { ui.cuTab = el.dataset.tab; render(); },
  'cu-toggle': el => { const s = cuOpen(el.dataset.id); s[el.dataset.part] = !s[el.dataset.part]; render(); },
  'cu-copy': el => { try { navigator.clipboard.writeText(el.dataset.id).catch(() => {}); } catch (e) { /* clipboard unavailable */ } ui.toast = t('cu.copied'); render(); setTimeout(() => { ui.toast = ''; render(); }, 1400); },
  'cust-cancel': el => { const o = store.order(el.dataset.id); o.setStatus(OrderStatus.CANCELLED, 'note.cancelledByCustomer'); save(); render(); },
  'seller-tab': el => { ui.sellerTab = el.dataset.tab; ui.sellerEvidence = null; ui.spSub = 'all'; render(); },
  'seller-evidence': el => { ui.sellerEvidence = el.dataset.id; render(); },
  'sp-close': () => { ui.sellerEvidence = null; render(); },
  'sp-sub': el => { ui.spSub = el.dataset.sub; render(); },
  'sp-logout': () => { ui.sellerLogged = false; ui.sellerTab = 'returns'; render(); }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT') return;
  if (el.tagName === 'INPUT' && el.dataset.action !== 'toggle-decline') return;
  if (el.tagName === 'LABEL') return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.action === 'cust-select') { ui.customerId = el.value; ui.cuOpen = {}; render(); }
  if (el.dataset.action === 'seller-select') { ui.sellerId = el.value; ui.sellerEvidence = null; ui.spLoginError = false; render(); }
  if (el.dataset.action === 'sw-hints') { ui.hints = el.checked; try { localStorage.setItem('uzum-pickup-hints', ui.hints ? '1' : '0'); } catch (e) { /* ignore */ } render(); }
  if (el.dataset.action === 'sp-lang') { LANG = el.value; try { localStorage.setItem('uzum-pickup-lang', LANG); } catch (e) { /* ignore */ } render(); }
  if (el.dataset.action === 'recv-cond') { ui.recv.id = $('#parcelId').value; ui.recv.damaged = el.value === 'damaged'; render(); }
  if (el.id === 'recvPhotos') { ui.recv.id = $('#parcelId').value; readPhotos(el).then(ps => { ui.recv.photos = [...ui.recv.photos, ...ps].slice(0, 4); render(); }); }
  if (el.dataset.action === 'ret-change') { ui.ret.lineId = $('#retLine').value; ui.ret.reason = $('#retReason').value; ui.ret.condition = $('#retCond').value; render(); }
  if (el.id === 'retPhotos') { readPhotos(el).then(ps => { ui.ret.photos = [...(ui.ret.photos || []), ...ps].slice(0, 4); ui.ret.photoError = false; render(); }); }
});

document.addEventListener('input', e => {
  if (e.target.id === 'spPass') { const b = $('#spContinue'); if (b) b.disabled = e.target.value.length === 0; }
});

document.addEventListener('submit', e => {
  const form = e.target.dataset.form;
  if (!form) return;
  e.preventDefault();
  if (form === 'login') {
    const op = store.state.operators[0];
    if (op.checkPin($('#pin').value)) { ui.operator = op; ui.loginError = ''; ui.screen = 'dashboard'; } else ui.loginError = 'err.pin';
    render();
  }
  if (form === 'receive') {
    ui.recv.id = $('#parcelId').value;
    ui.recv.result = receiving.receive(ui.recv.id, pp(), ui.recv.damaged, ui.recv.photos, ui.operator);
    if (ui.recv.result.ok) { ui.recv.id = ''; ui.recv.damaged = false; ui.recv.photos = []; }
    save(); render();
  }
  if (form === 'seller-login') {
    if (store.seller(ui.sellerId).checkPin($('#spPass').value)) { ui.sellerLogged = true; ui.spLoginError = false; ui.sellerTab = 'returns'; }
    else ui.spLoginError = true;
    render();
  }
  if (form === 'verify') verifyCode($('#code').value);
  if (form === 'find-return') {
    const q = $('#retFind').value.trim().toUpperCase();
    const o = store.orders().find(x => x.id === q || x.pickupCode.value === q);
    ui.ret = !o || o.pickupPointId !== pp().id || ![OrderStatus.COLLECTED, OrderStatus.PARTLY_RETURNED].includes(o.status)
      ? { error: 'err.noCollected' } : { orderId: o.id, lineId: null, reason: 'WRONG_SIZE', condition: 'unusedTags', photos: [] };
    render();
  }
  if (form === 'return') {
    const r = ui.ret;
    if (!r.photos || r.photos.length === 0) { r.photoError = true; render(); return; }
    const o = store.order(r.orderId);
    const line = o.lines.find(l => l.id === $('#retLine').value);
    if (isOffline()) {
      queue.enqueue(new ReturnAction(o.id, Date.now(), { lineId: line.id, reason: $('#retReason').value, condition: $('#retCond').value, photos: r.photos }));
      ui.retResult = { queued: true };
    } else {
      ui.retResult = returns.submit(o, line, $('#retReason').value, $('#retCond').value, r.photos, ui.operator);
    }
    ui.ret = null; save(); render();
  }
  if (form === 'find-evidence') {
    const q = $('#evFind').value.trim().toUpperCase();
    const o = store.order(q);
    if (o) { ui.evidenceId = o.id; ui.evidenceError = ''; } else ui.evidenceError = 'err.noOrder';
    render();
  }
});

render();
