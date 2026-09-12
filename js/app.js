// ============================================================
// ตัวควบคุมหน้าจอทั้งหมด
// หลักการ: หน้าเว็บไม่เคยคิดกติกาเอง มันแค่ "วาดสิ่งที่เซิร์ฟเวอร์บอก"
// แล้วส่งความตั้งใจของผู้เล่นกลับไปให้เซิร์ฟเวอร์ตัดสิน
// ============================================================

import { CHARACTERS, ACTION_LABELS } from './config.js';
import { sb, uid, signIn, call, fetchRoom, subscribe } from './net.js';
import { $, el, cardEl, seatEl, popGold, toast, renderTutorial } from './ui.js';
import * as sfx from './sound.js';

const LS_ROOM = 'coup-classroom-room';

// ปุ่มที่ 2 "ใช้ความสามารถ" — รวม Action ที่ต้องอ้างสิทธิ์เป็นตัวละคร (บลัฟได้)
// บวกกับ "เบิกเงิน" ที่ไม่ต้องอ้างการ์ดใด ๆ (ทุกคนใช้ได้เสมอ)
const ABILITY_IDS = ['foreign_aid', 'tax', 'steal', 'exchange', 'assassinate'];
const ABILITY_META = {
  foreign_aid: { glyph: '💴', card: null,         cost: 0, needTarget: false },
  tax:         { glyph: '📋', card: 'duke',       cost: 0, needTarget: false },
  steal:       { glyph: '🎒', card: 'captain',    cost: 0, needTarget: true  },
  exchange:    { glyph: '📚', card: 'ambassador', cost: 0, needTarget: false },
  assassinate: { glyph: '✏️', card: 'assassin',   cost: 3, needTarget: true  },
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const app = {
  screen: 'home',
  code: null,
  roomId: null,
  state: null,     // สถานะสาธารณะจากเซิร์ฟเวอร์
  hand: [],        // การ์ดของเราเอง — คนอื่นไม่มีวันได้รับก้อนนี้
  unsub: null,
  prevGold: {},
  prevLostCount: {},
  prevPendingKey: '',
  busy: false,
};

const me = () => app.state?.players.find((p) => p.id === uid()) || null;
const amAlive = () => !!me()?.alive;
const isMyTurn = () => app.state?.players[app.state.turnSeat]?.id === uid();

// ── เปลี่ยนหน้าจอ ──
function go(name) {
  app.screen = name;
  document.querySelectorAll('.screen').forEach((s) => {
    s.classList.toggle('active', s.dataset.screen === name);
  });
}

function err(e) {
  toast(e?.message || 'เกิดข้อผิดพลาด');
}

/** กันกดรัว — คำสั่งเดียวต่อครั้ง */
async function send(op, payload) {
  if (app.busy) return null;
  app.busy = true;
  try { return await call(op, { code: app.code, ...payload }); }
  catch (e) { err(e); return null; }
  finally { app.busy = false; }
}

// ══════════════ เริ่มระบบ ══════════════

async function boot() {
  renderTutorial($('#tutorial-body'));
  wireStaticButtons();
  go('home');

  try { await signIn(); }
  catch (e) { toast(e.message); return; }

  // ต่อเน็ตกลับเข้าห้องเดิมอัตโนมัติ
  const saved = localStorage.getItem(LS_ROOM);
  if (saved) {
    try {
      await enterRoom(saved, { silent: true });
      if (me()) await send('heartbeat');
      else if (app.state.phase === 'lobby') await send('join', { name: 'ผู้เล่น' });
      else throw new Error('ไม่ได้อยู่ในห้องนี้แล้ว');
    } catch {
      localStorage.removeItem(LS_ROOM);
      app.unsub?.(); app.unsub = null;
      app.code = app.roomId = app.state = null;
      go('home');
    }
  }
}

function wireStaticButtons() {
  // ---- กันเหนียว: บังคับซ่อนองค์ประกอบ overlay ทุกตัวด้วย inline style โดยตรง ----
  // ไม่พึ่งพา CSS cascade อย่างเดียวอีกต่อไป — ไม่ว่าไฟล์ CSS จะมีปัญหาอะไรซ่อนอยู่
  // (ลำดับไฟล์ผิด, cache เก่าค้าง, กฎอื่นชนกัน ฯลฯ) โค้ดนี้จะบังคับผลลัพธ์ให้ถูกต้องเสมอ
  // เพราะ inline style ที่ตั้งค่าตรง ๆ (ไม่ว่างเปล่า) จะชนะทุกกฎใน .css ที่ไม่ได้ใส่ !important
  function enforceHidden(el) {
    if (!el) return;
    el.style.display = el.hidden ? 'none' : '';
  }
  const OVERLAY_IDS = ['#modal', '#log-sheet', '#countdown', '#notice', '#spectator-bar', '#toast', '#conn', '#menu-error'];
  for (const sel of OVERLAY_IDS) {
    const el = document.querySelector(sel);
    if (!el) continue;
    enforceHidden(el); // เช็คทันทีตอนโหลดหน้า
    new MutationObserver(() => enforceHidden(el)).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  }

  document.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => { sfx.play('tap'); go(b.dataset.go); });
  });

  $('#btn-create').addEventListener('click', onCreate);
  $('#btn-join').addEventListener('click', onJoin);
  $('#code-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $('#btn-ready').addEventListener('click', onReady);
  $('#btn-leave').addEventListener('click', onLeave);
  $('#btn-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(app.code); toast('คัดลอกรหัสแล้ว'); }
    catch { toast('รหัสห้อง: ' + app.code); }
  });

  $('#btn-sound').addEventListener('click', (e) => {
    e.currentTarget.textContent = sfx.toggle() ? '🔊' : '🔇';
  });
  $('#btn-sound').textContent = sfx.isOn() ? '🔊' : '🔇';

  $('#btn-log').addEventListener('click', () => { renderLog(); $('#log-sheet').hidden = false; });
  $('#btn-log-close').addEventListener('click', () => { $('#log-sheet').hidden = true; });
  $('#log-sheet').addEventListener('click', (e) => {
    if (e.target.id === 'log-sheet') $('#log-sheet').hidden = true;
  });

  $('#btn-again').addEventListener('click', () => send('play_again'));
  $('#btn-end-home').addEventListener('click', onLeave);

  // กลับมาจากพักหน้าจอ / สลับแอป → ดึงสถานะล่าสุดทันที
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && app.code) refresh();
  });
  window.addEventListener('online', () => { $('#conn').hidden = true; refresh(); });
  window.addEventListener('offline', () => { $('#conn').hidden = false; });
}

