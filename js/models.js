// Domain model of the Uzum Pickup & Returns System.
// Class names, attributes and relationships match the UML class diagram in the report.
// Enumerations hold keys; the presentation layer translates them (EN / UZ / RU).

const OrderStatus = Object.freeze({
  CONFIRMED: 'CONFIRMED', IN_TRANSIT: 'IN_TRANSIT', AT_PICKUP_POINT: 'AT_PICKUP_POINT',
  COLLECTED: 'COLLECTED', PARTLY_RETURNED: 'PARTLY_RETURNED', RETURNED: 'RETURNED', CANCELLED: 'CANCELLED'
});
const PaymentMethod = Object.freeze({
  ONLINE_CARD: 'ONLINE_CARD', COUNTER_CARD: 'COUNTER_CARD', CASH: 'CASH', PAY_AT_PICKUP: 'PAY_AT_PICKUP'
});
const ReturnReason = Object.freeze({
  WRONG_SIZE: 'WRONG_SIZE', FAULTY: 'FAULTY', NOT_AS_DESCRIBED: 'NOT_AS_DESCRIBED', WRONG_ITEM: 'WRONG_ITEM', CHANGED_MIND: 'CHANGED_MIND'
});
const EvidenceStage = Object.freeze({ RECEIPT: 'RECEIPT', INSPECTION: 'INSPECTION', RETURN: 'RETURN' });
const SyncOutcome = Object.freeze({ SYNCED: 'SYNCED', CONFLICT: 'CONFLICT', REJECTED: 'REJECTED' });

const DAY = 24 * 60 * 60 * 1000;

// ----- Users (generalisation) -----
class User {
  constructor(id, name, phone) {
    if (new.target === User) throw new Error('User is abstract');
    this.id = id; this.name = name; this.phone = phone;
  }
}
class Customer extends User {
  constructor(id, name, phone, pushEnabled = true) { super(id, name, phone); this.pushEnabled = pushEnabled; }
}
class Operator extends User {
  constructor(id, name, phone, pickupPointId, pin) { super(id, name, phone); this.pickupPointId = pickupPointId; this.pin = pin; }
  checkPin(pin) { return String(pin) === String(this.pin); }
}
class Seller extends User {
  constructor(id, name, phone, shopName, email = '', pin = '1234') { super(id, name, phone); this.shopName = shopName; this.email = email; this.pin = pin; }
  checkPin(pin) { return String(pin) === String(this.pin); }
}

// ----- Catalogue -----
class Product {
  constructor(id, category, price, sellerId, storageDays, returnable) {
    this.id = id; this.category = category; this.price = price; this.sellerId = sellerId;
    this.storageDays = storageDays; this.returnable = returnable;
  }
}

// ----- Pickup point (aggregation) -----
class StorageCell {
  constructor(code, orderId = null) { this.code = code; this.orderId = orderId; }
  isFree() { return this.orderId === null; }
  occupy(orderId) { this.orderId = orderId; }
  release() { this.orderId = null; }
}
class PickupPoint {
  constructor(id, name, cells = [], address = '') { this.id = id; this.name = name; this.cells = cells; this.address = address; }
  findFreeCell() { return this.cells.find(c => c.isFree()) || null; }
  getCell(code) { return this.cells.find(c => c.code === code) || null; }
  cellOf(orderId) { return this.cells.find(c => c.orderId === orderId) || null; }
}

