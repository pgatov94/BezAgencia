import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ototukzpkeyvndlodffm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90b3R1a3pwa2V5dm5kbG9kZmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0OTYwMzgsImV4cCI6MjA5OTA3MjAzOH0.X0QDofSnzkI1Lr3yXkqQMptWnwb81EdeEbSbaDhKEzk";

export const isSupabaseConfigured =
  !SUPABASE_URL.includes("ТВОЯ-ПРОЕКТ") && !SUPABASE_ANON_KEY.includes("ТВОЯ-ANON-PUBLIC-KEY");

export const supabase = createClient(
  isSupabaseConfigured ? SUPABASE_URL : "https://placeholder.supabase.co",
  isSupabaseConfigured ? SUPABASE_ANON_KEY : "placeholder-key");