// ══════════════ สร้าง / เข้าห้อง ══════════════

function nameValue() {
  const v = $('#name-input').value.trim();
  return v || 'ผู้เล่น';
}

async function onCreate() {
  sfx.play('tap');
  $('#menu-error').hidden = true;
  try {
    const out = await call('create_room', { name: nameValue() });
    await enterRoom(out.code);
  } catch (e) {
    $('#menu-error').textContent = e.message;
    $('#menu-error').hidden = false;
  }
}

async function onJoin() {
  sfx.play('tap');
  const code = $('#code-input').value.trim().toUpperCase();
  $('#menu-error').hidden = true;
  if (code.length !== 6) {
    $('#menu-error').textContent = 'รหัสห้องต้องมี 6 ตัว';
    $('#menu-error').hidden = false;
    return;
  }
  try {
    await call('join', { code, name: nameValue() });
    await enterRoom(code);
  } catch (e) {
    $('#menu-error').textContent = e.message;
    $('#menu-error').hidden = false;
  }
}

async function enterRoom(code, { silent = false } = {}) {
  const data = await fetchRoom(code);
  app.code = code;
  app.roomId = data.roomId;
  app.state = data.state;
  app.hand = data.hand;
  localStorage.setItem(LS_ROOM, code);

  app.unsub?.();
  app.unsub = subscribe(data.roomId, {
    onState: (s) => { app.state = s; render(); },
    onHand: (h) => { app.hand = h; render(); },
    onStatus: (st) => {
      const okNow = st === 'SUBSCRIBED';
      $('#conn').hidden = okNow;
      if (okNow) refresh();          // กู้สถานะที่อาจพลาดไปตอนหลุด
    },
  });

  startClock();
  render();
  if (!silent) sfx.play('tap');
}

async function onLeave() {
  if (app.code) await call('leave', { code: app.code }).catch(() => {});
  localStorage.removeItem(LS_ROOM);
  app.unsub?.();
  app.unsub = null;
  app.code = app.roomId = app.state = null;
  app.hand = [];
  stopClock();
  closeModal();
  document.body.classList.remove('is-spectator');
  go('home');
}

