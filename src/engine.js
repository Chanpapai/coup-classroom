/**
 * COUP : ห้องเรียน — Rules engine
 *
 * ตัวนี้คือ "สมองของเกม" ทั้งหมด รันบน Supabase Edge Function เท่านั้น
 * Client ไม่มีสิทธิ์ตัดสินอะไรเอง ส่งได้แค่ "ฉันอยากทำ X" แล้วรอผลกลับ
 *
 * โครงสร้าง state แยกเป็น 2 ก้อน:
 *   pub  = ข้อมูลสาธารณะ ทุกคนเห็นได้ (ทอง, จำนวนการ์ด, เทิร์น, การ์ดที่ถูกกำจัด)
 *   priv = ความลับ ห้ามหลุด (กองการ์ด + การ์ดในมือของทุกคน)
 */

export const CARD_IDS = ['duke', 'captain', 'ambassador', 'contessa', 'assassin'];

export const MAX_GOLD = 10;
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;

/** เวลาทุกอันคิดจากนาฬิกาเซิร์ฟเวอร์ ไม่ใช่เครื่องผู้เล่น */
export const TIMERS = {
  lobbyCountdown: 10000,
  challenge: 10000,
  block: 10000,
  choose: 20000,
};

/**
 * ตารางกติกาของแต่ละ Action
 *  claim    = ต้องอ้างสิทธิ์เป็นตัวละครไหน (null = ไม่ต้องอ้าง จึง Challenge ไม่ได้)
 *  blockedBy= ขัดขวางได้ด้วยการ์ดอะไรบ้าง
 *  blockWho = ใครมีสิทธิ์ขัดขวาง ('target' = เฉพาะเป้าหมาย, 'any' = ใครก็ได้)
 */
export const ACTIONS = {
  income:      { cost: 0, claim: null,         needTarget: false, blockedBy: null,                        blockWho: null },
  foreign_aid: { cost: 0, claim: null,         needTarget: false, blockedBy: ['duke'],                    blockWho: 'any' },
  tax:         { cost: 0, claim: 'duke',       needTarget: false, blockedBy: null,                        blockWho: null },
  steal:       { cost: 0, claim: 'captain',    needTarget: true,  blockedBy: ['captain', 'ambassador'],   blockWho: 'target' },
  exchange:    { cost: 0, claim: 'ambassador', needTarget: false, blockedBy: null,                        blockWho: null },
  assassinate: { cost: 3, claim: 'assassin',   needTarget: true,  blockedBy: ['contessa'],                blockWho: 'target' },
  coup:        { cost: 7, claim: null,         needTarget: true,  blockedBy: null,                        blockWho: null },
};

export const CARD_NAME_TH = {
  duke: 'หัวหน้าห้อง',
  captain: 'เด็กชอบขโมยของ',
  ambassador: 'เด็กมีปัญหา',
  contessa: 'ลูกรักครู',
  assassin: 'เด็กหลังห้อง',
};

export const ACTION_NAME_TH = {
  income: 'หยิบ 1 ทอง',
  foreign_aid: 'เบิกเงิน',
  tax: 'เก็บเงินห้อง',
  steal: 'ยืมของ',
  exchange: 'จั่วการ์ด',
  assassinate: 'ไล่ออกจากห้อง',
  coup: 'ไล่ออกทันที',
};

// ── ตัวช่วยเล็กๆ ────────────────────────────────────────────────────────

