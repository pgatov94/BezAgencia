-- ─────────────────────────────────────────────────────────────────────
-- Схема за БезАгенция — изпълни целия този файл в Supabase → SQL Editor
-- (Project → SQL Editor → New query → постави → Run)
-- ─────────────────────────────────────────────────────────────────────

create table if not exists deals (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists payments (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists inquiries (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists reviews (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists vouchers (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists newsletter_subscribers (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────
-- ВАЖНО ЗА СИГУРНОСТТА (прочети преди да пуснеш сайта на живо):
-- По подразбиране тези таблици НЯМАТ Row Level Security (RLS) включен,
-- което означава, че всеки с anon ключа (публичния ключ, вграден в сайта)
-- може да чете И пише във всички таблици. Това е ОК за бърз старт/тест,
-- но за истински бизнес трябва поне:
--   1. Да включиш RLS на всяка таблица
--   2. Да разрешиш SELECT на всички (публично четене на оферти и т.н.)
--   3. Да ограничиш INSERT/UPDATE/DELETE само за админа
--      (най-лесно през Supabase Auth + policy, вместо клиентската парола
--      в кода, която в момента е само символична защита)
-- Ако искаш, кажи ми и ще ти подготвя policies + истински админ логин
-- през Supabase Auth (имейл+парола), вместо сегашната проста парола.
-- ─────────────────────────────────────────────────────────────────────
