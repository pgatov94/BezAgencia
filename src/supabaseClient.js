import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ototukzpkeyvndlodffm.supabase.co";
const SUPABASE_ANON_KEY = sb_publishable_CkKK9ze_fpweahPn54juuQ_X02FWTUt

export const isSupabaseConfigured =
  !SUPABASE_URL.includes("ТВОЯ-ПРОЕКТ") && !SUPABASE_ANON_KEY.includes("ТВОЯ-ANON-PUBLIC-KEY");

export const supabase = createClient(
  isSupabaseConfigured ? SUPABASE_URL : "https://placeholder.supabase.co",
  isSupabaseConfigured ? SUPABASE_ANON_KEY : "placeholder-key");

