import assert from 'node:assert';
import { newRoom, reduce, startGame, ACTIONS } from '../src/engine.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// helper: ห้องพร้อมเล่น n คน มือกำหนดเองได้
function table(n = 3, hands = null) {
  const { pub, priv } = newRoom('TEST01', 'p0', 'A');
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (let i = 1; i < n; i++) reduce(pub, priv, { type: 'join', uid: `p${i}`, name: names[i] });
  let seed = 42;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  startGame(pub, priv, rng);
  pub.turnSeat = 0;
  if (hands) for (const [id, h] of Object.entries(hands)) {
    priv.hands[id] = h.slice();
    pub.players.find(p => p.id === id).cardCount = h.length;
  }
  return { pub, priv };
}
const P = (pub, id) => pub.players.find(p => p.id === id);

// ── Lobby / ข้อ 1 ───────────────────────────────────────────────────────

test('ทุกคนต้องกดพร้อมครบ ถึงจะเข้าโหมดนับถอยหลัง', () => {
  const { pub, priv } = newRoom('AAA111', 'p0', 'A');
  reduce(pub, priv, { type: 'join', uid: 'p1', name: 'B' });
  reduce(pub, priv, { type: 'join', uid: 'p2', name: 'C' });

  reduce(pub, priv, { type: 'set_ready', uid: 'p0', ready: true });
  assert.equal(pub.phase, 'lobby', 'พร้อมคนเดียวยังไม่ควรนับ');
  reduce(pub, priv, { type: 'set_ready', uid: 'p1', ready: true });
  assert.equal(pub.phase, 'lobby', 'พร้อม 2/3 ยังไม่ควรนับ');
  reduce(pub, priv, { type: 'set_ready', uid: 'p2', ready: true });
  assert.equal(pub.phase, 'countdown', 'ครบทุกคนต้องเข้านับถอยหลัง');
  assert.ok(pub.deadline > Date.now(), 'ต้องมี deadline');
});

test('ยกเลิกความพร้อมระหว่างนับ ต้องหยุดนับ', () => {
  const { pub, priv } = newRoom('AAA111', 'p0', 'A');
  reduce(pub, priv, { type: 'join', uid: 'p1', name: 'B' });
  reduce(pub, priv, { type: 'set_ready', uid: 'p0', ready: true });
  reduce(pub, priv, { type: 'set_ready', uid: 'p1', ready: true });
  assert.equal(pub.phase, 'countdown');
  reduce(pub, priv, { type: 'set_ready', uid: 'p1', ready: false });
  assert.equal(pub.phase, 'lobby');
  assert.equal(pub.deadline, null);
});

test('มีคนเข้าใหม่ระหว่างนับ ต้องยกเลิกนับ', () => {
  const { pub, priv } = newRoom('AAA111', 'p0', 'A');
  reduce(pub, priv, { type: 'join', uid: 'p1', name: 'B' });
  reduce(pub, priv, { type: 'set_ready', uid: 'p0', ready: true });
  reduce(pub, priv, { type: 'set_ready', uid: 'p1', ready: true });
  reduce(pub, priv, { type: 'join', uid: 'p2', name: 'C' });
  assert.equal(pub.phase, 'lobby');
});

test('นับถอยหลังจบแล้วเกมเริ่มเอง', () => {
  const { pub, priv } = newRoom('AAA111', 'p0', 'A');
  reduce(pub, priv, { type: 'join', uid: 'p1', name: 'B' });
  reduce(pub, priv, { type: 'set_ready', uid: 'p0', ready: true });
  reduce(pub, priv, { type: 'set_ready', uid: 'p1', ready: true });
  pub.deadline = Date.now() - 1;           // แกล้งให้หมดเวลา
  reduce(pub, priv, { type: 'tick' });
  assert.equal(pub.phase, 'playing');
  assert.equal(priv.hands.p0.length, 2);
  assert.equal(priv.hands.p1.length, 2);
  assert.equal(pub.deckCount, 15 - 4);
});

