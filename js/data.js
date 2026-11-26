// Demo data based on the Coursework 1 interviews and survey (Chilonzor pickup point, menswear seller,
// 8-day storage, 10-day returns, refunds by payment method, "not as described" complaints).

function samplePhoto(kind) {
  const bg = { box: '#E9E2D3', damaged: '#E9E2D3', shirt: '#DCE6F2', earphones: '#ECE8F6' }[kind];
  const art = {
    box: '<rect x="40" y="45" width="80" height="55" rx="4" fill="#C8A97A"/><rect x="40" y="45" width="80" height="12" fill="#B8955F"/><rect x="74" y="45" width="12" height="55" fill="#E0CBA5"/>',
    damaged: '<rect x="40" y="45" width="80" height="55" rx="4" fill="#C8A97A"/><path d="M40 45h80v12H40z" fill="#B8955F"/><path d="M92 45l8 18-10 9 12 14-6 14" stroke="#5A3B12" stroke-width="3" fill="none"/><path d="M98 52l20 -10" stroke="#5A3B12" stroke-width="3"/>',
    shirt: '<path d="M55 40l15-8h20l15 8 15 14-12 12-8-6v46H60V60l-8 6-12-12z" fill="#6F8FBF"/><path d="M70 32q10 12 20 0" stroke="#3E5C8A" stroke-width="3" fill="none"/>',
    earphones: '<circle cx="62" cy="70" r="16" fill="#3B3650"/><circle cx="98" cy="70" r="16" fill="#3B3650"/><path d="M62 54q18-30 36 0" stroke="#3B3650" stroke-width="5" fill="none"/>'
  }[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="140" viewBox="0 0 160 140"><rect width="160" height="140" fill="${bg}"/>${art}</svg>`;
  return new ReturnPhoto(`${kind}.svg`, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
}

function seedData() {
  const now = Date.now();
  const ago = d => now - d * DAY;
  const ahead = d => now + d * DAY;
  const morning = new Date(); morning.setHours(8, 0, 0, 0);
  const listSavedAt = morning.getTime() < now ? morning.getTime() : now - 3600000;

  const cells = [];
  ['A', 'B'].forEach(r => { for (let i = 1; i <= 12; i++) cells.push(new StorageCell(`${r}-${String(i).padStart(2, '0')}`)); });
  const chilonzor = new PickupPoint('PP-CH12', 'Chilonzor-12', cells);
  chilonzor.address = 'Toshkent sh., Chilonzor tumani, 12-kvartal, 7-uy';
  const yunusobod = new PickupPoint('PP-YU04', 'Yunusobod-4', Array.from({ length: 6 }, (_, i) => new StorageCell(`A-0${i + 1}`)));
  yunusobod.address = 'Toshkent sh., Yunusobod tumani, 4-mavze, 15-uy';

  const customers = [
    new Customer('C1', 'Dilnoza Karimova', '+998 90 123 45 67'),
    new Customer('C2', 'Jasur Toshmatov', '+998 93 456 12 08'),
    new Customer('C3', 'Malika Yusupova', '+998 97 701 33 19', false),
    new Customer('C4', 'Bekzod Aliyev', '+998 99 214 87 50'),
    new Customer('C5', 'Sevara Usmonova', '+998 90 777 21 40'),
    new Customer('C6', 'Akmal Rasulov', '+998 91 404 65 12')
  ];
  const operators = [new Operator('OP1', 'Aziza Rahimova', '+998 90 555 01 02', 'PP-CH12', '1234')];
  const sellers = [
    new Seller('S1', 'Sardor Nematov', '+998 91 300 22 11', 'Bek Style', 'sardor.nematov@mail.uz'),
    new Seller('S2', 'Lola Saidova', '+998 94 812 40 40', 'Sado Electronics', 'lola.saidova@mail.uz'),
    new Seller('S3', 'Nodir Qosimov', '+998 95 640 18 77', 'Toza Home', 'nodir.qosimov@mail.uz')
  ];
  const products = [
    new Product('P1', 'CLOTHING', 189000, 'S1', 8, true),
    new Product('P2', 'CLOTHING', 249000, 'S1', 8, true),
    new Product('P3', 'CLOTHING', 279000, 'S1', 8, true),
    new Product('P4', 'ELECTRONICS', 159000, 'S2', 8, true),
    new Product('P5', 'ELECTRONICS', 45000, 'S2', 8, true),
    new Product('P6', 'COSMETICS', 52000, 'S3', 3, false),
    new Product('P7', 'UNDERWEAR', 69000, 'S1', 8, false),
    new Product('P8', 'HOME', 210000, 'S3', 8, true)
  ];
  const price = id => products.find(p => p.id === id).price;
  const OP = 'Aziza Rahimova';

  let lineSeq = 0;
  const make = (id, cust, pp, items, method, paid, code) => {
    const lines = items.map(pid => new OrderLine(`L${++lineSeq}`, pid, 1, price(pid)));
    const amount = lines.reduce((s, l) => s + l.subtotal(), 0);
    return new Order(id, cust, pp, lines, new Payment(method, amount, paid, paid ? ago(9) : null), new PickupCode(code));
  };
  const ev = (o, status, at, key = '', vars = {}) => { o.status = status; o.history.push(new StatusEvent(status, at, key, vars)); };
  const transit = (o, d) => { ev(o, OrderStatus.CONFIRMED, ago(d + 2)); ev(o, OrderStatus.IN_TRANSIT, ago(d)); };
  const store = (o, pp, cell, deadlineDays, arrived, damaged = false) => {
    pp.getCell(cell).occupy(o.id); o.cellCode = cell; o.deadline = ahead(deadlineDays);
    o.addEvidence(new ConditionRecord(EvidenceStage.RECEIPT, damaged, damaged ? 'damagedPackaging' : 'packagingOk', damaged ? [samplePhoto('damaged')] : [], OP, ago(arrived)));
    ev(o, OrderStatus.AT_PICKUP_POINT, ago(arrived), 'note.storedIn', { cell });
  };
  const arrive = (o, cell, arrived) => {
    o.addEvidence(new ConditionRecord(EvidenceStage.RECEIPT, false, 'packagingOk', [], OP, ago(arrived)));
    ev(o, OrderStatus.AT_PICKUP_POINT, ago(arrived), 'note.storedIn', { cell });
  };
  const collect = (o, d, rejectedLineId = null) => {
    o.pickupCode.markUsed(); o.handover = { operatorId: 'OP1', at: ago(d), synced: false };
    o.lines.forEach(l => o.addEvidence(new ConditionRecord(EvidenceStage.INSPECTION, l.id === rejectedLineId, l.id === rejectedLineId ? 'rejectedAtInspection' : 'acceptedAtInspection', [], OP, ago(d), l.id)));
    ev(o, OrderStatus.COLLECTED, ago(d), 'note.handedBy', { name: OP });
  };
  const orders = [], returns = [], refunds = [];
  let rtSeq = 300;
  const giveBack = (o, line, reason, condition, photos, d, refundStatus, refundAt) => {
    line.returned = true;
    o.addEvidence(new ConditionRecord(EvidenceStage.RETURN, reason === ReturnReason.FAULTY, condition, photos, OP, ago(d), line.id));
    ev(o, o.lines.every(l => l.returned) ? OrderStatus.RETURNED : OrderStatus.PARTLY_RETURNED, ago(d), 'note.returnOf', { product: line.productId, reason });
    const rr = new ReturnRequest(`RT-${++rtSeq}`, o.id, line.id, reason, condition, photos, ago(d)); rr.accepted = true; returns.push(rr);
    refunds.push(new Refund(`RF-${++rtSeq}`, rr.id, line.subtotal(), o.payment.method, refundAt, refundStatus));
  };
  const add = o => { orders.push(o); return o; };

  // Today's delivery (not yet received)
  transit(add(make('UZ-10421', 'C1', 'PP-CH12', ['P1', 'P4'], PaymentMethod.ONLINE_CARD, true, '482173')), 0.3);
  transit(add(make('UZ-10422', 'C2', 'PP-CH12', ['P2'], PaymentMethod.PAY_AT_PICKUP, false, '367250')), 0.3);
  transit(add(make('UZ-10423', 'C4', 'PP-CH12', ['P6'], PaymentMethod.ONLINE_CARD, true, '790436')), 0.3);

  // Stored in cells before this morning's offline list
  let o = add(make('UZ-10398', 'C1', 'PP-CH12', ['P3'], PaymentMethod.PAY_AT_PICKUP, false, '615204')); transit(o, 3); store(o, chilonzor, 'A-01', 6, 2);
  o = add(make('UZ-10401', 'C2', 'PP-CH12', ['P4', 'P5'], PaymentMethod.ONLINE_CARD, true, '730915')); transit(o, 8); store(o, chilonzor, 'A-02', 1, 7);
  o = add(make('UZ-10405', 'C3', 'PP-CH12', ['P1', 'P7'], PaymentMethod.ONLINE_CARD, true, '209447')); transit(o, 4); store(o, chilonzor, 'A-03', 5, 3);
  o = add(make('UZ-10407', 'C4', 'PP-CH12', ['P8'], PaymentMethod.PAY_AT_PICKUP, false, '551862')); transit(o, 2); store(o, chilonzor, 'A-04', 7, 1, true);
  o = add(make('UZ-10409', 'C2', 'PP-YU04', ['P5'], PaymentMethod.ONLINE_CARD, true, '900311')); transit(o, 2); store(o, yunusobod, 'A-01', 6, 1);

  // Collected recently
  o = add(make('UZ-10377', 'C1', 'PP-CH12', ['P2'], PaymentMethod.ONLINE_CARD, true, '104552')); transit(o, 7); arrive(o, 'B-02', 5); collect(o, 3);
  o = add(make('UZ-10360', 'C4', 'PP-CH12', ['P4'], PaymentMethod.COUNTER_CARD, true, '663019')); transit(o, 18); arrive(o, 'B-05', 16); collect(o, 13);
  o = add(make('UZ-10388', 'C3', 'PP-CH12', ['P1', 'P6'], PaymentMethod.CASH, true, '427781')); transit(o, 5); arrive(o, 'B-07', 4); collect(o, 2);

  // Returned, with evidence
  o = add(make('UZ-10350', 'C2', 'PP-CH12', ['P3'], PaymentMethod.ONLINE_CARD, true, '318206')); transit(o, 10); arrive(o, 'B-03', 8); collect(o, 6);
  giveBack(o, o.lines[0], ReturnReason.WRONG_SIZE, 'unusedTags', [samplePhoto('box')], 4, 'COMPLETED', ago(3));
  o = add(make('UZ-10366', 'C1', 'PP-CH12', ['P1'], PaymentMethod.COUNTER_CARD, true, '552904')); transit(o, 7); arrive(o, 'B-04', 5); collect(o, 4);
  giveBack(o, o.lines[0], ReturnReason.NOT_AS_DESCRIBED, 'differsFromPhoto', [samplePhoto('shirt')], 2, 'PENDING', ahead(8));

  // Earlier sales (give the seller enough history for return insights)
  const history = [
    ['UZ-10301', 'C5', 'P1', 30, ReturnReason.NOT_AS_DESCRIBED], ['UZ-10304', 'C6', 'P1', 27, null], ['UZ-10309', 'C5', 'P1', 24, ReturnReason.NOT_AS_DESCRIBED],
    ['UZ-10312', 'C6', 'P1', 21, null], ['UZ-10315', 'C5', 'P1', 19, ReturnReason.WRONG_SIZE], ['UZ-10318', 'C6', 'P1', 17, null],
    ['UZ-10303', 'C5', 'P2', 29, null], ['UZ-10311', 'C6', 'P2', 22, ReturnReason.WRONG_SIZE], ['UZ-10320', 'C5', 'P2', 16, null],
    ['UZ-10306', 'C6', 'P3', 26, null], ['UZ-10314', 'C5', 'P3', 20, null],
    ['UZ-10308', 'C5', 'P4', 25, ReturnReason.FAULTY], ['UZ-10316', 'C6', 'P4', 18, null], ['UZ-10319', 'C5', 'P5', 15, null]
  ];
  history.forEach(([id, cust, pid, d, reason], i) => {
    const h = add(make(id, cust, 'PP-CH12', [pid], PaymentMethod.ONLINE_CARD, true, String(100000 + i * 7919).slice(0, 6)));
    transit(h, d + 2); arrive(h, 'B-1' + (i % 2), d + 1); collect(h, d);
    if (reason) giveBack(h, h.lines[0], reason, reason === ReturnReason.FAULTY ? 'itemDamaged' : (reason === ReturnReason.NOT_AS_DESCRIBED ? 'differsFromPhoto' : 'unusedTags'),
      [samplePhoto(pid === 'P4' ? 'earphones' : 'shirt')], d - 2, 'COMPLETED', ago(d - 3));
  });

  const offlineEntries = orders.filter(x => x.pickupPointId === 'PP-CH12' && x.status === OrderStatus.AT_PICKUP_POINT)
    .map(x => new OfflineEntry(x.id, x.pickupCode.value, x.cellCode, customers.find(c => c.id === x.customerId).name, x.isPaid() ? 0 : x.total()));

  return {
    seq: 500, pickupPoints: [chilonzor, yunusobod], customers, operators, sellers, products, orders,
    returns, refunds, notifications: [],
    connection: { online: true, since: now },
    offlineCache: new OfflineCache(listSavedAt, offlineEntries),
    syncQueue: [], syncLog: null
  };
}
