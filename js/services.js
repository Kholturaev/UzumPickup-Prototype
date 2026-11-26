// Business-logic layer. Interfaces (NotificationChannel, RefundPolicy, PaymentGateway) encapsulate
// the parts that change (Lecture 10). Results carry message keys that the UI translates.

// ----- «interface» NotificationChannel -----
class NotificationChannel { get name() { throw new Error('abstract'); } send(customer, key, vars) { throw new Error('abstract'); } }
class SmsChannel extends NotificationChannel { get name() { return 'SMS'; } send(c, k, v) { return new Notification(this.name, c.id, k, v); } }
class WhatsAppChannel extends NotificationChannel { get name() { return 'WhatsApp'; } send(c, k, v) { return new Notification(this.name, c.id, k, v); } }
class PushChannel extends NotificationChannel {
  get name() { return 'PUSH'; }
  send(c, k, v) { return c.pushEnabled ? new Notification(this.name, c.id, k, v) : null; }
}
class NotificationService {
  constructor(store, channels) { this.store = store; this.channels = channels; }
  notify(customer, key, vars = {}) {
    const sent = [];
    this.channels.forEach(ch => { const n = ch.send(customer, key, vars); if (n) { this.store.state.notifications.unshift(n); sent.push(ch.name); } });
    return sent;
  }
}

// ----- «interface» RefundPolicy -----
class RefundPolicy { get key() { throw new Error('abstract'); } expectedDate(from) { throw new Error('abstract'); } completesImmediately() { return false; } }
class OnlineCardRefund extends RefundPolicy { get key() { return 'refund.online'; } expectedDate(f) { return f + DAY; } }
class CounterCardRefund extends RefundPolicy { get key() { return 'refund.counter'; } expectedDate(f) { return f + 10 * DAY; } }
class CashRefund extends RefundPolicy { get key() { return 'refund.cash'; } expectedDate(f) { return f; } completesImmediately() { return true; } }
class NoChargeRefund extends RefundPolicy { get key() { return 'refund.none'; } expectedDate(f) { return f; } completesImmediately() { return true; } }
class RefundPolicyFactory {
  static forLine(order, line) {
    if (line.notCharged || !order.isPaid()) return new NoChargeRefund();
    if (order.payment.method === PaymentMethod.ONLINE_CARD) return new OnlineCardRefund();
    if (order.payment.method === PaymentMethod.COUNTER_CARD) return new CounterCardRefund();
    return new CashRefund();
  }
}

// ----- «interface» PaymentGateway -----
class PaymentGateway { charge(amount) { throw new Error('abstract'); } }
class TerminalGateway extends PaymentGateway {
  constructor() { super(); this.declineNext = false; }
  charge() { if (this.declineNext) { this.declineNext = false; return { approved: false }; } return { approved: true }; }
}

// ----- Connection state -----
class ConnectionMonitor {
  constructor(store) { this.store = store; }
  get online() { return this.store.state.connection.online; }
  get since() { return this.store.state.connection.since; }
  goOffline() { this.store.state.connection = { online: false, since: Date.now() }; }
  goOnline() { this.store.state.connection = { online: true, since: Date.now() }; }
}

// ----- Online code verification -----
class PickupCodeVerifier {
  constructor(store) { this.store = store; }
  verify(raw, pickupPointId) {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return { ok: false, key: 'err.enterCode' };
    const order = this.store.orders().find(o => o.pickupCode.value === code || o.id === code);
    if (!order) return { ok: false, key: 'err.noOrder' };
    if (order.pickupPointId !== pickupPointId) return { ok: false, key: 'err.otherPoint' };
    if (order.status === OrderStatus.CANCELLED) return { ok: false, key: 'err.cancelled' };
    if ([OrderStatus.CONFIRMED, OrderStatus.IN_TRANSIT].includes(order.status)) return { ok: false, key: 'err.notArrived' };
    if (!order.pickupCode.isValid() || order.status !== OrderStatus.AT_PICKUP_POINT) return { ok: false, key: 'err.used' };
    if (order.isExpired()) return { ok: false, key: 'err.expired' };
    return { ok: true, order };
  }
}