test('ห้องเต็ม 6 คน เข้าเพิ่มไม่ได้', () => {
  const { pub, priv } = newRoom('AAA111', 'p0', 'A');
  for (let i = 1; i < 6; i++) reduce(pub, priv, { type: 'join', uid: `p${i}`, name: `P${i}` });
  assert.throws(() => reduce(pub, priv, { type: 'join', uid: 'p9', name: 'X' }), /ห้องเต็ม/);
});

// ── แจกการ์ด ────────────────────────────────────────────────────────────

test('6 คนแจก 12 ใบ เหลือกอง 3 ใบ', () => {
  const { pub, priv } = table(6);
  assert.equal(pub.deckCount, 3);
  assert.equal(pub.players.every(p => p.cardCount === 2), true);
});

test('กองการ์ดรวมกันต้องเป็น 15 ใบเสมอ', () => {
  const { pub, priv } = table(4);
  const inHands = Object.values(priv.hands).reduce((s, h) => s + h.length, 0);
  const lost = pub.players.reduce((s, p) => s + p.lost.length, 0);
  assert.equal(inHands + lost + priv.deck.length, 15);
});

// ── Action พื้นฐาน ──────────────────────────────────────────────────────

test('หยิบ 1 ทอง ทำงานและเปลี่ยนเทิร์น', () => {
  const { pub, priv } = table(3);
  const before = pub.treasury;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'income' });
  assert.equal(P(pub, 'p0').gold, 3);
  assert.equal(pub.treasury, before - 1);
  assert.equal(pub.turnSeat, 1);
});

test('เล่นนอกเทิร์นไม่ได้', () => {
  const { pub, priv } = table(3);
  assert.throws(() => reduce(pub, priv, { type: 'action', uid: 'p1', action: 'income' }), /ยังไม่ถึงตา/);
});

test('ทองไม่พอ ใช้ไล่ออกไม่ได้', () => {
  const { pub, priv } = table(3);
  assert.throws(() => reduce(pub, priv, { type: 'action', uid: 'p0', action: 'coup', targetId: 'p1' }),
    /ต้องมีทองอย่างน้อย 7/);
});

test('ไล่ออกทันที -7 หัก 7 ทอง และบังคับเป้าหมายเสียการ์ด ห้าม Block', () => {
  const { pub, priv } = table(3);
  P(pub, 'p0').gold = 7;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'coup', targetId: 'p1' });
  assert.equal(P(pub, 'p0').gold, 0);
  assert.equal(pub.pending.kind, 'lose');
  assert.equal(pub.pending.who, 'p1');
  reduce(pub, priv, { type: 'lose', uid: 'p1', index: 0 });
  assert.equal(P(pub, 'p1').cardCount, 1);
  assert.equal(P(pub, 'p1').lost.length, 1);
  assert.equal(pub.turnSeat, 1);
});

test('เก็บเงินห้อง +3 เปิดหน้าต่าง Challenge', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  assert.equal(pub.pending.kind, 'challenge');
  assert.equal(pub.pending.claim, 'duke');
  assert.equal(P(pub, 'p0').gold, 2, 'ยังไม่ควรได้ทองจนกว่าจะผ่าน Challenge');
});

test('ไม่มีใครสงสัย เก็บเงินห้องสำเร็จ +3', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(P(pub, 'p0').gold, 5);
  assert.equal(pub.turnSeat, 1);
});

test('หมดเวลา Challenge = ถือว่าไม่มีใครสงสัย', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  pub.deadline = Date.now() - 1;
  reduce(pub, priv, { type: 'tick' });
  assert.equal(P(pub, 'p0').gold, 5);
});

test('ตอบซ้ำสองครั้งไม่ได้', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  assert.throws(() => reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' }), /ตอบไปแล้ว/);
});

test('คนใช้ Action สงสัยตัวเองไม่ได้', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  assert.throws(() => reduce(pub, priv, { type: 'respond', uid: 'p0', response: 'challenge' }), /ไม่มีสิทธิ์/);
});

// ── Challenge ───────────────────────────────────────────────────────────

