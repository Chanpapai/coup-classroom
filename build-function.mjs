/**
 * รวม src/engine.js + src/handler.js เป็นไฟล์เดียว
 * เพื่อให้ก็อปวางใน Supabase Dashboard ได้ในทีเดียว
 *
 *   node build-function.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const engine = readFileSync('src/engine.js', 'utf8')
  .replace(/^export /gm, '');                      // Deno ไม่ต้อง export ในไฟล์เดียว

const handler = readFileSync('src/handler.js', 'utf8')
  .replace(/^import .*?;\n/gm, (m) => (m.includes('supabase-js') ? m : ''));

const banner = `// ============================================================
// COUP : ห้องเรียน — Supabase Edge Function  (ไฟล์นี้สร้างอัตโนมัติ)
// อย่าแก้ไฟล์นี้ตรงๆ ให้แก้ src/engine.js หรือ src/handler.js
// แล้วรัน:  node build-function.mjs
// ============================================================

`;

// ย้าย import ของ supabase-js ขึ้นบนสุด (Deno ต้องการ import อยู่ระดับ top-level)
const importLine = handler.match(/^import .*supabase-js.*;$/m)[0];
const body = handler.replace(importLine + '\n', '');

mkdirSync('supabase/functions/game', { recursive: true });
writeFileSync(
  'supabase/functions/game/index.ts',
  banner + importLine + '\n\n' + engine + '\n\n' + body,
);

console.log('สร้าง supabase/functions/game/index.ts เรียบร้อย');