async function refresh() {
  if (!app.code) return;
  try {
    const d = await fetchRoom(app.code);
    app.state = d.state;
    app.hand = d.hand;
    render();
  } catch { /* เดี๋ยว realtime ตามมาเอง */ }
}

async function onReady() {
  sfx.play('tap');
  await send('set_ready', { ready: !me()?.ready });
}

// ══════════════ นาฬิกาเดินเอง ══════════════

let clock = null;
function startClock() {
  stopClock();
  clock = setInterval(onClockTick, 250);
}
function stopClock() { clearInterval(clock); clock = null; }

let lastTickSent = 0;
function onClockTick() {
  const s = app.state;
  if (!s) return;
  paintTimers();

  if (!s.deadline) return;
  const over = Date.now() - s.deadline;
  if (over < 0) return;

  // ทุกเครื่องช่วยกันเตือนเซิร์ฟเวอร์ว่าหมดเวลาแล้ว แต่เหลื่อมกันตามที่นั่ง
  // เพื่อไม่ให้ยิงพร้อมกัน 6 คน (เซิร์ฟเวอร์กันซ้ำด้วย version อยู่แล้ว)
  const seat = me()?.seat ?? 0;
  if (over < 400 + seat * 350) return;
  if (Date.now() - lastTickSent < 1500) return;
  lastTickSent = Date.now();
  call('tick', { code: app.code }).catch(() => {});
}

let lastBeep = null;
function secondsLeft() {
  if (!app.state?.deadline) return null;
  return Math.max(0, Math.ceil((app.state.deadline - Date.now()) / 1000));
}

function paintTimers() {
  const left = secondsLeft();
  const s = app.state;

  const t = $('#game-timer');
  if (left != null && s?.phase === 'playing') {
    t.hidden = false;
    t.querySelector('b').textContent = left;
    if (left <= 3 && left > 0 && left !== lastBeep) { lastBeep = left; sfx.play('tick'); }
  } else t.hidden = true;

  if (s?.phase === 'countdown') {
    $('#countdown').hidden = false;
    $('#countdown-num').textContent = left ?? 0;
  } else {
    $('#countdown').hidden = true;
  }

  const bar = $('#modal-timer');
  if (!bar.hidden) {
    const pct = left == null ? 0 : Math.min(100, (left / 10) * 100);
    bar.querySelector('span').style.width = pct + '%';
  }
}

// ══════════════ วาดหน้าจอ ══════════════

function render() {
  const s = app.state;
  if (!s) return;

  if (s.phase !== 'ended') app.prevPendingKey = '';
  if (s.phase !== 'playing' && modalOpen) closeModal();
  if (s.phase === 'lobby' || s.phase === 'countdown') {
    document.body.classList.remove('is-spectator');
    renderLobby(); go('lobby');
  }
  else if (s.phase === 'playing') { renderGame(); go('game'); }
  else if (s.phase === 'ended') { renderEnd(); go('end'); }

  paintTimers();
}

// ── ห้องรอ ──
function renderLobby() {
  const s = app.state;
  $('#lobby-code').textContent = s.code;

  const list = $('#lobby-list');
  list.innerHTML = '';
  for (const p of s.players) {
    const row = el('li', 'player-row' + (p.ready ? ' is-ready' : ''));
    row.appendChild(el('span', 'avatar', p.ready ? '🟢' : '⚪'));

    const who = el('div', 'who');
    who.appendChild(el('b', null, p.name + (p.id === uid() ? ' (คุณ)' : '')));
    if (p.id === s.hostId) who.appendChild(el('small', null, 'เจ้าของห้อง'));
    row.appendChild(who);

    row.appendChild(el('span', 'state', p.ready ? 'พร้อม' : 'ยังไม่พร้อม'));

    if (s.hostId === uid() && p.id !== uid()) {
      const k = el('button', 'icon-btn kick', '✕');
      k.title = 'เชิญออก';
      k.addEventListener('click', () => send('kick', { targetId: p.id }));
      row.appendChild(k);
    }
    list.appendChild(row);
  }

  const ready = s.players.filter((p) => p.ready).length;
  const total = s.players.length;
  $('#lobby-note').textContent = total < 2
    ? 'รออีกอย่างน้อย 1 คน แชร์รหัสห้องให้เพื่อน'
    : `พร้อมแล้ว ${ready}/${total} คน — ต้องครบทุกคนเกมถึงจะเริ่ม`;

  const btn = $('#btn-ready');
  btn.textContent = me()?.ready ? 'พร้อมแล้ว · กดเพื่อยกเลิก' : 'พร้อม';
  btn.className = 'btn btn-xl ' + (me()?.ready ? 'btn-ok' : 'btn-primary');
}