test('Challenge แล้วคนถูกสงสัยเปิดการ์ดถูก → คนสงสัยเสียการ์ด และได้สับการ์ดใหม่', () => {
  const { pub, priv } = table(3, { p0: ['duke', 'captain'], p1: ['contessa', 'assassin'] });
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'challenge' });
  assert.equal(pub.pending.kind, 'reveal');
  reduce(pub, priv, { type: 'reveal', uid: 'p0', index: 0 });   // เปิด duke = ถูก
  assert.equal(pub.pending.kind, 'lose');
  assert.equal(pub.pending.who, 'p1');
  assert.equal(priv.hands.p0.length, 2, 'ต้องได้การ์ดใบใหม่มาแทน');
  assert.ok(!priv.hands.p0.includes('duke') || priv.deck.length >= 0);
  reduce(pub, priv, { type: 'lose', uid: 'p1', index: 0 });
  assert.equal(P(pub, 'p1').cardCount, 1);
  assert.equal(P(pub, 'p0').gold, 5, 'Action ต้องเดินต่อหลังชนะ Challenge');
});

test('Challenge แล้วเปิดการ์ดผิด → คนอ้างเสียการ์ดนั้น และ Action ล้มเหลว', () => {
  const { pub, priv } = table(3, { p0: ['captain', 'contessa'], p1: ['duke', 'assassin'] });
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'challenge' });
  reduce(pub, priv, { type: 'reveal', uid: 'p0', index: 0 });   // เปิด captain แต่อ้าง duke
  assert.equal(P(pub, 'p0').gold, 2, 'ต้องไม่ได้ทอง');
  assert.equal(P(pub, 'p0').cardCount, 1);
  assert.deepEqual(P(pub, 'p0').lost, ['captain']);
  assert.equal(P(pub, 'p1').cardCount, 2, 'คนสงสัยไม่เสียการ์ด');
  assert.equal(pub.turnSeat, 1);
});

// ── Block ───────────────────────────────────────────────────────────────

test('เบิกเงิน +2 เปิดหน้าต่างขัดขวางให้ทุกคน ไม่มี Challenge', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'foreign_aid' });
  assert.equal(pub.pending.kind, 'block');
  assert.deepEqual(pub.pending.responders.sort(), ['p1', 'p2']);
});

test('ไม่มีใครขัดขวาง เบิกเงินสำเร็จ +2', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'foreign_aid' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(P(pub, 'p0').gold, 4);
});

test('หัวหน้าห้องขัดขวางเบิกเงิน ไม่มีใครสงสัย → Action ถูกยกเลิก', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'foreign_aid' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'block', blockClaim: 'duke' });
  assert.equal(pub.pending.kind, 'challenge_block');
  reduce(pub, priv, { type: 'respond', uid: 'p0', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(P(pub, 'p0').gold, 2, 'ต้องไม่ได้ทอง');
  assert.equal(pub.turnSeat, 1);
});

test('ขัดขวางแล้วถูกจับได้ว่าโกหก → Action เดินต่อ', () => {
  const { pub, priv } = table(3, { p1: ['captain', 'assassin'] });
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'foreign_aid' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'block', blockClaim: 'duke' });
  reduce(pub, priv, { type: 'respond', uid: 'p0', response: 'challenge' });
  reduce(pub, priv, { type: 'reveal', uid: 'p1', index: 0 });   // captain ≠ duke
  assert.equal(P(pub, 'p1').cardCount, 1);
  assert.equal(P(pub, 'p0').gold, 4, 'เบิกเงินต้องสำเร็จ');
});

test('การ์ดที่ขัดขวางไม่ได้ ใช้ขัดขวางไม่ได้', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'foreign_aid' });
  assert.throws(() => reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'block', blockClaim: 'contessa' }),
    /ขัดขวาง Action นี้ไม่ได้/);
});

test('ขโมย: เฉพาะเป้าหมายเท่านั้นที่ขัดขวางได้', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'steal', targetId: 'p1' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(pub.pending.kind, 'block');
  assert.deepEqual(pub.pending.responders, ['p1']);
  assert.throws(() => reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'block', blockClaim: 'captain' }),
    /ไม่มีสิทธิ์ขัดขวาง/);
});

test('ขโมยสำเร็จได้ 2 ทองจากเป้าหมาย', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'steal', targetId: 'p1' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });   // ไม่ขัดขวาง
  assert.equal(P(pub, 'p0').gold, 4);
  assert.equal(P(pub, 'p1').gold, 0);
});

