-- ============================================================
-- COUP : ห้องเรียน — โครงสร้างฐานข้อมูล
-- วางทั้งไฟล์นี้ใน Supabase → SQL Editor → Run
-- รันซ้ำได้ ไม่พัง
-- ============================================================

-- ---------- ตาราง ----------

-- สถานะสาธารณะของห้อง ทุกคนอ่านได้ (ไม่มีการ์ดลับอยู่ในนี้)
create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  version    int  not null default 1,     -- กันสองคนกดพร้อมกันแล้วทับกัน
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ความลับของห้อง: กองการ์ด + การ์ดในมือของทุกคน
-- ไม่มี policy ใดๆ = ไม่มีใครอ่านได้เลยผ่าน API (เฉพาะ Edge Function ที่ใช้ service key)
create table if not exists public.room_private (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  data    jsonb not null default '{"deck":[],"hands":{}}'::jsonb
);

-- มือของผู้เล่นแต่ละคน แยกคนละแถว เพื่อให้ RLS ตัดได้ว่าใครเห็นอะไร
create table if not exists public.player_views (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null,
  hand      jsonb not null default '[]'::jsonb,
  primary key (room_id, player_id)
);

create index if not exists rooms_updated_idx on public.rooms (updated_at);

-- ---------- Row Level Security ----------

alter table public.rooms         enable row level security;
alter table public.room_private  enable row level security;
alter table public.player_views  enable row level security;

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms
  for select to authenticated using (true);

-- หัวใจของความปลอดภัย: เห็นได้เฉพาะมือของตัวเองเท่านั้น
-- ต่อให้เปิด DevTools ยิง API ตรงๆ ก็ได้กลับมาแค่แถวของตัวเอง
drop policy if exists views_read_own on public.player_views;
create policy views_read_own on public.player_views
  for select to authenticated using (player_id = auth.uid());

-- room_private ไม่มี policy โดยตั้งใจ → ปฏิเสธทุกการเข้าถึงจากฝั่ง client

-- ไม่มี policy insert/update/delete ที่ไหนเลย
-- แปลว่า client เขียนอะไรลง DB ตรงๆ ไม่ได้เลย ต้องผ่าน Edge Function เท่านั้น

-- ---------- Realtime ----------

alter table public.rooms        replica identity full;
alter table public.player_views replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.rooms;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.player_views;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------- ล้างห้องเก่าทิ้ง (กัน free tier เต็ม) ----------

create or replace function public.cleanup_old_rooms()
returns void language sql security definer as $$
  delete from public.rooms where updated_at < now() - interval '12 hours';
$$;
