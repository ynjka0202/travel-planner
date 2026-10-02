-- ============================================================
-- Personal Travel Planning & Travel Memory Management System
-- Supabase SQL схем  (SQL Editor дээр бүтнээр нь нэг удаа ажиллуулна)
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. Аяллууд ----------
create table if not exists public.trips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text,
  destination  text not null,
  country      text,
  category     text not null default 'domestic' check (category in ('domestic','international')),
  start_date   date not null,
  end_date     date not null,
  budget       numeric(14,2) not null default 0 check (budget >= 0),
  currency     text not null default 'MNT',
  notes        text,
  status       text not null default 'planned' check (status in ('planned','completed')),
  completed_at timestamptz,
  cover_path   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint trips_dates_chk check (end_date >= start_date)
);

-- ---------- 2. Checklist (авч явах зүйлс) ----------
create table if not exists public.checklist_items (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 200),
  is_done    boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- 3. Дурсамжийн тэмдэглэл ----------
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  memory_date date not null default current_date,
  note        text not null check (char_length(note) between 1 and 5000),
  created_at  timestamptz not null default now()
);

-- ---------- 4. Зургууд ----------
create table if not exists public.photos (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path       text not null,
  caption    text,
  created_at timestamptz not null default now()
);

create index if not exists trips_user_start_idx on public.trips(user_id, start_date desc);
create index if not exists checklist_trip_idx   on public.checklist_items(trip_id);
create index if not exists memories_trip_idx    on public.memories(trip_id, memory_date desc);
create index if not exists photos_trip_idx      on public.photos(trip_id, created_at desc);

-- updated_at автоматаар шинэчлэх
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists trips_updated_at on public.trips;
create trigger trips_updated_at before update on public.trips
for each row execute function public.set_updated_at();

-- ============================================================
-- Row Level Security: хэрэглэгч зөвхөн өөрийн өгөгдлийг харна
-- ============================================================
alter table public.trips           enable row level security;
alter table public.checklist_items enable row level security;
alter table public.memories        enable row level security;
alter table public.photos          enable row level security;

drop policy if exists "trips_own" on public.trips;
create policy "trips_own" on public.trips for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "checklist_own" on public.checklist_items;
create policy "checklist_own" on public.checklist_items for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));

drop policy if exists "memories_own" on public.memories;
create policy "memories_own" on public.memories for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));

drop policy if exists "photos_own" on public.photos;
create policy "photos_own" on public.photos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));

-- ============================================================
-- Storage: зураг хадгалах private bucket
-- Файлын зам:  <user_id>/<trip_id>/...
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-media', 'trip-media', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists "media_select_own" on storage.objects;
create policy "media_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'trip-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_insert_own" on storage.objects;
create policy "media_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_update_own" on storage.objects;
create policy "media_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'trip-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_delete_own" on storage.objects;
create policy "media_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'trip-media' and (storage.foldername(name))[1] = auth.uid()::text);