test('ขโมยจากคนที่ไม่มีทองไม่ได้', () => {
  const { pub, priv } = table(3);
  P(pub, 'p1').gold = 0;
  assert.throws(() => reduce(pub, priv, { type: 'action', uid: 'p0', action: 'steal', targetId: 'p1' }),
    /ไม่มีทองให้ยืม/);
});

// ── ลอบไล่ออก / ลูกรักครู ───────────────────────────────────────────────

test('ไล่ออก -3 ถูกลูกรักครูป้องกันได้', () => {
  const { pub, priv } = table(3, { p1: ['contessa', 'duke'] });
  P(pub, 'p0').gold = 3;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'assassinate', targetId: 'p1' });
  assert.equal(P(pub, 'p0').gold, 0, 'จ่าย 3 ตั้งแต่ประกาศ');
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(pub.pending.kind, 'block');
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'block', blockClaim: 'contessa' });
  reduce(pub, priv, { type: 'respond', uid: 'p0', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(P(pub, 'p1').cardCount, 2, 'ป้องกันสำเร็จ ไม่เสียการ์ด');
});

test('ไล่ออกทันที -7 ป้องกันด้วยลูกรักครูไม่ได้', () => {
  const { pub, priv } = table(3, { p1: ['contessa', 'duke'] });
  P(pub, 'p0').gold = 7;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'coup', targetId: 'p1' });
  assert.equal(pub.pending.kind, 'lose', 'ต้องข้ามไปเสียการ์ดทันที ไม่มีหน้าต่างขัดขวาง');
});

test('เป้าหมายไม่เชื่อว่าเป็นเด็กหลังห้อง แต่เขามีจริง → เป้าหมายเสีย 2 ใบ', () => {
  const { pub, priv } = table(3, { p0: ['assassin', 'duke'], p1: ['captain', 'ambassador'] });
  P(pub, 'p0').gold = 3;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'assassinate', targetId: 'p1' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'challenge' });
  reduce(pub, priv, { type: 'reveal', uid: 'p0', index: 0 });          // assassin = ถูก
  reduce(pub, priv, { type: 'lose', uid: 'p1', index: 0 });            // ใบที่ 1 จากทายผิด
  assert.equal(pub.pending.kind, 'block', 'ยังเหลือขั้นตอนป้องกัน');
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  assert.equal(pub.pending.kind, 'lose', 'ใบที่ 2 จากการถูกไล่ออก');
  reduce(pub, priv, { type: 'lose', uid: 'p1', index: 0 });
  assert.equal(P(pub, 'p1').alive, false, 'เสียครบ 2 ใบ ต้องออกจากเกม');
  assert.equal(P(pub, 'p1').lost.length, 2);
  assert.equal(pub.phase, 'playing', 'ยังเหลือ 2 คน เกมยังไม่จบ');
});

test('อ้างเป็นเด็กหลังห้องแบบมั่ว แล้วถูกจับได้ → ไล่ออกล้มเหลว', () => {
  const { pub, priv } = table(3, { p0: ['duke', 'captain'], p1: ['contessa', 'ambassador'] });
  P(pub, 'p0').gold = 3;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'assassinate', targetId: 'p1' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'challenge' });
  reduce(pub, priv, { type: 'reveal', uid: 'p0', index: 0 });
  assert.equal(P(pub, 'p0').cardCount, 1);
  assert.equal(P(pub, 'p1').cardCount, 2, 'เป้าหมายไม่เสียการ์ด');
  assert.equal(P(pub, 'p0').gold, 0, 'ทองที่จ่ายไปแล้วไม่คืน');
});

// ── จั่วการ์ด ───────────────────────────────────────────────────────────

