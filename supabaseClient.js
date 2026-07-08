import { createClient } from "@supabase/supabase-js";

// ЗАДЪЛЖИТЕЛНО: смени с твоите реални стойности от Supabase → Project Settings → API.
// Инструкции стъпка по стъпка има в README.md.
const SUPABASE_URL = "https://ТВОЯ-ПРОЕКТ.supabase.co";
const SUPABASE_ANON_KEY = "ТВОЯ-ANON-PUBLIC-KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