// ----- Offline cache (Headline 1) -----
class OfflineCacheService {
  constructor(store) { this.store = store; }
  get cache() { return this.store.state.offlineCache; }
  refresh(pickupPointId, at = Date.now()) {
    const entries = this.store.orders()
      .filter(o => o.pickupPointId === pickupPointId && o.status === OrderStatus.AT_PICKUP_POINT)
      .map(o => new OfflineEntry(o.id, o.pickupCode.value, o.cellCode, this.store.customer(o.customerId).name, o.isPaid() ? 0 : o.total()));
    this.store.state.offlineCache = new OfflineCache(at, entries);
    return this.store.state.offlineCache;
  }
  verify(raw) {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return { ok: false, key: 'err.enterCode' };
    const entry = this.cache.find(code);
    if (!entry) return { ok: false, key: 'err.notInOffline', vars: { time: this.cache.savedAt } };
    if (entry.used) return { ok: false, key: 'err.usedOffline', vars: { time: entry.usedAt } };
    return { ok: true, entry };
  }
  markUsed(entry) { entry.used = true; entry.usedAt = Date.now(); }
}

class SyncQueue {
  constructor(store) { this.store = store; }
  get actions() { return this.store.state.syncQueue; }
  enqueue(action) {
    if (this.actions.some(a => a.key === action.key)) return false;     // duplicates never enter the queue
    this.actions.push(action); return true;
  }
}

class ConflictResolver {
  check(action, order) {
    if (!order) return new SyncResult(action, SyncOutcome.REJECTED, 'sync.unknown');
    if (order.status === OrderStatus.CANCELLED)
      return new SyncResult(action, SyncOutcome.CONFLICT, action.type === 'CASH_PAYMENT' ? 'sync.conflictCash' : 'sync.conflictCancelled', { order: order.id, cancelledAt: order.history[order.history.length - 1].at, handedAt: action.at });
    if (action.type === 'HANDOVER' && order.status !== OrderStatus.AT_PICKUP_POINT)
      return new SyncResult(action, SyncOutcome.REJECTED, 'sync.alreadyDone', { order: order.id });
    return null;
  }
}

class SyncService {
  constructor(store, queue, resolver, handover, returns, cacheService) {
    Object.assign(this, { store, queue, resolver, handover, returns, cacheService });
  }
  flush(pickupPoint, operator) {
    const results = [];
    this.queue.actions.forEach(action => {
      const order = this.store.order(action.orderId);
      const problem = this.resolver.check(action, order);
      if (problem) { results.push(problem); return; }
      if (action.type === 'CASH_PAYMENT') {
        order.payment.pay(PaymentMethod.CASH, action.at); order.payment.amount = action.payload.amount;
        results.push(new SyncResult(action, SyncOutcome.SYNCED, 'sync.cashOk', { order: order.id, amount: action.payload.amount }));
      } else if (action.type === 'HANDOVER') {
        this.handover.complete(order, pickupPoint, operator, action.payload.decisions, true, action.at);
        results.push(new SyncResult(action, SyncOutcome.SYNCED, 'sync.handoverOk', { order: order.id }));
      } else if (action.type === 'RETURN') {
        const line = order.lines.find(l => l.id === action.payload.lineId);
        const r = this.returns.submit(order, line, action.payload.reason, action.payload.condition, action.payload.photos, operator, action.at);
        results.push(r.accepted
          ? new SyncResult(action, SyncOutcome.SYNCED, 'sync.returnOk', { order: order.id })
          : new SyncResult(action, SyncOutcome.REJECTED, 'sync.returnRejected', { order: order.id, reasonKey: r.key }));
      }
    });
    this.store.state.syncQueue = [];
    this.store.state.syncLog = { at: Date.now(), results };
    this.cacheService.refresh(pickupPoint.id);
    return results;
  }
}