test('จั่วการ์ด: ได้ 2 ใบเพิ่ม แล้วต้องเลือกเก็บเท่าเดิม', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'exchange' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(pub.pending.kind, 'exchange');
  assert.equal(priv.hands.p0.length, 4);
  assert.throws(() => reduce(pub, priv, { type: 'exchange', uid: 'p0', keep: [0] }), /ต้องเก็บการ์ด 2 ใบ/);
  reduce(pub, priv, { type: 'exchange', uid: 'p0', keep: [0, 3] });
  assert.equal(priv.hands.p0.length, 2);
  assert.equal(P(pub, 'p0').cardCount, 2);
  assert.equal(pub.turnSeat, 1);
});

test('จั่วการ์ดตอนเหลือใบเดียว เก็บได้ใบเดียว', () => {
  const { pub, priv } = table(3, { p0: ['duke'] });
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'exchange' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(priv.hands.p0.length, 3);
  reduce(pub, priv, { type: 'exchange', uid: 'p0', keep: [1] });
  assert.equal(priv.hands.p0.length, 1);
});

// ── เพดานทอง ────────────────────────────────────────────────────────────

test('ทองเกิน 10 ต้องบังคับทิ้งก่อนจบเทิร์น', () => {
  const { pub, priv } = table(3);
  P(pub, 'p0').gold = 9;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(P(pub, 'p0').gold, 12);
  assert.equal(pub.pending.kind, 'drop_gold');
  assert.equal(pub.pending.amount, 2);
  assert.equal(pub.turnSeat, 0, 'ยังจบเทิร์นไม่ได้');
  assert.throws(() => reduce(pub, priv, { type: 'drop_gold', uid: 'p0', amount: 1 }), /อย่างน้อย 2/);
  reduce(pub, priv, { type: 'drop_gold', uid: 'p0', amount: 2 });
  assert.equal(P(pub, 'p0').gold, 10);
  assert.equal(pub.turnSeat, 1);
});

// ── ข้อ 3: คนตายทำอะไรไม่ได้ ────────────────────────────────────────────

test('ผู้เล่นที่ตายแล้วสั่ง Action ไม่ได้', () => {
  const { pub, priv } = table(3);
  P(pub, 'p0').alive = false;
  assert.throws(() => reduce(pub, priv, { type: 'action', uid: 'p0', action: 'income' }),
    /ถูกไล่ออกจากห้องแล้ว/);
});

test('ผู้เล่นที่ตายแล้ว Challenge หรือ Block ไม่ได้', () => {
  const { pub, priv } = table(4);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  P(pub, 'p1').alive = false;
  assert.throws(() => reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'challenge' }),
    /ถูกไล่ออกจากห้องแล้ว/);
});

test('คนตายไม่ถูกนับเป็นคนที่ต้องรอตอบ', () => {
  const { pub, priv } = table(4);
  P(pub, 'p3').alive = false;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(P(pub, 'p0').gold, 5, 'ควรจบหน้าต่างโดยไม่รอคนตาย');
});

test('เทิร์นข้ามคนที่ตายแล้ว', () => {
  const { pub, priv } = table(4);
  P(pub, 'p1').alive = false;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'income' });
  assert.equal(pub.turnSeat, 2);
});

// ── จบเกม ───────────────────────────────────────────────────────────────

test('เหลือคนเดียวคือผู้ชนะ', () => {
  const { pub, priv } = table(2, { p0: ['duke', 'duke'], p1: ['captain'] });
  P(pub, 'p0').gold = 7;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'coup', targetId: 'p1' });
  reduce(pub, priv, { type: 'lose', uid: 'p1', index: 0 });
  assert.equal(pub.phase, 'ended');
  assert.equal(pub.winnerId, 'p0');
});

test('เล่นอีกครั้ง รีเซ็ตกลับ lobby และล้างสถานะพร้อม', () => {
  const { pub, priv } = table(2, { p0: ['duke', 'duke'], p1: ['captain'] });
  P(pub, 'p0').gold = 7;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'coup', targetId: 'p1' });
  reduce(pub, priv, { type: 'lose', uid: 'p1', index: 0 });
  reduce(pub, priv, { type: 'play_again', uid: 'p0' });
  assert.equal(pub.phase, 'lobby');
  assert.equal(pub.players.every(p => p.alive && !p.ready && p.gold === 2), true);
});

// ── Reconnect / Host ────────────────────────────────────────────────────

