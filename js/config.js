// ============================================================
// ตั้งค่า — ไฟล์เดียวที่คุณต้องแก้
// ============================================================

// เอามาจาก Supabase → Project Settings → Data API
// anon key เปิดเผยได้ ปลอดภัย เพราะกติกาทั้งหมดตัดสินที่ Edge Function
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

// ── รูปการ์ดของคุณ ──
// เอาไฟล์รูปไปวางใน assets/cards/ ใช้ชื่อตามนี้ แล้วจบ ไม่ต้องแก้โค้ดที่อื่น
// รองรับ .png .jpg .webp — เปลี่ยนนามสกุลตรงนี้ได้ถ้าไฟล์คุณไม่ใช่ png
// ถ้ายังไม่มีรูป เกมจะวาดการ์ดสำรองให้เอง เล่นได้ปกติ
export const CARD_ART = {
  duke:       'assets/cards/duke.jpg',
  captain:    'assets/cards/captain.jpg',
  ambassador: 'assets/cards/ambassador.jpg',
  contessa:   'assets/cards/contessa.jpg',
  assassin:   'assets/cards/assassin.jpg',
  back:       'assets/cards/card-back.jpg',
};

// ── ข้อมูลตัวละคร (ใช้แสดงผลอย่างเดียว กติกาจริงอยู่ที่เซิร์ฟเวอร์) ──
export const CHARACTERS = {
  duke:       { name: 'หัวหน้าห้อง',      skill: 'เก็บเงินห้อง +3',  glyph: '📋',
                desc: 'หยิบ 3 ทอง และขัดขวางคนที่ "เบิกเงิน" ได้' },
  captain:    { name: 'เด็กชอบขโมยของ',   skill: 'ยืมของ',          glyph: '🎒',
                desc: 'ขโมย 2 ทองจากคนอื่น และกันคนอื่นมาขโมยได้' },
  ambassador: { name: 'เด็กมีปัญหา',      skill: 'จั่วการ์ด',        glyph: '📚',
                desc: 'จั่ว 2 ใบมาเลือกเปลี่ยนมือ และกันคนมาขโมยได้' },
  contessa:   { name: 'ลูกรักครู',        skill: 'ช่วยตัวเอง',       glyph: '🍎',
                desc: 'ป้องกันการถูกไล่ออกแบบ 3 ทองได้' },
  assassin:   { name: 'เด็กหลังห้อง',     skill: 'ไล่ออกจากห้อง',    glyph: '✏️',
                desc: 'จ่าย 3 ทอง สั่งให้คนหนึ่งเสียการ์ด 1 ใบ' },
};

export const ACTION_LABELS = {
  income:      { label: 'หยิบทอง',   amount: '+1',  cls: 'gold'   },
  foreign_aid: { label: 'เบิกเงิน',  amount: '+2',  cls: 'gold'   },
  tax:         { label: 'เก็บเงินห้อง', amount: '+3', cls: 'gold' },
  steal:       { label: 'ยืมของ',    amount: '',    cls: ''       },
  exchange:    { label: 'จั่วการ์ด', amount: '',    cls: ''       },
  assassinate: { label: 'ไล่ออก',    amount: '−3',  cls: 'danger' },
  coup:        { label: 'ไล่ออกทันที', amount: '−7', cls: 'danger' },
};
