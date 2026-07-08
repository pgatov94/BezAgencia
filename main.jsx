import { createClient } from "@supabase/supabase-js";

// ЗАДЪЛЖИТЕЛНО: смени с твоите реални стойности от Supabase → Project Settings → API.
// Инструкции стъпка по стъпка има в README.md.
const SUPABASE_URL = "https://ototukzpkeyvndlodffm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_CkKK9ze_fpweahPn54juuQ_X02FWTUt";

export const isSupabaseConfigured =
  !SUPABASE_URL.includes("ТВОЯ-ПРОЕКТ") && !SUPABASE_ANON_KEY.includes("ТВОЯ-ANON-PUBLIC-KEY");

// Ако ключовете още не са сложени, ползваме валиден "празен" адрес вместо
// текста с кирилица (който би счупил всяка мрежова заявка веднага), за да
// може приложението поне да се зареди и да покаже ясно съобщение, вместо
// напълно да блокира при стартиране.
export const supabase = createClient(
  isSupabaseConfigured ? SUPABASE_URL : "https://placeholder.supabase.co",
  isSupabaseConfigured ? SUPABASE_ANON_KEY : "placeholder-key"
);