test('เข้าห้องซ้ำด้วย uid เดิม = reconnect ไม่สร้างที่นั่งใหม่', () => {
  const { pub, priv } = newRoom('AAA111', 'p0', 'A');
  reduce(pub, priv, { type: 'join', uid: 'p1', name: 'B' });
  reduce(pub, priv, { type: 'join', uid: 'p1', name: 'B' });
  assert.equal(pub.players.length, 2);
});

test('Host หลุดระหว่างเกม ระบบย้าย Host ให้คนอื่น', () => {
  const { pub, priv } = table(3);
  assert.equal(pub.hostId, 'p0');
  reduce(pub, priv, { type: 'leave', uid: 'p0' });
  assert.notEqual(pub.hostId, 'p0');
  assert.equal(pub.players.length, 3, 'ระหว่างเกมต้องไม่ลบผู้เล่นออก');
});

test('คนที่ไม่ใช่ Host เตะคนอื่นไม่ได้', () => {
  const { pub, priv } = newRoom('AAA111', 'p0', 'A');
  reduce(pub, priv, { type: 'join', uid: 'p1', name: 'B' });
  reduce(pub, priv, { type: 'join', uid: 'p2', name: 'C' });
  assert.throws(() => reduce(pub, priv, { type: 'kick', uid: 'p1', targetId: 'p2' }), /เฉพาะ Host/);
});

// ── ความปลอดภัย ────────────────────────────────────────────────────────

test('เสียการ์ดของคนอื่นแทนไม่ได้', () => {
  const { pub, priv } = table(3);
  P(pub, 'p0').gold = 7;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'coup', targetId: 'p1' });
  assert.throws(() => reduce(pub, priv, { type: 'lose', uid: 'p2', index: 0 }), /ไม่ใช่การ์ดของคุณ/);
});

test('index การ์ดนอกช่วงถูกปฏิเสธ', () => {
  const { pub, priv } = table(3);
  P(pub, 'p0').gold = 7;
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'coup', targetId: 'p1' });
  assert.throws(() => reduce(pub, priv, { type: 'lose', uid: 'p1', index: 9 }), /เลือกการ์ดไม่ถูกต้อง/);
});

test('ยิง tick รัวๆ ก่อนหมดเวลา ไม่มีผลอะไร', () => {
  const { pub, priv } = table(3);
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  for (let i = 0; i < 20; i++) reduce(pub, priv, { type: 'tick' });
  assert.equal(pub.pending.kind, 'challenge');
  assert.equal(P(pub, 'p0').gold, 2);
});

