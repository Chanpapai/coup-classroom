// ============================================================
// การเชื่อมต่อ: ล็อกอินนิรนาม, เรียก Edge Function, ฟัง Realtime
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'coup-classroom-auth' },
  realtime: { params: { eventsPerSecond: 12 } },
});

let myId = null;
export const uid = () => myId;

/**
 * ล็อกอินแบบไม่ต้องสมัคร เซสชันเก็บใน localStorage
 * เพราะฉะนั้นรีเฟรชหรือเน็ตหลุดแล้วกลับมา ยังเป็นคนเดิม → กลับเข้าเกมได้
 */
export async function signIn() {
  const { data: s } = await sb.auth.getSession();
  if (s?.session) {
    myId = s.session.user.id;
    sb.realtime.setAuth(s.session.access_token);
    return myId;
  }
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw new Error('เข้าสู่ระบบไม่สำเร็จ: ' + error.message);
  myId = data.user.id;
  sb.realtime.setAuth(data.session.access_token);
  return myId;
}

/** ทุกคำสั่งของเกมวิ่งผ่านทางนี้ทางเดียว */
export async function call(op, payload = {}) {
  const { data: s } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/game`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${s?.session?.access_token || SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ op, ...payload }),
  });
  const out = await res.json().catch(() => ({ ok: false, error: 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง' }));
  if (!out.ok) throw new Error(out.error || 'เกิดข้อผิดพลาด');
  return out;
}

/** โหลดสถานะห้องล่าสุด + มือของเราเอง (ใช้ตอนเข้าเกมและตอนต่อเน็ตใหม่) */
export async function fetchRoom(code) {
  const { data: room } = await sb.from('rooms').select('id, state').eq('code', code).maybeSingle();
  if (!room) throw new Error('ไม่พบห้องนี้');
  const { data: view } = await sb.from('player_views')
    .select('hand').eq('room_id', room.id).eq('player_id', myId).maybeSingle();
  return { roomId: room.id, state: room.state, hand: view?.hand || [] };
}

/**
 * ฟังการเปลี่ยนแปลงแบบ Real-time
 * rooms        → สถานะสาธารณะ (ทุกคนเห็นเหมือนกัน)
 * player_views → มือของเราเท่านั้น (RLS กันไว้แล้วที่ฐานข้อมูล)
 */
export function subscribe(roomId, { onState, onHand, onStatus }) {
  const ch = sb.channel(`room:${roomId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
      (p) => onState(p.new.state))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'player_views', filter: `room_id=eq.${roomId}` },
      (p) => { if (p.new?.player_id === myId) onHand(p.new.hand); })
    .subscribe((status) => onStatus?.(status));

  return () => sb.removeChannel(ch);
}