// ── หน้าเกม ──
function renderGame() {
  const s = app.state;
  const my = me();

  $('#game-code').textContent = s.code;
  $('#game-round').textContent = s.round;

  renderTurnStrip();

  // กระดานวงกลม — ตัวเราเองอยู่ตำแหน่งล่างสุดเสมอ ที่เหลือเรียงตามเดิมรอบวง
  const board = $('#board');
  const myIdx = s.players.findIndex((p) => p.id === uid());
  const ordered = myIdx >= 0
    ? [...s.players.slice(myIdx), ...s.players.slice(0, myIdx)]
    : s.players.slice();

  board.dataset.count = String(s.players.length);
  board.innerHTML = '';

  const center = el('div', 'board-center');
  const cur = s.players[s.turnSeat];
  center.appendChild(el('div', 'bc-turn', cur ? `ตาของ ${cur.name}` : ''));
  center.appendChild(el('div', 'bc-sub', `🂠 ${s.deckCount} · 🪙 ${s.treasury}`));
  board.appendChild(center);

  ordered.forEach((p, i) => {
    const node = seatEl(p, { isTurn: p.seat === s.turnSeat, isMe: p.id === uid() });
    node.dataset.pos = String(i);
    board.appendChild(node);

    const beforeGold = app.prevGold[p.id];
    if (beforeGold != null && beforeGold !== p.gold) {
      popGold(node, p.gold - beforeGold);
      if (p.gold > beforeGold) sfx.play('gold');
    }
    app.prevGold[p.id] = p.gold;

    const beforeLost = app.prevLostCount[p.id];
    if (beforeLost != null && p.lost.length > beforeLost) {
      node.classList.add('seat-flash-lost');
      setTimeout(() => node.classList.remove('seat-flash-lost'), 700);
    }
    app.prevLostCount[p.id] = p.lost.length;
  });

  $('#pile-deck').textContent = s.deckCount;
  $('#pile-discard').textContent = s.players.reduce((a, p) => a + p.lost.length, 0);
  $('#pile-treasury').textContent = s.treasury;

  // การ์ดของเรา
  const mine = $('#my-cards');
  mine.innerHTML = '';
  for (const c of app.hand) mine.appendChild(cardEl(c, { showSkill: true }));
  for (const c of (my?.lost || [])) mine.appendChild(cardEl(c, { lost: true, showSkill: false }));
  $('#my-gold').querySelector('b').textContent = my?.gold ?? 0;

  renderNotice();
  renderActions();
  renderModal();
}

/** แถบบนสุดของหน้าเกม: ชื่อตาปัจจุบัน + ลำดับวงกลม ◉ ปัจจุบัน → ○ ถัดไป → ... */
function renderTurnStrip() {
  const s = app.state;
  const cur = s.players[s.turnSeat];
  const strip = $('#turn-strip');
  strip.classList.toggle('is-me', isMyTurn() && amAlive());
  strip.innerHTML = '';

  const main = el('div', 'turn-main');
  main.appendChild(el('span', 'turn-dot-live'));
  main.appendChild(el('b', null, !amAlive()
    ? `กำลังดูเกม — ตาของ ${cur?.name || '-'}`
    : (isMyTurn() ? 'ตาของคุณ — เลือก Action' : `ตาของ: ${cur?.name || '-'}`)));
  strip.appendChild(main);

  const alive = s.players.filter((p) => p.alive);
  if (alive.length) {
    const startIdx = Math.max(0, alive.findIndex((p) => p.seat === s.turnSeat));
    const seq = el('div', 'turn-seq');
    alive.forEach((_, i) => {
      const p = alive[(startIdx + i) % alive.length];
      const chip = el('span', 'seq-chip' + (i === 0 ? ' seq-now' : ''));
      chip.appendChild(el('i', null, i === 0 ? '◉' : '○'));
      chip.appendChild(el('b', null, p.name));
      seq.appendChild(chip);
      if (i < alive.length - 1) seq.appendChild(el('span', 'seq-arrow', '→'));
    });
    strip.appendChild(seq);
  }
}

