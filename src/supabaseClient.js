import { createClient } from "@supabase/supabase-js";

// ЗАДЪЛЖИТЕЛНО: смени с твоите реални стойности от Supabase → Project Settings → API.
// Инструкции стъпка по стъпка има в README.md.
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90b3R1a3pwa2V5dm5kbG9kZmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Nzg3ODMsImV4cCI6MjA5OTA1NDc4M30.X0QDofSnzkIlLr3yXkqQMptWnwb8lEdeEbSbaDhKEzk

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