// ----- Returns -----
class ReturnEligibilityChecker {
  constructor(store) { this.store = store; }
  check(order, line, reason, now = Date.now()) {
    if (!line || line.returned) return { ok: false, key: 'err.alreadyReturned' };
    const product = this.store.product(line.productId);
    const collected = order.collectedAt();
    if (!collected && order.status !== OrderStatus.AT_PICKUP_POINT) return { ok: false, key: 'err.notCollected' };
    if (collected && now - collected > 10 * DAY) return { ok: false, key: 'err.tenDays' };
    const quality = [ReturnReason.FAULTY, ReturnReason.WRONG_ITEM, ReturnReason.NOT_AS_DESCRIBED].includes(reason);
    if (!product.returnable && !quality) return { ok: false, key: 'err.category', vars: { category: product.category } };
    return { ok: true };
  }
}
class RefundService {
  constructor(store) { this.store = store; }
  issue(rr, order, line, at = Date.now()) {
    const policy = RefundPolicyFactory.forLine(order, line);
    const amount = policy instanceof NoChargeRefund ? 0 : line.subtotal();
    const refund = new Refund(this.store.nextId('RF'), rr.id, amount, order.payment.method, policy.expectedDate(at));
    if (policy.completesImmediately()) refund.complete();
    this.store.state.refunds.push(refund);
    return { refund, policy };
  }
}
class ReturnService {
  constructor(store, checker, refunds, notifier) { Object.assign(this, { store, checker, refunds, notifier }); }
  submit(order, line, reason, condition, photos, operator, at = Date.now()) {
    const check = this.checker.check(order, line, reason, at);
    const rr = new ReturnRequest(this.store.nextId('RT'), order.id, line ? line.id : null, reason, condition, photos, at);
    rr.accepted = check.ok; rr.decisionKey = check.ok ? '' : check.key;
    this.store.state.returns.push(rr);
    if (!check.ok) return { accepted: false, key: check.key, vars: check.vars, returnRequest: rr };
    line.returned = true;
    order.addEvidence(new ConditionRecord(EvidenceStage.RETURN, reason === ReturnReason.FAULTY, condition, photos, operator.name, at, line.id));
    const all = order.lines.every(l => l.returned);
    order.setStatus(all ? OrderStatus.RETURNED : OrderStatus.PARTLY_RETURNED, 'note.returnOf', { product: line.productId, reason }, at);
    const { refund, policy } = this.refunds.issue(rr, order, line, at);
    this.notifier.notify(this.store.customer(order.customerId), 'msg.returnAccepted', { order: order.id });
    return { accepted: true, returnRequest: rr, refund, policy };
  }
}

// ----- Receiving (Headline 2: condition record at receipt) -----
class ParcelReceivingService {
  constructor(store, notifier) { this.store = store; this.notifier = notifier; }
  receive(rawId, pickupPoint, damaged, photos, operator) {
    const order = this.store.order(String(rawId || '').trim().toUpperCase());
    if (!order || order.status !== OrderStatus.IN_TRANSIT || order.pickupPointId !== pickupPoint.id) return { ok: false, key: 'err.unexpectedParcel' };
    if (damaged && photos.length === 0) return { ok: false, key: 'err.photoNeeded' };
    const cell = pickupPoint.findFreeCell();
    if (!cell) return { ok: false, key: 'err.noCell' };
    cell.occupy(order.id); order.cellCode = cell.code;
    const days = Math.min(...order.lines.map(l => this.store.product(l.productId).storageDays));
    order.deadline = Date.now() + days * DAY;
    order.addEvidence(new ConditionRecord(EvidenceStage.RECEIPT, damaged, damaged ? 'damagedPackaging' : 'packagingOk', photos, operator.name));
    order.setStatus(OrderStatus.AT_PICKUP_POINT, 'note.storedIn', { cell: cell.code });
    const sent = this.notifier.notify(this.store.customer(order.customerId), 'msg.arrived', { order: order.id, days });
    return { ok: true, order, cell, days, sent };
  }
}

// ----- Handover (Headline 2: inspection result recorded per item) -----
class HandoverService {
  constructor(store, gateway, notifier) { Object.assign(this, { store, gateway, notifier }); }
  chargeCard(order, amount) {
    const r = this.gateway.charge(amount);
    if (!r.approved) return { ok: false, key: 'err.cardDeclined' };
    order.payment.pay(PaymentMethod.COUNTER_CARD); order.payment.amount = amount; return { ok: true };
  }
  payCash(order, amount) { order.payment.pay(PaymentMethod.CASH); order.payment.amount = amount; return { ok: true }; }
  complete(order, pickupPoint, operator, decisions, synced = false, at = Date.now()) {
    const prepaid = order.payment.method === PaymentMethod.ONLINE_CARD;
    order.lines.forEach(l => {
      const rejected = decisions[l.id] === 'reject';
      if (rejected) l.notCharged = !prepaid;
      order.addEvidence(new ConditionRecord(EvidenceStage.INSPECTION, rejected, rejected ? 'rejectedAtInspection' : 'acceptedAtInspection', [], operator.name, at, l.id));
    });
    order.pickupCode.markUsed();
    const cell = pickupPoint.cellOf(order.id); if (cell) cell.release();
    order.handover = { operatorId: operator.id, at, synced };
    order.setStatus(OrderStatus.COLLECTED, synced ? 'note.handedOffline' : 'note.handedBy', { name: operator.name }, at);
  }
}