function renderNotice() {
  const s = app.state;
  const n = $('#notice');
  const pd = s.pending;
  if (!pd) { n.hidden = true; return; }

  const nm = (id) => s.players.find((p) => p.id === id)?.name || '?';
  let text = '';
  let alert = false;

  switch (pd.kind) {
    case 'challenge':
      text = `${nm(pd.actor)} อ้างว่าเป็น ${CHARACTERS[pd.claim].name} — รอคนอื่นตัดสินใจ`;
      break;
    case 'block':
      text = `รอ ${pd.responders.filter((i) => !pd.passed.includes(i)).map(nm).join(', ')} ว่าจะขัดขวางไหม`;
      break;
    case 'challenge_block':
      text = `${nm(pd.blocker)} ขัดขวางโดยอ้างว่าเป็น ${CHARACTERS[pd.blockClaim].name}`;
      break;
    case 'reveal':
      text = `${nm(pd.who)} กำลังเปิดการ์ด`; alert = true;
      break;
    case 'lose':
      text = `${nm(pd.who)} กำลังเลือกการ์ดที่จะเสีย`; alert = true;
      break;
    case 'exchange':
      text = `${nm(pd.who)} กำลังเลือกการ์ด`;
      break;
    case 'drop_gold':
      text = `${nm(pd.who)} มีทองเกิน ${10} ต้องนำออก ${pd.amount}`;
      break;
  }
  n.textContent = text;
  n.classList.toggle('alert', alert);
  n.hidden = !text;
}

/**
 * ข้อ 3: ถ้าตายแล้ว ซ่อนแถบ Action ทั้งแถบ แล้วขึ้นแถบผู้ชมแทน
 * ไม่มีปุ่มอะไรให้กดเลย และ .is-spectator ยังกันกล่องโต้ตอบไม่ให้เด้งด้วย
 *
 * ข้อ 4: เหลือปุ่มหลักแค่ 3 ปุ่ม
 *  1) เก็บเงิน      → income ทันที +1
 *  2) ใช้ความสามารถ → เปิดเมนูเลือก (เบิกเงิน/เก็บเงินห้อง/ยืมของ/จั่วการ์ด/ไล่ออก)
 *  3) โจมตี         → ไล่ออกทันที (coup) เป้าหมายเสียการ์ดแน่นอน
 */
function renderActions() {
  const spectating = !amAlive();
  document.body.classList.toggle('is-spectator', spectating);
  $('#action-bar').hidden = spectating;
  $('#spectator-bar').hidden = !spectating;
  if (spectating) { $('#action-bar').innerHTML = ''; return; }

  const s = app.state;
  const my = me();
  const canAct = isMyTurn() && !s.pending;

  const bar = $('#action-bar');
  bar.innerHTML = '';

  // 1) เก็บเงิน
  {
    const meta = ACTION_LABELS.income;
    const b = el('button', 'act gold');
    b.appendChild(el('span', 'act-glyph', '💰'));
    b.appendChild(el('span', null, meta.label));
    b.appendChild(el('em', null, meta.amount));
    b.disabled = !canAct;
    b.addEventListener('click', () => onAction('income'));
    bar.appendChild(b);
  }

  // 2) ใช้ความสามารถ
  {
    const anyUsable = ABILITY_IDS.some((id) => canUseAbility(id, s, my));
    const b = el('button', 'act ability');
    b.appendChild(el('span', 'act-glyph', '🃏'));
    b.appendChild(el('span', null, 'ใช้ความสามารถ'));
    b.appendChild(el('em', null, canAct ? (anyUsable ? 'เลือก' : 'ไม่มี') : '·'));
    b.disabled = !canAct || !anyUsable;
    b.addEventListener('click', openAbilityMenu);
    bar.appendChild(b);
  }

  // 3) โจมตี (ไล่ออกทันที — coup)
  {
    const meta = ACTION_LABELS.coup;
    const b = el('button', 'act danger');
    b.appendChild(el('span', 'act-glyph', '⚔️'));
    b.appendChild(el('span', null, 'โจมตี'));
    const canCoup = canAct && my.gold >= 7 && s.players.some((p) => p.alive && p.id !== uid());
    b.appendChild(el('em', null, canAct && my.gold < 7 ? 'ต้องมี 7 ทอง' : meta.amount));
    b.disabled = !canCoup;
    b.addEventListener('click', () => onAction('coup'));
    bar.appendChild(b);
  }
}

