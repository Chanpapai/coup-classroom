// ============================================================
// ตัวช่วยวาดหน้าจอ — ไม่มีตรรกะเกมอยู่ในนี้เลย
// ============================================================

import { CARD_ART, CHARACTERS } from './config.js';

export const $  = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * สร้างการ์ด 1 ใบ
 * ถ้าไฟล์รูปที่ผู้ใช้วางไว้โหลดไม่ได้ จะสลับไปใช้ไอคอนสำรองอัตโนมัติ
 * รูปที่โหลดได้จะแสดงแบบ contain — คงสัดส่วนเดิม ไม่ครอป ไม่วาดทับ
 */
export function cardEl(cardId, { faceDown = false, lost = false, showSkill = true } = {}) {
  const node = el('div', 'card' + (faceDown ? ' card-back' : '') + (lost ? ' is-lost' : ''));
  const art = el('div', 'card-art');

  const src = faceDown ? CARD_ART.back : CARD_ART[cardId];
  const info = CHARACTERS[cardId];

  if (src) {
    const img = new Image();
    img.src = src;
    img.alt = faceDown ? 'การ์ดคว่ำ' : (info?.name || '');
    img.onerror = () => {
      img.remove();
      art.appendChild(el('span', 'fallback', faceDown ? '❓' : (info?.glyph || '❔')));
    };
    art.appendChild(img);
  } else {
    art.appendChild(el('span', 'fallback', faceDown ? '❓' : (info?.glyph || '❔')));
  }
  node.appendChild(art);

  if (!faceDown && info) {
    node.appendChild(el('div', 'card-name', info.name));
    if (showSkill) node.appendChild(el('div', 'card-skill', info.skill));
  } else if (faceDown) {
    node.appendChild(el('div', 'card-name', 'ปิดอยู่'));
  }
  return node;
}

/** ช่องผู้เล่น 1 คนบนกระดาน */
export function seatEl(p, { isTurn, isMe }) {
  const n = el('div', 'seat');
  if (isTurn) n.classList.add('is-turn');
  if (isMe) n.classList.add('is-me');
  if (!p.alive) n.classList.add('is-dead');
  n.dataset.pid = p.id;

  n.appendChild(el('div', 'seat-name', p.name + (isMe ? ' (คุณ)' : '')));

  const meta = el('div', 'seat-meta');
  meta.appendChild(el('span', 'seat-gold', '🪙 ' + p.gold));

  const cards = el('div', 'seat-cards');
  for (let i = 0; i < p.cardCount; i++) cards.appendChild(el('i'));
  for (let i = 0; i < p.lost.length; i++) cards.appendChild(el('i', 'lost'));
  meta.appendChild(cards);
  n.appendChild(meta);

  if (p.lost.length) {
    const names = p.lost.map((c) => CHARACTERS[c]?.name || c).join(' · ');
    n.appendChild(el('div', 'card-skill', names));
  }

  if (!p.alive) n.appendChild(el('span', 'seat-tag dead', 'ออกแล้ว'));
  else if (isTurn) n.appendChild(el('span', 'seat-tag', 'ตานี้'));

  return n;
}

