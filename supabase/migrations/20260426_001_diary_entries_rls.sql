-- Special Diary: diary_entries 테이블 + RLS 정책
--
-- 본 마이그레이션은 다음을 보장한다:
-- 1) 테이블 스키마 (이미 존재 시 IF NOT EXISTS로 안전).
-- 2) user_id에 DEFAULT auth.uid() — 클라이언트가 user_id를 보내지 않아도 자동 부여 (M2).
-- 3) RLS 활성화 + SELECT/INSERT/UPDATE/DELETE 정책 — anon 키만으로는 타사용자 행 접근 불가 (C1).
-- 4) 검색 성능을 위한 인덱스.
--
-- 적용 방법:
--   supabase db push       (Supabase CLI 사용 시)
--   또는 Supabase Studio > SQL Editor에 그대로 붙여넣기.

create table if not exists public.diary_entries (
    id text not null,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    date timestamptz not null,
    content text not null default '',
    daily_comment text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (id, user_id)
);

create index if not exists diary_entries_user_id_date_idx
    on public.diary_entries (user_id, date desc);

create index if not exists diary_entries_user_id_updated_at_idx
    on public.diary_entries (user_id, updated_at desc);

-- updated_at을 자동 갱신
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists diary_entries_set_updated_at on public.diary_entries;
create trigger diary_entries_set_updated_at
    before update on public.diary_entries
    for each row execute function public.set_updated_at();

-- RLS
alter table public.diary_entries enable row level security;

-- 기존 정책 정리 후 재생성 (재실행 안전)
drop policy if exists "diary_entries_select_own" on public.diary_entries;
drop policy if exists "diary_entries_insert_own" on public.diary_entries;
drop policy if exists "diary_entries_update_own" on public.diary_entries;
drop policy if exists "diary_entries_delete_own" on public.diary_entries;

create policy "diary_entries_select_own"
    on public.diary_entries for select
    using (user_id = auth.uid());

create policy "diary_entries_insert_own"
    on public.diary_entries for insert
    with check (user_id = auth.uid());

create policy "diary_entries_update_own"
    on public.diary_entries for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy "diary_entries_delete_own"
    on public.diary_entries for delete
    using (user_id = auth.uid());