/** เช็คคร่าว ๆ ว่าความสามารถนี้ "กดได้ตอนนี้ไหม" (เงินพอ / มีเป้าหมายให้เลือก) */
function canUseAbility(id, s, my) {
  const meta = ABILITY_META[id];
  if (!my || my.gold < meta.cost) return false;
  if (id === 'steal') return s.players.some((p) => p.alive && p.id !== uid() && p.gold > 0);
  if (meta.needTarget) return s.players.some((p) => p.alive && p.id !== uid());
  return true;
}

/** เมนูของปุ่ม "ใช้ความสามารถ" — แสดงทุกความสามารถ อ้างเป็นตัวละครอื่นได้ (บลัฟ) */
function openAbilityMenu() {
  const s = app.state;
  const my = me();

  openModal({
    title: '🃏 ใช้ความสามารถ',
    text: 'อ้างเป็นตัวละครไหนก็ได้ — ถ้าโดนจับได้ว่าโกหกจะเสียการ์ด 1 ใบ',
    build: (body, close) => {
      const list = el('div', 'ability-list');
      for (const id of ABILITY_IDS) {
        const meta = ABILITY_META[id];
        const labelMeta = ACTION_LABELS[id];
        const usable = canUseAbility(id, s, my);

        const row = document.createElement('button');
        row.className = 'ability-row';
        row.disabled = !usable;

        row.appendChild(el('span', 'ability-glyph', meta.glyph));

        const info = el('div', 'ability-info');
        info.appendChild(el('b', null, labelMeta.label));
        const charName = meta.card ? CHARACTERS[meta.card].name : 'ไม่ต้องอ้างการ์ด';
        info.appendChild(el('span', null, charName));
        row.appendChild(info);

        if (meta.card && app.hand.includes(meta.card)) {
          row.appendChild(el('span', 'ability-badge', 'มีการ์ดนี้'));
        }
        row.appendChild(el('span', 'ability-cost', labelMeta.amount || (meta.cost ? `−${meta.cost}` : '')));

        row.addEventListener('click', () => { close(); onAction(id); });
        list.appendChild(row);
      }
      body.appendChild(list);

      const cancel = el('button', 'btn btn-ghost', 'ยกเลิก');
      cancel.addEventListener('click', close);
      body.appendChild(cancel);
    },
  });
}

function renderLog() {
  const list = $('#log-list');
  list.innerHTML = '';
  const items = (app.state?.log || []).slice().reverse();
  if (!items.length) list.appendChild(el('li', null, 'ยังไม่มีเหตุการณ์'));
  for (const l of items) list.appendChild(el('li', null, l.t));
}

// ── จบเกม ──
function renderEnd() {
  const s = app.state;
  const w = s.players.find((p) => p.id === s.winnerId);
  $('#end-title').innerHTML = w
    ? `พี่ใหญ่คือ<span class="end-winner-name">${escapeHtml(w.name)}</span>`
    : 'จบเกมแล้ว';
  $('#end-text').textContent = w ? 'ชนะเกม! 🏆' : '';
  $('#btn-again').hidden = s.hostId !== uid();
  $('#end-hint').textContent = s.hostId === uid() ? '' : 'รอเจ้าของห้องกดเล่นอีกครั้ง';
  if (app.prevPendingKey !== 'ended') { sfx.play('win'); app.prevPendingKey = 'ended'; }
  document.body.classList.remove('is-spectator');
}

// ══════════════ ส่ง Action ══════════════

async function onAction(action) {
  sfx.play('tap');
  const needTarget = action === 'steal' || action === 'assassinate' || action === 'coup';
  if (!needTarget) { await send('action', { action }); return; }

  const s = app.state;
  let targets = s.players.filter((p) => p.alive && p.id !== uid());
  if (action === 'steal') targets = targets.filter((p) => p.gold > 0);
  if (!targets.length) { toast('ไม่มีเป้าหมายที่เลือกได้'); return; }

  openModal({
    title: ACTION_LABELS[action].label,
    text: 'เลือกผู้เล่นเป้าหมาย',
    build: (body, close) => {
      const list = el('div', 'target-list');
      for (const p of targets) {
        const b = el('button', 'target-btn');
        b.appendChild(el('span', null, p.name));
        b.appendChild(el('small', null, `🪙 ${p.gold} · การ์ด ${p.cardCount}`));
        b.addEventListener('click', async () => { close(); await send('action', { action, targetId: p.id }); });
        list.appendChild(b);
      }
      body.appendChild(list);
      const cancel = el('button', 'btn btn-ghost', 'ยกเลิก');
      cancel.addEventListener('click', close);
      body.appendChild(cancel);
    },
  });
}