/** ตัวเลขทองเด้งขึ้นเวลาได้ทอง */
export function popGold(seatNode, delta) {
  if (!seatNode || !delta) return;
  const p = el('span', 'gold-pop', (delta > 0 ? '+' : '') + delta);
  seatNode.appendChild(p);
  setTimeout(() => p.remove(), 900);
}

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ── เนื้อหาหน้าสอนเล่น ──
export const TUTORIAL = [
  { h: 'เป้าหมายของเกม', p: 'ทุกคนได้การ์ดลับคนละ 2 ใบ ใครเสียการ์ดครบทั้ง 2 ใบจะถูกไล่ออกจากห้อง คนที่อยู่รอดคนสุดท้ายชนะ',
    ul: ['โกหกได้เต็มที่ อ้างเป็นตัวละครที่ไม่ได้ถืออยู่ก็ได้', 'แต่ถ้าโดนจับได้ จะเสียการ์ดทันที'] },

  { h: 'การแจกการ์ด', p: 'การ์ดมี 5 ตัวละคร ตัวละครละ 3 ใบ รวม 15 ใบ',
    ul: ['เริ่มเกมแจกคนละ 2 ใบ ที่เหลือเป็นกองกลาง', 'คุณเห็นเฉพาะการ์ดของตัวเอง ของคนอื่นเห็นเป็นการ์ดคว่ำเสมอ'] },

  { h: 'การใช้ทอง', p: 'เริ่มเกมมีคนละ 2 ทอง ถือได้สูงสุด 10 ทอง',
    ul: ['ถ้าเกิน 10 ระบบจะบังคับให้นำทองออกก่อนจบเทิร์น', 'ทองใช้จ่ายค่าไล่ออก 3 หรือ 7 ทอง'] },

  { h: 'Action แต่ละอย่าง', ul: [
      'หยิบทอง +1 — ปลอดภัย ไม่มีใครขัดขวางได้',
      'เบิกเงิน +2 — หัวหน้าห้องขัดขวางได้',
      'เก็บเงินห้อง +3 — ต้องอ้างว่าเป็นหัวหน้าห้อง',
      'ยืมของ — ขโมย 2 ทองจากคนอื่น ต้องอ้างว่าเป็นเด็กชอบขโมยของ',
      'จั่วการ์ด — จั่ว 2 ใบมาเลือกเปลี่ยนมือ ต้องอ้างว่าเป็นเด็กมีปัญหา',
      'ไล่ออก −3 — เป้าหมายเสียการ์ด 1 ใบ ต้องอ้างว่าเป็นเด็กหลังห้อง',
      'ไล่ออกทันที −7 — เป้าหมายเสียการ์ดแน่นอน ห้ามขัดขวางทุกกรณี',
    ] },

  { h: 'Challenge คืออะไร', p: 'เมื่อมีคนอ้างสิทธิ์เป็นตัวละคร คนอื่นมีเวลา 10 วินาทีกด "ไม่เชื่อ"',
    ul: ['ถ้าเขาเปิดการ์ดตรงกับที่อ้าง คนที่ไม่เชื่อเสียการ์ด 1 ใบ ส่วนเขาได้สับการ์ดใบใหม่',
         'ถ้าเปิดไม่ตรง เขาเสียการ์ดใบนั้นทันที และ Action ล้มเหลว',
         'ถ้าไม่มีใครกดอะไรจนหมดเวลา ถือว่าเชื่อ Action เดินต่อ'] },

  { h: 'การขัดขวาง', p: 'บาง Action ขัดขวางได้ด้วยการอ้างว่าถือการ์ดที่กันได้',
    ul: ['เบิกเงิน +2 — หัวหน้าห้องขัดขวางได้ (ใครก็ได้)',
         'ยืมของ — เฉพาะเป้าหมาย ใช้เด็กชอบขโมยของ หรือเด็กมีปัญหา',
         'ไล่ออก −3 — เฉพาะเป้าหมาย ใช้ลูกรักครู',
         'คนขัดขวางก็ถูกจับผิดได้เหมือนกัน'] },

  { h: 'วิธีเสียการ์ด', p: 'ทุกครั้งที่ต้องเสียการ์ด คุณเลือกเองว่าจะเสียใบไหน',
    ul: ['การ์ดที่เสียจะถูกเปิดให้ทุกคนเห็น และใช้ไม่ได้อีก', 'เสียครบ 2 ใบ = ออกจากเกม ดูได้อย่างเดียว'] },

  { h: 'เด็กหลังห้อง', p: 'จ่าย 3 ทองสั่งให้ใครสักคนเสียการ์ด 1 ใบ',
    ul: ['เป้าหมายกด "ไม่เชื่อ" ได้ ถ้าเขาทายผิดและคุณมีการ์ดจริง เขาจะเสียรวม 2 ใบ',
         'ทองที่จ่ายไปแล้วไม่คืน ต่อให้ถูกขัดขวาง'] },

  { h: 'ลูกรักครู', p: 'ใช้ป้องกันการถูกไล่ออกแบบ 3 ทองได้',
    ul: ['ป้องกันการไล่ออกทันที −7 ทองไม่ได้เด็ดขาด', 'ถ้าอ้างว่ามีแล้วโดนจับได้ จะเสียการ์ดแทน'] },

  { h: 'เงื่อนไขชนะ', p: 'เหลือคนเดียวที่ยังมีการ์ดอยู่ คนนั้นคือผู้รอดชีวิตคนสุดท้ายของห้อง' },
];

export function renderTutorial(mount) {
  mount.innerHTML = '';

  const chars = el('div', 'tut-sec');
  chars.appendChild(el('h3', null, 'ตัวละครทั้ง 5'));
  for (const [id, c] of Object.entries(CHARACTERS)) {
    const row = el('div', 'tut-char');
    row.appendChild(el('div', 'glyph', c.glyph));
    const t = el('div');
    t.appendChild(el('b', null, c.name));
    t.appendChild(el('span', null, c.desc));
    row.appendChild(t);
    chars.appendChild(row);
  }
  mount.appendChild(chars);

  for (const s of TUTORIAL) {
    const sec = el('div', 'tut-sec');
    sec.appendChild(el('h3', null, s.h));
    if (s.p) sec.appendChild(el('p', null, s.p));
    if (s.ul) {
      const ul = el('ul');
      s.ul.forEach((li) => ul.appendChild(el('li', null, li)));
      sec.appendChild(ul);
    }
    mount.appendChild(sec);
  }
}