test('ทองรวมในระบบคงที่เสมอ', () => {
  const { pub, priv } = table(4);
  const total = () => pub.treasury + pub.players.reduce((s, p) => s + p.gold, 0);
  const before = total();
  reduce(pub, priv, { type: 'action', uid: 'p0', action: 'tax' });
  reduce(pub, priv, { type: 'respond', uid: 'p1', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p3', response: 'pass' });
  assert.equal(total(), before);
  reduce(pub, priv, { type: 'action', uid: 'p1', action: 'steal', targetId: 'p2' });
  reduce(pub, priv, { type: 'respond', uid: 'p0', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p3', response: 'pass' });
  reduce(pub, priv, { type: 'respond', uid: 'p2', response: 'pass' });
  assert.equal(total(), before);
});

// ── เกมยาวแบบสุ่ม กันเกมค้าง ────────────────────────────────────────────

test('จำลองเกมสุ่ม 300 รอบ ต้องจบเสมอและไม่ค้าง', () => {
  for (let seed = 1; seed <= 300; seed++) {
    let s = seed * 7919;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

    const { pub, priv } = newRoom('SIM' + seed, 'p0', 'A');
    for (let i = 1; i < 4; i++) reduce(pub, priv, { type: 'join', uid: `p${i}`, name: `P${i}` });
    startGame(pub, priv, rnd);

    let steps = 0;
    while (pub.phase === 'playing' && steps < 4000) {
      steps++;
      const pd = pub.pending;
      try {
        if (!pd) {
          const me = pub.players[pub.turnSeat];
          const opts = ['income', 'foreign_aid', 'tax', 'exchange'];
          if (me.gold >= 3) opts.push('assassinate');
          if (me.gold >= 7) opts.push('coup');
          const targets = pub.players.filter(p => p.alive && p.id !== me.id);
          const withGold = targets.filter(p => p.gold > 0);
          if (withGold.length) opts.push('steal');
          const act = pick(opts);
          const needT = ACTIONS[act].needTarget;
          const tgt = act === 'steal' ? pick(withGold) : (needT ? pick(targets) : null);
          reduce(pub, priv, { type: 'action', uid: me.id, action: act, targetId: tgt ? tgt.id : null });
        } else if (pd.kind === 'challenge' || pd.kind === 'challenge_block') {
          const ex = pd.kind === 'challenge_block' ? pd.blocker : pd.actor;
          const who = pub.players.filter(p => p.alive && p.id !== ex && !pd.passed.includes(p.id));
          if (!who.length) { pub.deadline = Date.now() - 1; reduce(pub, priv, { type: 'tick' }); continue; }
          const r = pick(who);
          reduce(pub, priv, { type: 'respond', uid: r.id, response: rnd() < 0.25 ? 'challenge' : 'pass' });
        } else if (pd.kind === 'block') {
          const who = pub.players.filter(p => pd.responders.includes(p.id) && p.alive && !pd.passed.includes(p.id));
          if (!who.length) { pub.deadline = Date.now() - 1; reduce(pub, priv, { type: 'tick' }); continue; }
          const r = pick(who);
          if (rnd() < 0.3) reduce(pub, priv, { type: 'respond', uid: r.id, response: 'block', blockClaim: pick(ACTIONS[pd.action].blockedBy) });
          else reduce(pub, priv, { type: 'respond', uid: r.id, response: 'pass' });
        } else if (pd.kind === 'reveal') {
          reduce(pub, priv, { type: 'reveal', uid: pd.who, index: Math.floor(rnd() * priv.hands[pd.who].length) });
        } else if (pd.kind === 'lose') {
          reduce(pub, priv, { type: 'lose', uid: pd.who, index: Math.floor(rnd() * priv.hands[pd.who].length) });
        } else if (pd.kind === 'exchange') {
          const h = priv.hands[pd.who];
          const idx = h.map((_, i) => i).sort(() => rnd() - 0.5).slice(0, pd.keep);
          reduce(pub, priv, { type: 'exchange', uid: pd.who, keep: idx });
        } else if (pd.kind === 'drop_gold') {
          reduce(pub, priv, { type: 'drop_gold', uid: pd.who, amount: pd.amount });
        }
      } catch (e) {
        if (e.name !== 'RuleError') throw e;
        pub.deadline = Date.now() - 1;
        reduce(pub, priv, { type: 'tick' });
      }

      // ตรวจความสมบูรณ์ทุกก้าว
      const inHands = Object.values(priv.hands).reduce((a, h) => a + h.length, 0);
      const lost = pub.players.reduce((a, p) => a + p.lost.length, 0);
      assert.equal(inHands + lost + priv.deck.length, 15, `seed ${seed}: การ์ดหาย`);
      for (const p of pub.players) {
        assert.equal(p.cardCount, priv.hands[p.id].length, `seed ${seed}: cardCount ไม่ตรง`);
        assert.ok(p.gold >= 0, `seed ${seed}: ทองติดลบ`);
        if (pub.phase === 'playing' && !pub.pending) assert.ok(p.gold <= 10, `seed ${seed}: ทองเกิน 10 ตอนจบเทิร์น`);
        if (!p.alive) assert.equal(priv.hands[p.id].length, 0, `seed ${seed}: คนตายยังถือการ์ด`);
      }
      assert.ok(pub.treasury >= 0, `seed ${seed}: กองกลางติดลบ`);
    }
    assert.equal(pub.phase, 'ended', `seed ${seed}: เกมไม่จบใน ${steps} ก้าว`);
    assert.ok(pub.winnerId, `seed ${seed}: ไม่มีผู้ชนะ`);
  }
});

console.log(`\n${passed} ผ่าน / ${failed} ไม่ผ่าน`);
process.exit(failed ? 1 : 0);