// ══════════════ กล่องโต้ตอบ ══════════════

let modalOpen = false;

function openModal({ title, text, timer = false, build, key }) {
  const veil = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-text').textContent = text || '';
  $('#modal-text').hidden = !text;
  $('#modal-timer').hidden = !timer;
  const body = $('#modal-body');
  body.innerHTML = '';
  build(body, closeModal);
  veil.hidden = false;
  veil.dataset.key = key || '';
  modalOpen = true;
}

function closeModal() {
  $('#modal').hidden = true;
  $('#modal').dataset.key = '';
  modalOpen = false;
}

/** ตัดสินว่าตอนนี้ "ฉัน" ต้องตอบอะไรไหม แล้วเปิดกล่องให้ตรงเรื่อง */
function renderModal() {
  const s = app.state;
  const pd = s.pending;

  // ข้อ 3 ย้ำอีกชั้น: คนตายไม่มีทางเจอกล่องให้กดอะไรทั้งสิ้น
  if (!pd || !amAlive()) { if (modalOpen) closeModal(); return; }

  const nm = (id) => s.players.find((p) => p.id === id)?.name || '?';
  const key = JSON.stringify([pd.kind, pd.who, pd.actor, pd.blocker, pd.claim, pd.blockClaim]);
  if ($('#modal').dataset.key === key) return;   // กล่องเดิม ไม่ต้องวาดใหม่

  const myId = uid();

  // 1) มีคนอ้างสิทธิ์ → เชื่อ หรือ ไม่เชื่อ
  if ((pd.kind === 'challenge' || pd.kind === 'challenge_block')) {
    const suspect = pd.kind === 'challenge_block' ? pd.blocker : pd.actor;
    const claim = pd.kind === 'challenge_block' ? pd.blockClaim : pd.claim;
    const eligible = suspect !== myId && !(pd.passed || []).includes(myId);
    if (!eligible) { if (modalOpen) closeModal(); return; }

    sfx.play('alert');
    openModal({
      key, timer: true,
      title: `${nm(suspect)} อ้างว่าเป็น ${CHARACTERS[claim].name}`,
      text: pd.kind === 'challenge_block' ? 'เขาขัดขวาง Action นี้อยู่' : 'คุณจะเชื่อไหม',
      build: (body, close) => {
        const g = el('div', 'choice-grid');
        g.appendChild(btn('เชื่อ', 'btn btn-outline', async () => { close(); await send('respond', { response: 'pass' }); }));
        g.appendChild(btn('ไม่เชื่อ', 'btn btn-danger', async () => { close(); await send('respond', { response: 'challenge' }); }));
        body.appendChild(g);
      },
    });
    return;
  }

  // 2) มีสิทธิ์ขัดขวาง
  if (pd.kind === 'block') {
    const eligible = pd.responders.includes(myId) && !pd.passed.includes(myId);
    if (!eligible) { if (modalOpen) closeModal(); return; }

    const blockers = { foreign_aid: ['duke'], steal: ['captain', 'ambassador'], assassinate: ['contessa'] }[pd.action] || [];
    const isMeTarget = pd.target === myId;

    sfx.play('alert');
    openModal({
      key, timer: true,
      title: pd.action === 'assassinate'
        ? `คุณถูก ${nm(pd.actor)} ไล่ออกจากห้อง!`
        : `${nm(pd.actor)} ใช้ "${ACTION_LABELS[pd.action].label}"${isMeTarget ? ' ใส่คุณ' : ''}`,
      text: 'จะขัดขวางด้วยการ์ดใบไหนไหม (อ้างได้แม้ไม่มีจริง แต่ถูกจับได้จะเสียการ์ด)',
      build: (body, close) => {
        for (const c of blockers) {
          body.appendChild(btn(`ขัดขวางด้วย ${CHARACTERS[c].name}`, 'btn btn-outline btn-xl',
            async () => { close(); await send('respond', { response: 'block', blockClaim: c }); }));
        }
        body.appendChild(btn(pd.action === 'assassinate' ? 'ยอมรับ' : 'ปล่อยผ่าน', 'btn btn-ghost btn-xl',
          async () => { close(); await send('respond', { response: 'pass' }); }));
      },
    });
    return;
  }

  // 3) ถูก Challenge → เลือกการ์ดที่จะเปิด
  if (pd.kind === 'reveal' && pd.who === myId) {
    openModal({
      key, timer: true,
      title: 'คุณถูก Challenge!',
      text: `เลือกการ์ด 1 ใบเพื่อเปิด — ถ้าตรงกับ ${CHARACTERS[pd.claim].name} คุณชนะ`,
      build: (body) => body.appendChild(cardPicker(app.hand, 1,
        async (idx) => { closeModal(); sfx.play('flip'); await send('reveal', { index: idx[0] }); })),
    });
    return;
  }

  // 4) ต้องเสียการ์ด
  if (pd.kind === 'lose' && pd.who === myId) {
    sfx.play('gone');
    openModal({
      key, timer: true,
      title: 'เลือกการ์ดที่จะเสีย',
      text: 'การ์ดใบนี้จะถูกเปิดให้ทุกคนเห็น และใช้ไม่ได้อีก',
      build: (body) => body.appendChild(cardPicker(app.hand, 1,
        async (idx) => { closeModal(); await send('lose', { index: idx[0] }); })),
    });
    return;
  }

  // 5) จั่วการ์ด → เลือกใบที่จะเก็บ
  if (pd.kind === 'exchange' && pd.who === myId) {
    openModal({
      key,
      title: 'เลือกการ์ดที่จะเก็บ',
      text: `เก็บได้ ${pd.keep} ใบ ที่เหลือกลับเข้ากองกลาง`,
      build: (body) => body.appendChild(cardPicker(app.hand, pd.keep,
        async (idx) => { closeModal(); await send('exchange', { keep: idx }); })),
    });
    return;
  }

  // 6) ทองเกิน 10
  if (pd.kind === 'drop_gold' && pd.who === myId) {
    let amount = pd.amount;
    openModal({
      key,
      title: 'คุณมีทองเกิน 10 ทอง',
      text: `กรุณานำทองออกอย่างน้อย ${pd.amount} ทอง`,
      build: (body) => {
        const pick = el('div', 'gold-picker');
        const minus = el('button', null, '−');
        const num = el('b', null, String(amount));
        const plus = el('button', null, '+');
        minus.addEventListener('click', () => { amount = Math.max(pd.amount, amount - 1); num.textContent = amount; });
        plus.addEventListener('click', () => { amount = Math.min(me().gold, amount + 1); num.textContent = amount; });
        pick.append(minus, num, plus);
        body.appendChild(pick);
        body.appendChild(btn('นำทองออก', 'btn btn-primary btn-xl',
          async () => { closeModal(); await send('drop_gold', { amount }); }));
      },
    });
    return;
  }

  if (modalOpen) closeModal();
}