class RuleError extends Error {
  constructor(msg) { super(msg); this.name = 'RuleError'; }
}
export const fail = (msg) => { throw new RuleError(msg); };

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeRoomCode(rng = Math.random) {
  // ตัดตัวที่สับสนออก: 0/O, 1/I
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

const findPlayer = (pub, id) => pub.players.find((p) => p.id === id);
const alivePlayers = (pub) => pub.players.filter((p) => p.alive);

function log(pub, text) {
  pub.log.push({ t: text, at: Date.now() });
  if (pub.log.length > 40) pub.log.splice(0, pub.log.length - 40);
}

function setPending(pub, pending, ttl) {
  pub.pending = pending;
  pub.deadline = pending ? Date.now() + ttl : null;
}

function clearPending(pub) {
  pub.pending = null;
  pub.deadline = null;
}

// ── สร้างห้อง / เข้าห้อง ────────────────────────────────────────────────

export function newRoom(code, hostId, hostName) {
  const pub = {
    code,
    hostId,
    phase: 'lobby',        // lobby | countdown | playing | ended
    round: 1,
    turnSeat: null,
    treasury: 50,
    deckCount: 0,
    players: [],
    pending: null,
    deadline: null,
    winnerId: null,
    log: [],
    createdAt: Date.now(),
  };
  const priv = { deck: [], hands: {} };
  addPlayer(pub, priv, hostId, hostName);
  log(pub, `${hostName} สร้างห้อง`);
  return { pub, priv };
}

function addPlayer(pub, priv, id, name) {
  const seat = pub.players.length;
  pub.players.push({
    id, name, seat,
    gold: 2,
    ready: false,
    alive: true,
    cardCount: 0,
    lost: [],
    connected: true,
    lastSeen: Date.now(),
  });
  priv.hands[id] = [];
}

// ── ตัวจัดการเหตุการณ์หลัก ──────────────────────────────────────────────

/**
 * ทุก event ต้องผ่านที่นี่ ถ้าผิดกติกาจะโยน RuleError แล้ว state เดิมไม่ถูกแตะ
 * (Edge Function จะ deep-clone ก่อนเรียก แล้วค่อยเซฟถ้าไม่ error)
 */
export function reduce(pub, priv, ev) {
  switch (ev.type) {
    case 'join':        return evJoin(pub, priv, ev);
    case 'set_ready':   return evSetReady(pub, priv, ev);
    case 'leave':       return evLeave(pub, priv, ev);
    case 'kick':        return evKick(pub, priv, ev);
    case 'heartbeat':   return evHeartbeat(pub, priv, ev);
    case 'action':      return evAction(pub, priv, ev);
    case 'respond':     return evRespond(pub, priv, ev);
    case 'reveal':      return evReveal(pub, priv, ev);
    case 'lose':        return evLose(pub, priv, ev);
    case 'exchange':    return evExchange(pub, priv, ev);
    case 'drop_gold':   return evDropGold(pub, priv, ev);
    case 'play_again':  return evPlayAgain(pub, priv, ev);
    case 'tick':        return evTick(pub, priv, ev);
    default:            return fail('ไม่รู้จักคำสั่งนี้');
  }
}

function evJoin(pub, priv, { uid, name }) {
  const existing = findPlayer(pub, uid);
  if (existing) {                       // reconnect — กลับเข้าที่เดิม
    existing.connected = true;
    existing.lastSeen = Date.now();
    return;
  }
  if (pub.phase !== 'lobby' && pub.phase !== 'countdown') fail('เกมเริ่มไปแล้ว เข้าร่วมไม่ได้');
  if (pub.players.length >= MAX_PLAYERS) fail('ห้องเต็มแล้ว');
  const clean = String(name || '').trim().slice(0, 12) || 'ผู้เล่น';
  addPlayer(pub, priv, uid, clean);
  log(pub, `${clean} เข้าห้อง`);
  cancelCountdown(pub, 'มีคนเข้าห้องใหม่');
}

function evHeartbeat(pub, priv, { uid }) {
  const p = findPlayer(pub, uid);
  if (!p) return;
  p.connected = true;
  p.lastSeen = Date.now();
}

/**
 * ข้อ 1 — ทุกคนต้องกดพร้อมครบทุกคน แล้วนับถอยหลัง 10 วิ แล้วเริ่มเองอัตโนมัติ
 * ไม่มีปุ่ม "Host เริ่มเกม" อีกต่อไป
 */
function evSetReady(pub, priv, { uid, ready }) {
  if (pub.phase !== 'lobby' && pub.phase !== 'countdown') fail('ตอนนี้กดพร้อมไม่ได้');
  const p = findPlayer(pub, uid);
  if (!p) fail('คุณไม่ได้อยู่ในห้องนี้');
  p.ready = !!ready;

  const everyoneReady = pub.players.length >= MIN_PLAYERS && pub.players.every((x) => x.ready);

  if (everyoneReady && pub.phase === 'lobby') {
    pub.phase = 'countdown';
    pub.deadline = Date.now() + TIMERS.lobbyCountdown;
    log(pub, 'ทุกคนพร้อมแล้ว เริ่มนับถอยหลัง');
  } else if (!everyoneReady && pub.phase === 'countdown') {
    cancelCountdown(pub, `${p.name} ยกเลิกความพร้อม`);
  }
}

function cancelCountdown(pub, reason) {
  if (pub.phase !== 'countdown') return;
  pub.phase = 'lobby';
  pub.deadline = null;
  log(pub, `ยกเลิกนับถอยหลัง — ${reason}`);
}

function evLeave(pub, priv, { uid }) {
  const p = findPlayer(pub, uid);
  if (!p) return;

  if (pub.phase === 'lobby' || pub.phase === 'countdown') {
    pub.players = pub.players.filter((x) => x.id !== uid);
    delete priv.hands[uid];
    pub.players.forEach((x, i) => { x.seat = i; });
    log(pub, `${p.name} ออกจากห้อง`);
    if (pub.hostId === uid && pub.players.length) pub.hostId = pub.players[0].id;
    cancelCountdown(pub, 'มีคนออกจากห้อง');
  } else {
    // ระหว่างเกม: ไม่ลบออก แค่ mark ว่าหลุด เผื่อกลับมา (ระบบ Reconnect)
    p.connected = false;
    if (pub.hostId === uid) {
      const nextHost = pub.players.find((x) => x.connected && x.id !== uid);
      if (nextHost) { pub.hostId = nextHost.id; log(pub, `${nextHost.name} เป็น Host คนใหม่`); }
    }
  }
}

function evKick(pub, priv, { uid, targetId }) {
  if (pub.hostId !== uid) fail('เฉพาะ Host เท่านั้นที่เตะผู้เล่นได้');
  if (pub.phase !== 'lobby' && pub.phase !== 'countdown') fail('เกมเริ่มแล้ว เตะไม่ได้');
  if (targetId === uid) fail('เตะตัวเองไม่ได้');
  const t = findPlayer(pub, targetId);
  if (!t) fail('ไม่พบผู้เล่นคนนี้');
  pub.players = pub.players.filter((x) => x.id !== targetId);
  delete priv.hands[targetId];
  pub.players.forEach((x, i) => { x.seat = i; });
  log(pub, `${t.name} ถูกเชิญออกจากห้อง`);
  cancelCountdown(pub, 'มีคนถูกเตะออก');
}

// ── เริ่มเกม ────────────────────────────────────────────────────────────

export function startGame(pub, priv, rng = Math.random) {
  const n = pub.players.length;
  if (n < MIN_PLAYERS) fail('ต้องมีผู้เล่นอย่างน้อย 2 คน');

  let deck = [];
  for (const c of CARD_IDS) deck.push(c, c, c);   // 5 ตัวละคร × 3 ใบ = 15 ใบ
  deck = shuffle(deck, rng);

  for (const p of pub.players) {
    priv.hands[p.id] = [deck.pop(), deck.pop()];
    p.cardCount = 2;
    p.gold = 2;
    p.alive = true;
    p.lost = [];
  }

  priv.deck = deck;
  pub.deckCount = deck.length;
  pub.treasury = 50 - n * 2;
  pub.phase = 'playing';
  pub.round = 1;
  pub.winnerId = null;
  pub.turnSeat = Math.floor(rng() * n);
  clearPending(pub);
  log(pub, `เริ่มเกม — ตาแรกของ ${pub.players[pub.turnSeat].name}`);
}

// ── กองการ์ด ────────────────────────────────────────────────────────────

function drawCard(pub, priv, rng = Math.random) {
  if (!priv.deck.length) priv.deck = shuffle(priv.deck, rng);
  const c = priv.deck.pop();
  pub.deckCount = priv.deck.length;
  return c;
}

function returnCard(pub, priv, card, rng = Math.random) {
  priv.deck.push(card);
  priv.deck = shuffle(priv.deck, rng);
  pub.deckCount = priv.deck.length;
}

function syncCount(pub, priv, id) {
  const p = findPlayer(pub, id);
  if (p) p.cardCount = (priv.hands[id] || []).length;
}

// ── ทอง ─────────────────────────────────────────────────────────────────

function takeFromTreasury(pub, p, amount) {
  const got = Math.min(amount, pub.treasury);
  pub.treasury -= got;
  p.gold += got;
  return got;
}

/**
 * เพดานทอง 10 — ถ้าเกินต้องบังคับให้ทิ้งก่อน จบเทิร์นไม่ได้
 * คืนค่า true ถ้าต้องหยุดรอผู้เล่นทิ้งทอง
 */
function enforceGoldCap(pub, p, next) {
  if (p.gold <= MAX_GOLD) return false;
  const over = p.gold - MAX_GOLD;
  setPending(pub, { kind: 'drop_gold', who: p.id, amount: over, next }, TIMERS.choose);
  log(pub, `${p.name} มีทองเกิน ${MAX_GOLD} ต้องนำออก ${over}`);
  return true;
}

// ── เทิร์นและการจบเกม ───────────────────────────────────────────────────

function checkWin(pub) {
  const alive = alivePlayers(pub);
  if (alive.length <= 1) {
    pub.phase = 'ended';
    pub.winnerId = alive[0] ? alive[0].id : null;
    clearPending(pub);
    if (alive[0]) log(pub, `🎉 ${alive[0].name} เป็นผู้รอดชีวิตคนสุดท้าย`);
    return true;
  }
  return false;
}

function nextTurn(pub) {
  clearPending(pub);
  if (checkWin(pub)) return;

  const n = pub.players.length;
  let seat = pub.turnSeat;
  for (let i = 0; i < n; i++) {
    seat = (seat + 1) % n;
    if (seat === 0) pub.round += 1;
    if (pub.players[seat].alive) break;
  }
  pub.turnSeat = seat;
}

function eliminateIfEmpty(pub, priv, id) {
  const p = findPlayer(pub, id);
  if (!p || !p.alive) return;
  if ((priv.hands[id] || []).length === 0) {
    p.alive = false;
    p.ready = false;
    log(pub, `${p.name} ถูกไล่ออกจากห้องแล้ว`);
  }
}

// ── Action ──────────────────────────────────────────────────────────────

function requireTurn(pub, uid) {
  if (pub.phase !== 'playing') fail('ยังไม่ถึงเวลาเล่น');
  const p = findPlayer(pub, uid);
  if (!p) fail('คุณไม่ได้อยู่ในห้องนี้');
  // ข้อ 3 — คนที่ตายแล้วทำอะไรไม่ได้เลย กันไว้ที่เซิร์ฟเวอร์ ไม่ใช่แค่ซ่อนปุ่ม
  if (!p.alive) fail('คุณถูกไล่ออกจากห้องแล้ว ดูได้อย่างเดียว');
  if (pub.players[pub.turnSeat].id !== uid) fail('ยังไม่ถึงตาของคุณ');
  if (pub.pending) fail('ยังมีเรื่องค้างอยู่');
  return p;
}

function evAction(pub, priv, { uid, action, targetId }) {
  const me = requireTurn(pub, uid);
  const def = ACTIONS[action];
  if (!def) fail('ไม่รู้จัก Action นี้');
  if (me.gold < def.cost) fail(`ต้องมีทองอย่างน้อย ${def.cost}`);

  let target = null;
  if (def.needTarget) {
    target = findPlayer(pub, targetId);
    if (!target) fail('ต้องเลือกเป้าหมาย');
    if (!target.alive) fail('เป้าหมายถูกไล่ออกไปแล้ว');
    if (target.id === uid) fail('เลือกตัวเองไม่ได้');
    if (action === 'steal' && target.gold <= 0) fail('เป้าหมายไม่มีทองให้ยืม');
  }

  // จ่ายค่า Action ทันทีตั้งแต่ประกาศ (ถูก Block ก็ไม่คืน — เหมือนต้นฉบับ)
  if (def.cost > 0) { me.gold -= def.cost; pub.treasury += def.cost; }

  const ctx = { action, actor: uid, target: target ? target.id : null };
  log(pub, `${me.name} ใช้ "${ACTION_NAME_TH[action]}"${target ? ` ใส่ ${target.name}` : ''}`);

  if (def.claim) {
    setPending(pub, { kind: 'challenge', ...ctx, claim: def.claim, passed: [] }, TIMERS.challenge);
  } else if (def.blockedBy) {
    // ถ้าไม่มีใครมีสิทธิ์ขัดขวางเลย ให้ลงมือทันที ไม่งั้นเทิร์นจะค้าง
    if (!openBlockWindow(pub, ctx)) applyAction(pub, priv, ctx);
  } else {
    applyAction(pub, priv, ctx);
  }
}

function challengeEligible(pub, pending) {
  // ทุกคนที่ยังไม่ตาย ยกเว้นคนที่กำลังถูกสงสัย
  const exclude = pending.kind === 'challenge_block' ? pending.blocker : pending.actor;
  return alivePlayers(pub).filter((p) => p.id !== exclude).map((p) => p.id);
}

function openBlockWindow(pub, ctx) {
  const def = ACTIONS[ctx.action];
  const responders = def.blockWho === 'target'
    ? (ctx.target ? [ctx.target] : [])
    : alivePlayers(pub).filter((p) => p.id !== ctx.actor).map((p) => p.id);

  const live = responders.filter((id) => { const p = findPlayer(pub, id); return p && p.alive; });
  if (!live.length) return null;  // ไม่มีใครขัดขวางได้ → ให้ผู้เรียกไป applyAction ต่อ

  setPending(pub, { kind: 'block', ...ctx, responders: live, passed: [] }, TIMERS.block);
  return true;
}

/** Challenge ผ่านไปแล้ว (ไม่มีใครสงสัย หรือสงสัยแล้วแพ้) → ไปด่าน Block หรือลงมือเลย */
function afterChallengePassed(pub, priv, ctx) {
  const def = ACTIONS[ctx.action];
  if (def.blockedBy) {
    const opened = openBlockWindow(pub, ctx);
    if (opened) return;
  }
  applyAction(pub, priv, ctx);
}

function evRespond(pub, priv, { uid, response, blockClaim }) {
  const pd = pub.pending;
  if (!pd) fail('ตอนนี้ไม่มีอะไรให้ตอบ');
  const me = findPlayer(pub, uid);
  if (!me) fail('คุณไม่ได้อยู่ในห้องนี้');
  if (!me.alive) fail('คุณถูกไล่ออกจากห้องแล้ว ดูได้อย่างเดียว');

  if (pd.kind === 'challenge' || pd.kind === 'challenge_block') {
    const eligible = challengeEligible(pub, pd);
    if (!eligible.includes(uid)) fail('คุณไม่มีสิทธิ์ตอบตอนนี้');
    if (pd.passed.includes(uid)) fail('คุณตอบไปแล้ว');

    if (response === 'pass') {
      pd.passed.push(uid);
      if (eligible.every((id) => pd.passed.includes(id))) resolveNoChallenge(pub, priv, pd);
      return;
    }
    if (response === 'challenge') {
      const suspectId = pd.kind === 'challenge_block' ? pd.blocker : pd.actor;
      const claim = pd.kind === 'challenge_block' ? pd.blockClaim : pd.claim;
      const suspect = findPlayer(pub, suspectId);
      log(pub, `${me.name} ไม่เชื่อว่า ${suspect.name} เป็น ${CARD_NAME_TH[claim]}`);
      setPending(pub, {
        kind: 'reveal',
        who: suspectId,
        claim,
        challenger: uid,
        isBlock: pd.kind === 'challenge_block',
        action: pd.action, actor: pd.actor, target: pd.target,
        blocker: pd.blocker || null, blockClaim: pd.blockClaim || null,
      }, TIMERS.choose);
      return;
    }
    fail('คำตอบไม่ถูกต้อง');
  }

  if (pd.kind === 'block') {
    if (!pd.responders.includes(uid)) fail('คุณไม่มีสิทธิ์ขัดขวาง Action นี้');
    if (pd.passed.includes(uid)) fail('คุณตอบไปแล้ว');

    if (response === 'pass') {
      pd.passed.push(uid);
      if (pd.responders.every((id) => pd.passed.includes(id))) {
        applyAction(pub, priv, { action: pd.action, actor: pd.actor, target: pd.target });
      }
      return;
    }
    if (response === 'block') {
      const allowed = ACTIONS[pd.action].blockedBy || [];
      if (!allowed.includes(blockClaim)) fail('การ์ดใบนี้ขัดขวาง Action นี้ไม่ได้');
      log(pub, `${me.name} ขัดขวางโดยอ้างว่าเป็น ${CARD_NAME_TH[blockClaim]}`);
      setPending(pub, {
        kind: 'challenge_block',
        action: pd.action, actor: pd.actor, target: pd.target,
        blocker: uid, blockClaim, passed: [],
      }, TIMERS.challenge);
      return;
    }
    fail('คำตอบไม่ถูกต้อง');
  }

  fail('ตอนนี้ตอบแบบนี้ไม่ได้');
}

function resolveNoChallenge(pub, priv, pd) {
  if (pd.kind === 'challenge') {
    afterChallengePassed(pub, priv, { action: pd.action, actor: pd.actor, target: pd.target });
  } else {
    // ไม่มีใครสงสัยคนขัดขวาง → ขัดขวางสำเร็จ Action ถูกยกเลิก
    const b = findPlayer(pub, pd.blocker);
    log(pub, `ขัดขวางสำเร็จ — ${ACTION_NAME_TH[pd.action]} ถูกยกเลิก (${b ? b.name : ''})`);
    nextTurn(pub);
  }
}

// ── เปิดการ์ดตอนถูก Challenge ───────────────────────────────────────────

function evReveal(pub, priv, { uid, index }) {
  const pd = pub.pending;
  if (!pd || pd.kind !== 'reveal') fail('ตอนนี้ไม่ต้องเปิดการ์ด');
  if (pd.who !== uid) fail('ไม่ใช่การ์ดของคุณ');
  const hand = priv.hands[uid] || [];
  if (index < 0 || index >= hand.length) fail('เลือกการ์ดไม่ถูกต้อง');

  const card = hand[index];
  const me = findPlayer(pub, uid);
  const challenger = findPlayer(pub, pd.challenger);
  const ctx = { action: pd.action, actor: pd.actor, target: pd.target };

  if (card === pd.claim) {
    // อ้างสิทธิ์ถูกต้อง — คนสงสัยเสียการ์ด ส่วนคนถูกสงสัยได้สับการ์ดใหม่
    log(pub, `อ้างสิทธิ์ถูกต้อง! ${me.name} มี ${CARD_NAME_TH[card]} จริง`);
    hand.splice(index, 1);
    returnCard(pub, priv, card);
    hand.push(drawCard(pub, priv));
    syncCount(pub, priv, uid);

    const after = pd.isBlock
      ? { do: 'block_success', ...ctx, blocker: pd.blocker }
      : { do: 'after_challenge', ...ctx };

    setPending(pub, { kind: 'lose', who: pd.challenger, reason: 'challenge_lost', next: after }, TIMERS.choose);
    log(pub, `${challenger.name} เสียการ์ด 1 ใบจากการทายผิด`);
    return;
  }

  // อ้างสิทธิ์ไม่สำเร็จ — การ์ดที่เปิดถูกกำจัดทันที
  log(pub, `อ้างสิทธิ์ไม่สำเร็จ! ${me.name} เปิด ${CARD_NAME_TH[card]}`);
  hand.splice(index, 1);
  me.lost.push(card);
  syncCount(pub, priv, uid);
  eliminateIfEmpty(pub, priv, uid);

  if (pd.isBlock) {
    // ขัดขวางล้มเหลว → Action เดินต่อ
    log(pub, 'ขัดขวางล้มเหลว');
    clearPending(pub);
    if (!checkWin(pub)) applyAction(pub, priv, ctx);
  } else {
    log(pub, `${ACTION_NAME_TH[pd.action]} ล้มเหลว`);
    nextTurn(pub);
  }
}

// ── เสียการ์ด ───────────────────────────────────────────────────────────

function evLose(pub, priv, { uid, index }) {
  const pd = pub.pending;
  if (!pd || pd.kind !== 'lose') fail('ตอนนี้ไม่ต้องเสียการ์ด');
  if (pd.who !== uid) fail('ไม่ใช่การ์ดของคุณ');
  const hand = priv.hands[uid] || [];
  if (index < 0 || index >= hand.length) fail('เลือกการ์ดไม่ถูกต้อง');

  const me = findPlayer(pub, uid);
  const [card] = hand.splice(index, 1);
  me.lost.push(card);
  syncCount(pub, priv, uid);
  log(pub, `${me.name} เสียการ์ด ${CARD_NAME_TH[card]}`);
  eliminateIfEmpty(pub, priv, uid);

  const next = pd.next;
  clearPending(pub);
  if (checkWin(pub)) return;
  continueWith(pub, priv, next);
}

/** ตัวต่อเนื่อง: บอกว่าหลังจากเสียการ์ด/ทิ้งทองเสร็จแล้วให้ไปทำอะไรต่อ */
function continueWith(pub, priv, next) {
  if (!next) { nextTurn(pub); return; }
  switch (next.do) {
    case 'next_turn':
      nextTurn(pub);
      return;
    case 'after_challenge':
      afterChallengePassed(pub, priv, { action: next.action, actor: next.actor, target: next.target });
      return;
    case 'block_success': {
      const b = findPlayer(pub, next.blocker);
      log(pub, `ขัดขวางสำเร็จ — ${ACTION_NAME_TH[next.action]} ถูกยกเลิก (${b ? b.name : ''})`);
      nextTurn(pub);
      return;
    }
    case 'apply':
      applyAction(pub, priv, { action: next.action, actor: next.actor, target: next.target });
      return;
    default:
      nextTurn(pub);
  }
}

// ── ลงมือทำ Action จริง ─────────────────────────────────────────────────

function applyAction(pub, priv, ctx) {
  const { action, actor, target } = ctx;
  const me = findPlayer(pub, actor);
  const tgt = target ? findPlayer(pub, target) : null;

  // คนสั่งอาจตายไปแล้วระหว่างทาง (เช่น แพ้ Challenge) → Action เป็นโมฆะ
  if (!me || !me.alive) { nextTurn(pub); return; }

  clearPending(pub);

  switch (action) {
    case 'income':
      takeFromTreasury(pub, me, 1);
      break;
    case 'foreign_aid':
      takeFromTreasury(pub, me, 2);
      break;
    case 'tax':
      takeFromTreasury(pub, me, 3);
      break;
    case 'steal': {
      if (!tgt || !tgt.alive) break;
      const amount = Math.min(2, tgt.gold);
      tgt.gold -= amount;
      me.gold += amount;
      log(pub, `${me.name} ยืม ${amount} ทองจาก ${tgt.name}`);
      break;
    }
    case 'exchange': {
      const hand = priv.hands[actor];
      const keep = hand.length;
      hand.push(drawCard(pub, priv), drawCard(pub, priv));
      syncCount(pub, priv, actor);   // คนอื่นเห็นว่าถือ 4 ใบชั่วคราว (แต่ไม่เห็นหน้าการ์ด)
      setPending(pub, { kind: 'exchange', who: actor, keep }, TIMERS.choose);
      return;   // รอผู้เล่นเลือกก่อน ยังไม่จบเทิร์น
    }
    case 'assassinate':
    case 'coup': {
      if (!tgt || !tgt.alive) break;
      setPending(pub, {
        kind: 'lose', who: tgt.id,
        reason: action === 'coup' ? 'coup' : 'assassinate',
        next: { do: 'next_turn' },
      }, TIMERS.choose);
      return;
    }
  }

  if (enforceGoldCap(pub, me, { do: 'next_turn' })) return;
  nextTurn(pub);
}

// ── จั่วการ์ด (เด็กมีปัญหา) ─────────────────────────────────────────────

function evExchange(pub, priv, { uid, keep }) {
  const pd = pub.pending;
  if (!pd || pd.kind !== 'exchange') fail('ตอนนี้ไม่ได้อยู่ในขั้นตอนจั่วการ์ด');
  if (pd.who !== uid) fail('ไม่ใช่ตาของคุณ');
  const hand = priv.hands[uid] || [];
  const idx = Array.from(new Set(keep || []));
  if (idx.length !== pd.keep) fail(`ต้องเก็บการ์ด ${pd.keep} ใบ`);
  if (idx.some((i) => i < 0 || i >= hand.length)) fail('เลือกการ์ดไม่ถูกต้อง');

  const kept = idx.map((i) => hand[i]);
  const returned = hand.filter((_, i) => !idx.includes(i));
  priv.hands[uid] = kept;
  for (const c of returned) returnCard(pub, priv, c);
  syncCount(pub, priv, uid);

  const me = findPlayer(pub, uid);
  log(pub, `${me.name} เปลี่ยนการ์ดเรียบร้อย`);
  clearPending(pub);
  nextTurn(pub);
}

// ── ทิ้งทองส่วนเกิน ─────────────────────────────────────────────────────

function evDropGold(pub, priv, { uid, amount }) {
  const pd = pub.pending;
  if (!pd || pd.kind !== 'drop_gold') fail('ตอนนี้ไม่ต้องนำทองออก');
  if (pd.who !== uid) fail('ไม่ใช่ทองของคุณ');
  const n = Math.floor(Number(amount) || 0);
  if (n < pd.amount) fail(`ต้องนำทองออกอย่างน้อย ${pd.amount}`);
  const me = findPlayer(pub, uid);
  if (n > me.gold) fail('ทองไม่พอ');

  me.gold -= n;
  pub.treasury += n;
  log(pub, `${me.name} นำทองออก ${n}`);
  const next = pd.next;
  clearPending(pub);
  continueWith(pub, priv, next);
}

// ── เล่นอีกครั้ง ────────────────────────────────────────────────────────

function evPlayAgain(pub, priv, { uid }) {
  if (pub.phase !== 'ended') fail('เกมยังไม่จบ');
  if (pub.hostId !== uid) fail('เฉพาะ Host เท่านั้นที่เริ่มรอบใหม่ได้');
  pub.phase = 'lobby';
  pub.winnerId = null;
  pub.round = 1;
  pub.turnSeat = null;
  pub.treasury = 50;
  pub.deckCount = 0;
  clearPending(pub);
  priv.deck = [];
  for (const p of pub.players) {
    p.gold = 2; p.ready = false; p.alive = true; p.cardCount = 0; p.lost = [];
    priv.hands[p.id] = [];
  }
  log(pub, 'กลับสู่ห้องรอ — กดพร้อมเพื่อเริ่มรอบใหม่');
}

// ── หมดเวลา ─────────────────────────────────────────────────────────────

/**
 * เรียกได้จากใครก็ได้ แต่ตัดสินด้วยนาฬิกาเซิร์ฟเวอร์เท่านั้น
 * ถ้ายังไม่หมดเวลาจริงจะไม่ทำอะไร (ปลอดภัยต่อการยิงรัวๆ)
 */
function evTick(pub, priv) {
  if (!pub.deadline || Date.now() < pub.deadline) return;

  if (pub.phase === 'countdown') {
    startGame(pub, priv);
    return;
  }
  if (pub.phase !== 'playing') { pub.deadline = null; return; }

  const pd = pub.pending;
  if (!pd) { pub.deadline = null; return; }

  switch (pd.kind) {
    case 'challenge':
    case 'challenge_block':
      log(pub, 'หมดเวลา — ไม่มีใครสงสัย');
      resolveNoChallenge(pub, priv, pd);
      return;
    case 'block':
      log(pub, 'หมดเวลา — ไม่มีใครขัดขวาง');
      applyAction(pub, priv, { action: pd.action, actor: pd.actor, target: pd.target });
      return;
    case 'reveal':
      log(pub, 'หมดเวลา — เปิดการ์ดใบแรกอัตโนมัติ');
      evReveal(pub, priv, { uid: pd.who, index: 0 });
      return;
    case 'lose':
      log(pub, 'หมดเวลา — เสียการ์ดใบแรกอัตโนมัติ');
      evLose(pub, priv, { uid: pd.who, index: 0 });
      return;
    case 'exchange': {
      const hand = priv.hands[pd.who] || [];
      const keep = hand.slice(0, pd.keep).map((_, i) => i);
      log(pub, 'หมดเวลา — เก็บการ์ดเดิมอัตโนมัติ');
      evExchange(pub, priv, { uid: pd.who, keep });
      return;
    }
    case 'drop_gold':
      log(pub, 'หมดเวลา — นำทองออกอัตโนมัติ');
      evDropGold(pub, priv, { uid: pd.who, amount: pd.amount });
      return;
    default:
      nextTurn(pub);
  }
}

// ── มุมมองเฉพาะผู้เล่น ──────────────────────────────────────────────────

/** สิ่งที่ client แต่ละคนควรได้รับ — มือของตัวเองเท่านั้น */
export function handFor(priv, uid) {
  return (priv.hands[uid] || []).slice();
}