// ----- Disputes (Headline 2) -----
class DisputeService {
  summary(order) {
    const first = order.evidence.slice().sort((a, b) => a.at - b.at).find(r => r.damaged);
    if (!order.evidence.length) return { key: 'verdict.noRecords' };
    if (!first) {
      const listing = order.evidence.some(r => r.stage === EvidenceStage.RETURN && r.note === 'differsFromPhoto');
      return { key: listing ? 'verdict.listing' : 'verdict.none' };
    }
    if (first.stage === EvidenceStage.RECEIPT) return { key: 'verdict.receipt', stage: first.stage };
    if (first.stage === EvidenceStage.INSPECTION) return { key: 'verdict.inspection', stage: first.stage };
    return { key: 'verdict.return', stage: first.stage };
  }
}

class ReturnInsightService {
  constructor(store) { this.store = store; }
  byProduct(sellerId) {
    return this.store.state.products.filter(p => p.sellerId === sellerId).map(p => {
      const lines = [];
      this.store.orders().forEach(o => o.lines.forEach(l => { if (l.productId === p.id && o.collectedAt()) lines.push(l); }));
      const rets = this.store.state.returns.filter(r => r.accepted && lines.some(l => l.id === r.lineId));
      const reasons = {};
      rets.forEach(r => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
      const top = Object.keys(reasons).sort((a, b) => reasons[b] - reasons[a])[0] || null;
      const rate = lines.length ? rets.length / lines.length : 0;
      const flagged = rets.length >= 2 && rate >= 0.3;
      return { product: p, sold: lines.length, returns: rets.length, rate, reasons, top, flagged };
    }).filter(x => x.sold > 0).sort((a, b) => b.rate - a.rate);
  }
}

// ----- Data access layer -----
class DataStore {
  constructor(key) { this.key = key; this.state = null; }
  load(seedFn) {
    let raw = null;
    try { raw = localStorage.getItem(this.key); } catch (e) { raw = null; }
    try { this.state = raw ? this.rehydrate(JSON.parse(raw)) : seedFn(); } catch (e) { this.state = seedFn(); }
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.state)); } catch (e) { /* keep in memory */ } }
  reset(seedFn) { try { localStorage.removeItem(this.key); } catch (e) { /* ignore */ } this.state = seedFn(); }
  rehydrate(s) {
    const as = (C, o) => Object.assign(Object.create(C.prototype), o);
    s.orders = s.orders.map(o => {
      const order = as(Order, o);
      order.lines = o.lines.map(l => as(OrderLine, l));
      order.payment = as(Payment, o.payment);
      order.pickupCode = as(PickupCode, o.pickupCode);
      order.history = o.history.map(h => as(StatusEvent, h));
      order.evidence = o.evidence.map(e => { const r = as(ConditionRecord, e); r.photos = e.photos.map(p => as(ReturnPhoto, p)); return r; });
      return order;
    });
    s.pickupPoints = s.pickupPoints.map(p => { const pp = as(PickupPoint, p); pp.cells = p.cells.map(c => as(StorageCell, c)); return pp; });
    s.customers = s.customers.map(c => as(Customer, c));
    s.operators = s.operators.map(c => as(Operator, c));
    s.sellers = s.sellers.map(c => as(Seller, c));
    s.products = s.products.map(c => as(Product, c));
    s.returns = s.returns.map(r => { const rr = as(ReturnRequest, r); rr.photos = r.photos.map(p => as(ReturnPhoto, p)); return rr; });
    s.refunds = s.refunds.map(r => as(Refund, r));
    s.notifications = s.notifications.map(n => as(Notification, n));
    s.offlineCache = as(OfflineCache, s.offlineCache); s.offlineCache.entries = s.offlineCache.entries.map(e => as(OfflineEntry, e));
    const types = { HANDOVER: HandoverAction, CASH_PAYMENT: CashPaymentAction, RETURN: ReturnAction };
    s.syncQueue = s.syncQueue.map(a => as(types[a.type], a));
    return s;
  }
  nextId(prefix) { this.state.seq += 1; return `${prefix}-${this.state.seq}`; }
  orders() { return this.state.orders; }
  order(id) { return this.state.orders.find(o => o.id === id) || null; }
  product(id) { return this.state.products.find(p => p.id === id); }
  customer(id) { return this.state.customers.find(c => c.id === id); }
  seller(id) { return this.state.sellers.find(s => s.id === id); }
  pickupPoint(id) { return this.state.pickupPoints.find(p => p.id === id); }
}
