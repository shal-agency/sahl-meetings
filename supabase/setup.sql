-- =====================================================================
-- [سهل] مواعيد السيلز — إعداد قاعدة البيانات على Supabase
-- شغّل الملف ده مرة واحدة من: Supabase ← SQL Editor ← New query ← Run
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------- الجداول
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.meetings (
  id               bigint generated always as identity primary key,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_name      text not null check (char_length(client_name) between 1 and 200),
  store            text check (char_length(store) <= 200),
  phone            text check (char_length(phone) <= 40),
  starts_at        timestamptz not null,
  tz               text not null default 'Asia/Riyadh' check (tz in ('Asia/Riyadh', 'Africa/Cairo')),
  duration_min     int  not null default 30 check (duration_min between 5 and 600),
  channel          text not null default 'call' check (channel in ('call','whatsapp','zoom','meet','teams','other')),
  link             text check (char_length(link) <= 500),
  notes            text check (char_length(notes) <= 4000),
  status           text not null default 'upcoming'
                   check (status in ('upcoming','done','postponed','cancelled','no_show')),
  reminder_offsets int[] not null default '{30,10,0}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists meetings_user_start_idx on public.meetings (user_id, starts_at);

create table if not exists public.reminders (
  id         bigint generated always as identity primary key,
  meeting_id bigint not null references public.meetings(id) on delete cascade,
  offset_min int not null,
  fire_at    timestamptz not null,
  sent_at    timestamptz
);
create index if not exists reminders_due_idx on public.reminders (fire_at) where sent_at is null;
create index if not exists reminders_meeting_idx on public.reminders (meeting_id);

create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------- الصلاحيات: كل جهاز يشوف بتاعه بس
alter table public.profiles           enable row level security;
alter table public.meetings           enable row level security;
alter table public.reminders          enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "own meetings" on public.meetings;
create policy "own meetings" on public.meetings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read own reminders" on public.reminders;
create policy "read own reminders" on public.reminders
  for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and m.user_id = auth.uid()));

drop policy if exists "own push subs" on public.push_subscriptions;
create policy "own push subs" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- التذكيرات بتتعمل لوحدها مع كل اجتماع
create or replace function public.touch_meeting() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists meetings_touch on public.meetings;
create trigger meetings_touch before update on public.meetings
  for each row execute function public.touch_meeting();

create or replace function public.rebuild_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  off int;
  f   timestamptz;
begin
  delete from reminders where meeting_id = new.id and sent_at is null;
  foreach off in array coalesce(new.reminder_offsets, '{}'::int[]) loop
    continue when off not in (0, 10, 30, 60, 1440);
    f := new.starts_at - make_interval(mins => off);
    if f >= now() - interval '1 minute'
       and not exists (select 1 from reminders r
                       where r.meeting_id = new.id and r.offset_min = off and r.fire_at = f) then
      insert into reminders (meeting_id, offset_min, fire_at) values (new.id, off, f);
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists meetings_reminders on public.meetings;
create trigger meetings_reminders after insert or update of starts_at, reminder_offsets on public.meetings
  for each row execute function public.rebuild_reminders();

-- ---------------------------------------------------------------- حفظ اشتراك الإشعارات للجهاز
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from push_subscriptions where endpoint = p_endpoint;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth);
end $$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.save_push_subscription(text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------- اللي بيستخدمه المرسِل: يحجز التذكيرات اللي جه ميعادها (مرة واحدة بس)
create or replace function public.claim_due_reminders()
returns table (reminder_id bigint, offset_min int, meeting_id bigint, user_id uuid, client_name text,
               store text, starts_at timestamptz, channel text, status text, stale boolean)
language sql security definer set search_path = public as $$
  with due as (
    update reminders r set sent_at = now()
    where r.sent_at is null and r.fire_at <= now()
    returning r.id, r.offset_min, r.meeting_id, r.fire_at
  )
  select d.id, d.offset_min, m.id, m.user_id, m.client_name, m.store, m.starts_at, m.channel, m.status,
         (now() - d.fire_at) > interval '15 minutes'
  from due d join meetings m on m.id = d.meeting_id;
$$;
revoke all on function public.claim_due_reminders() from public, anon, authenticated;
grant execute on function public.claim_due_reminders() to service_role;

-- ---------------------------------------------------------------- إعدادات داخلية (مفاتيح الإشعارات + سر الجدولة) — محدش يقدر يقراها غير السيرفر
create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);
alter table public.app_settings enable row level security;          -- مفيش policies = محدش من الموقع يقدر يقرا
revoke all on table public.app_settings from anon, authenticated;
insert into public.app_settings (key, value)
values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- ---------------------------------------------------------------- الجدولة: كل دقيقة، بس لو فيه تذكير جه ميعاده
do $$ begin perform cron.unschedule('sahl-send-reminders'); exception when others then null; end $$;
select cron.schedule(
  'sahl-send-reminders',
  '* * * * *',
  $job$
    select net.http_post(
      url     := 'https://bhwdzhkxpvlvkeuzljzh.supabase.co/functions/v1/send-reminders',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'apikey', 'sb_publishable_tLHq-KOMhpzrS7WihNSlyw_-Yd-oNfl',   -- مفتاح عام (نفس اللي في config.js)
                   'x-cron-secret', (select value from public.app_settings where key = 'cron_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 20000)
    where exists (select 1 from public.reminders where sent_at is null and fire_at <= now());
  $job$
);