function btn(label, cls, fn) {
  const b = el('button', cls, label);
  b.addEventListener('click', fn);
  return b;
}

/** ตารางการ์ดให้เลือก — เลือกครบจำนวนแล้วปุ่มยืนยันจะกดได้ */
function cardPicker(cards, count, onConfirm) {
  const wrap = el('div', 'stack');
  const grid = el('div', 'choice-grid' + (cards.length > 2 ? ' three' : ''));
  const chosen = new Set();

  const confirm = el('button', 'btn btn-primary btn-xl', count === 1 ? 'ยืนยัน' : `เก็บ ${count} ใบ`);
  confirm.disabled = true;

  cards.forEach((c, i) => {
    const node = cardEl(c, { showSkill: false });
    node.classList.add('selectable', 'card-flip');
    node.addEventListener('click', () => {
      sfx.play('tap');
      if (chosen.has(i)) chosen.delete(i);
      else {
        if (chosen.size >= count) { const first = chosen.values().next().value; chosen.delete(first); }
        chosen.add(i);
      }
      Array.from(grid.children).forEach((ch, j) => ch.classList.toggle('selected', chosen.has(j)));
      confirm.disabled = chosen.size !== count;
    });
    grid.appendChild(node);
  });

  confirm.addEventListener('click', () => onConfirm(Array.from(chosen)));
  wrap.append(grid, confirm);
  return wrap;
}

boot();
