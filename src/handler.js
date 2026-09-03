// ============================================================
// ส่วน HTTP ของ Edge Function
// หน้าที่: ยืนยันตัวตน → โหลด state → ให้ engine ตัดสิน → เซฟ
// client ไม่เคยได้แตะ state ตรงๆ
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body) =>
  new Response(JSON.stringify(body), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/** แปลง op ที่ client ส่งมา → event ที่ engine เข้าใจ ตัวไหนไม่อยู่ในนี้ = ปฏิเสธ */
const OPS = {
  join:       (uid, b) => ({ type: 'join',       uid, name: b.name }),
  set_ready:  (uid, b) => ({ type: 'set_ready',  uid, ready: !!b.ready }),
  leave:      (uid)    => ({ type: 'leave',      uid }),
  kick:       (uid, b) => ({ type: 'kick',       uid, targetId: b.targetId }),
  heartbeat:  (uid)    => ({ type: 'heartbeat',  uid }),
  action:     (uid, b) => ({ type: 'action',     uid, action: b.action, targetId: b.targetId }),
  respond:    (uid, b) => ({ type: 'respond',    uid, response: b.response, blockClaim: b.blockClaim }),
  reveal:     (uid, b) => ({ type: 'reveal',     uid, index: b.index }),
  lose:       (uid, b) => ({ type: 'lose',       uid, index: b.index }),
  exchange:   (uid, b) => ({ type: 'exchange',   uid, keep: b.keep }),
  drop_gold:  (uid, b) => ({ type: 'drop_gold',  uid, amount: b.amount }),
  play_again: (uid)    => ({ type: 'play_again', uid }),
  tick:       ()       => ({ type: 'tick' }),
};

async function getUid(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) fail('ยังไม่ได้เข้าสู่ระบบ');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) fail('เซสชันหมดอายุ ลองรีเฟรชหน้าเว็บ');
  return data.user.id;
}

async function loadRoom(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) fail('รหัสห้องไม่ถูกต้อง');
  const { data } = await admin.from('rooms')
    .select('id, version, state').eq('code', clean).maybeSingle();
  if (!data) fail('ไม่พบห้องนี้ ตรวจรหัสอีกครั้ง');
  const { data: p } = await admin.from('room_private')
    .select('data').eq('room_id', data.id).maybeSingle();
  return { id: data.id, version: data.version, pub: data.state, priv: p?.data || { deck: [], hands: {} } };
}

async function syncViews(roomId, priv) {
  const rows = Object.entries(priv.hands || {}).map(([player_id, hand]) => ({
    room_id: roomId, player_id, hand,
  }));
  if (rows.length) await admin.from('player_views').upsert(rows);
}

/**
 * อ่าน → ตัดสิน → เขียนกลับแบบล็อกเวอร์ชัน
 * ถ้ามีคนแก้ก่อนเราเสี้ยววินาที เราจะโหลดใหม่แล้วคิดใหม่ ไม่ทับของเขา
 */
async function mutate(code, applyEvent) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const room = await loadRoom(code);
    const handsBefore = JSON.stringify(room.priv.hands || {});

    applyEvent(room.pub, room.priv);   // โยน RuleError ถ้าผิดกติกา → ไม่มีอะไรถูกเขียน

    const { data: updated } = await admin.from('rooms')
      .update({ state: room.pub, version: room.version + 1, updated_at: new Date().toISOString() })
      .eq('id', room.id).eq('version', room.version)
      .select('id');

    if (!updated || !updated.length) continue;   // ชนกัน ลองใหม่

    await admin.from('room_private').upsert({ room_id: room.id, data: room.priv });
    if (JSON.stringify(room.priv.hands || {}) !== handsBefore) await syncViews(room.id, room.priv);
    return { roomId: room.id, code, state: room.pub };
  }
  fail('ระบบกำลังยุ่ง ลองกดอีกครั้ง');
}

async function createRoom(uid, name) {
  const clean = String(name || '').trim().slice(0, 12) || 'ผู้เล่น';
  admin.rpc('cleanup_old_rooms').then(() => {}).catch(() => {});   // เก็บกวาดเงียบๆ

  for (let i = 0; i < 8; i++) {
    const code = makeRoomCode();
    const { pub, priv } = newRoom(code, uid, clean);
    const { data, error } = await admin.from('rooms')
      .insert({ code, version: 1, state: pub }).select('id').single();
    if (error) continue;    // รหัสชนกัน สุ่มใหม่
    await admin.from('room_private').insert({ room_id: data.id, data: priv });
    await syncViews(data.id, priv);
    return { roomId: data.id, code, state: pub };
  }
  fail('สร้างห้องไม่สำเร็จ ลองใหม่อีกครั้ง');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json();
    const uid = await getUid(req);

    if (body.op === 'create_room') return json({ ok: true, ...(await createRoom(uid, body.name)) });

    const build = OPS[body.op];
    if (!build) fail('ไม่รู้จักคำสั่งนี้');
    const ev = build(uid, body);
    const out = await mutate(body.code, (pub, priv) => reduce(pub, priv, ev));
    return json({ ok: true, ...out });
  } catch (e) {
    // ส่ง 200 พร้อมข้อความไทย เพื่อให้หน้าเว็บอ่านสาเหตุได้ตรงๆ
    return json({ ok: false, error: e?.message || 'เกิดข้อผิดพลาด' });
  }
});
