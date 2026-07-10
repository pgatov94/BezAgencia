// Сървърен Supabase клиент със "service role" ключ — вижда/пише навсякъде,
// заобикаля Row Level Security. Използва се САМО от serverless функциите
// (api/*.js), никога от src/ (браузъра). Ключът се пази само в Vercel
// Environment Variables — не и в кода, не и в git историята.
//
// Настройка: Supabase Dashboard → Project Settings → API →
// "service_role" (secret) ключ → копирай → Vercel → Project → Settings →
// Environment Variables → добави SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ototukzpkeyvndlodffm.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("supabaseAdmin: липсва SUPABASE_SERVICE_ROLE_KEY в Environment Variables на Vercel.");
}

export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || "placeholder-key"
);