// ----- Order (composition: OrderLines, PickupCode, StatusEvents, ConditionRecords) -----
class OrderLine {
  constructor(id, productId, qty, price) {
    this.id = id; this.productId = productId; this.qty = qty; this.price = price;
    this.returned = false; this.notCharged = false;
  }
  subtotal() { return this.qty * this.price; }
}
class PickupCode {
  constructor(value, used = false) { this.value = value; this.used = used; }
  isValid() { return !this.used; }
  markUsed() { this.used = true; }
}
class Payment {
  constructor(method, amount, paid = false, paidAt = null) { this.method = method; this.amount = amount; this.paid = paid; this.paidAt = paidAt; }
  pay(method, at = Date.now()) { this.method = method; this.paid = true; this.paidAt = at; }
}
class StatusEvent {
  constructor(status, at, noteKey = '', noteVars = {}) { this.status = status; this.at = at; this.noteKey = noteKey; this.noteVars = noteVars; }
}
class ConditionRecord {
  constructor(stage, damaged, note, photos, recordedBy, at = Date.now(), lineId = null) {
    this.stage = stage; this.damaged = damaged; this.note = note; this.photos = photos;
    this.recordedBy = recordedBy; this.at = at; this.lineId = lineId;
  }
}
class Order {
  constructor(id, customerId, pickupPointId, lines, payment, pickupCode) {
    this.id = id; this.customerId = customerId; this.pickupPointId = pickupPointId;
    this.lines = lines; this.payment = payment; this.pickupCode = pickupCode;
    this.status = OrderStatus.CONFIRMED; this.history = []; this.evidence = [];
    this.cellCode = null; this.deadline = null; this.handover = null;
  }
  total() { return this.lines.reduce((s, l) => s + l.subtotal(), 0); }
  isPaid() { return this.payment.paid; }
  setStatus(status, noteKey = '', noteVars = {}, at = Date.now()) {
    this.status = status; this.history.push(new StatusEvent(status, at, noteKey, noteVars));
  }
  addEvidence(record) { this.evidence.push(record); }
  collectedAt() { const e = this.history.find(h => h.status === OrderStatus.COLLECTED); return e ? e.at : null; }
  isExpired(now = Date.now()) { return this.deadline !== null && now > this.deadline; }
}

// ----- Returns and refunds -----
class ReturnPhoto { constructor(name, dataUrl) { this.name = name; this.dataUrl = dataUrl; } }
class ReturnRequest {
  constructor(id, orderId, lineId, reason, condition, photos, createdAt = Date.now()) {
    this.id = id; this.orderId = orderId; this.lineId = lineId; this.reason = reason;
    this.condition = condition; this.photos = photos; this.createdAt = createdAt;
    this.accepted = null; this.decisionKey = ''; this.waitingForSync = false;
  }
}
class Refund {
  constructor(id, returnId, amount, method, expectedAt, status = 'PENDING') {
    this.id = id; this.returnId = returnId; this.amount = amount; this.method = method; this.expectedAt = expectedAt; this.status = status;
  }
  complete() { this.status = 'COMPLETED'; }
}
class Notification {
  constructor(channel, customerId, messageKey, vars, at = Date.now()) {
    this.channel = channel; this.customerId = customerId; this.messageKey = messageKey; this.vars = vars; this.at = at;
  }
}

// ----- Offline-first pickup point -----
class OfflineEntry {
  constructor(orderId, code, cellCode, customerName, amountDue, used = false) {
    this.orderId = orderId; this.code = code; this.cellCode = cellCode;
    this.customerName = customerName; this.amountDue = amountDue; this.used = used; this.usedAt = null;
  }
}
class OfflineCache {
  constructor(savedAt, entries = []) { this.savedAt = savedAt; this.entries = entries; }
  find(code) { return this.entries.find(e => e.code === code || e.orderId === code) || null; }
}
class SyncAction {
  constructor(type, orderId, at = Date.now(), payload = {}) {
    if (new.target === SyncAction) throw new Error('SyncAction is abstract');
    this.type = type; this.orderId = orderId; this.at = at; this.payload = payload;
    this.key = `${type}:${orderId}:${payload.lineId || ''}`;     // idempotency key
  }
}
class HandoverAction extends SyncAction { constructor(orderId, at, payload) { super('HANDOVER', orderId, at, payload); } }
class CashPaymentAction extends SyncAction { constructor(orderId, at, payload) { super('CASH_PAYMENT', orderId, at, payload); } }
class ReturnAction extends SyncAction { constructor(orderId, at, payload) { super('RETURN', orderId, at, payload); } }
class SyncResult {
  constructor(action, outcome, messageKey, vars = {}) { this.action = action; this.outcome = outcome; this.messageKey = messageKey; this.vars = vars; this.at = Date.now(); }
}
