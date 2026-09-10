-- LOOP CLOSER · Supabase setup
-- Run once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.loops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  current_state text not null,
  desired_state text not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.steps (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid not null references public.loops(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  position numeric(14,6) not null default 1000,
  status text not null default 'not_started' check (status in ('not_started','active','waiting','delegated','closed')),
  is_current boolean not null default false,
  waiting_on text,
  delegated_to text,
  delegation_note text,
  deadline timestamptz,
  hard_rule text,
  started_at timestamptz,
  timer_started_at timestamptz,
  active_seconds integer not null default 0 check (active_seconds >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists steps_loop_position_idx on public.steps(loop_id, position);
create unique index if not exists one_current_step_per_loop on public.steps(loop_id) where is_current = true;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists loops_touch_updated_at on public.loops;
create trigger loops_touch_updated_at before update on public.loops
for each row execute function public.touch_updated_at();

drop trigger if exists steps_touch_updated_at on public.steps;
create trigger steps_touch_updated_at before update on public.steps
for each row execute function public.touch_updated_at();

alter table public.loops enable row level security;
alter table public.steps enable row level security;

-- Every row is visible/editable only by the signed-in owner.
drop policy if exists "loops_select_own" on public.loops;
create policy "loops_select_own" on public.loops for select using (auth.uid() = user_id);
drop policy if exists "loops_insert_own" on public.loops;
create policy "loops_insert_own" on public.loops for insert with check (auth.uid() = user_id);
drop policy if exists "loops_update_own" on public.loops;
create policy "loops_update_own" on public.loops for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "loops_delete_own" on public.loops;
create policy "loops_delete_own" on public.loops for delete using (auth.uid() = user_id);

drop policy if exists "steps_select_own" on public.steps;
create policy "steps_select_own" on public.steps for select using (auth.uid() = user_id);
drop policy if exists "steps_insert_own" on public.steps;
create policy "steps_insert_own" on public.steps for insert with check (
  auth.uid() = user_id and exists (
    select 1 from public.loops l where l.id = loop_id and l.user_id = auth.uid()
  )
);
drop policy if exists "steps_update_own" on public.steps;
create policy "steps_update_own" on public.steps for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "steps_delete_own" on public.steps;
create policy "steps_delete_own" on public.steps for delete using (auth.uid() = user_id);
