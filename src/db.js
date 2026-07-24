import { supabase, isSupabaseConfigured } from "./supabaseClient";

const TABLE_MAP = {
  deal: "deals",
  offer: "offers",
  payment: "payments",
  inquiry: "inquiries",
  review: "reviews",
  voucher: "vouchers",
  newsletter: "newsletter_subscribers",
  visit: "site_visits",
};

function parseKey(key) {
  const idx = key.indexOf(":");
  if (idx === -1) return { prefix: key, id: "" };
  return { prefix: key.slice(0, idx), id: key.slice(idx + 1) };
}

const NOT_CONFIGURED_MSG =
  "Supabase не е свързан — провери дали си сложил истинските SUPABASE_URL и SUPABASE_ANON_KEY в src/supabaseClient.js (виж README.md, Стъпка 1 и 2).";

export const db = {
  async set(key, value) {
    if (!isSupabaseConfigured) {
      console.error(NOT_CONFIGURED_MSG);
      return null;
    }
    const { prefix, id } = parseKey(key);
    const table = TABLE_MAP[prefix];
    if (!table) {
      console.error("db.set: непознат префикс на ключ:", key);
      return null;
    }
    let data;
    try {
      data = JSON.parse(value);
    } catch {
      console.error("db.set: невалиден JSON за ключ:", key);
      return null;
    }
    const { error } = await supabase
      .from(table)
      .upsert({ id, data, updated_at: new Date().toISOString() });
    if (error) {
      console.error("db.set грешка:", error.message);
      return null;
    }
    return { key, value, shared: true };
  },

  async get(key) {
    if (!isSupabaseConfigured) {
      console.error(NOT_CONFIGURED_MSG);
      return null;
    }
    const { prefix, id } = parseKey(key);
    const table = TABLE_MAP[prefix];
    if (!table) return null;
    const { data, error } = await supabase
      .from(table)
      .select("data")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("db.get грешка:", error.message);
      return null;
    }
    if (!data) return null;
    return { key, value: JSON.stringify(data.data), shared: true };
  },

  async list(prefix) {
    if (!isSupabaseConfigured) {
      throw new Error(NOT_CONFIGURED_MSG);
    }
    const p = prefix.replace(/:$/, "");
    const table = TABLE_MAP[p];
    if (!table) return { keys: [], prefix, shared: true };
    const { data, error } = await supabase.from(table).select("id");
    if (error) {
      throw new Error("Storage list failed: " + error.message);
    }
    return { keys: (data || []).map((r) => `${p}:${r.id}`), prefix, shared: true };
  },

  async listAll(prefix) {
    if (!isSupabaseConfigured) {
      throw new Error(NOT_CONFIGURED_MSG);
    }
    const p = prefix.replace(/:$/, "");
    const table = TABLE_MAP[p];
    if (!table) return [];
    const { data, error } = await supabase.from(table).select("id, data");
    if (error) {
      throw new Error("Storage listAll failed: " + error.message);
    }
    return (data || []).map((r) => ({ key: `${p}:${r.id}`, value: JSON.stringify(r.data), shared: true }));
  },

  // Олекотена версия само за ПУБЛИЧНИЯ списък с оферти — тегли само
  // полетата, нужни за показване в картите (без тежките вътрешни снимки
  // за полет/настаняване, които преди причиняваха "statement timeout").
  async listPublicDeals() {
    if (!isSupabaseConfigured) {
      throw new Error(NOT_CONFIGURED_MSG);
    }
    const { data, error } = await supabase
      .from("deals")
      .select("id, data->title, data->city, data->country, data->tag, data->departureFrom, data->flightPrice, data->hotelPrice, data->totalPrice, data->travelMonth, data->imageDataUrl, data->createdAt");
    if (error) {
      throw new Error("Storage listPublicDeals failed: " + error.message);
    }
    return data || [];
  },

  async delete(key) {
    if (!isSupabaseConfigured) {
      console.error(NOT_CONFIGURED_MSG);
      return null;
    }
    const { prefix, id } = parseKey(key);
    const table = TABLE_MAP[prefix];
    if (!table) return null;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) {
      console.error("db.delete грешка:", error.message);
      return null;
    }
    return { key, deleted: true, shared: true };
  },

  async logVisit(path, referrer, device) {
    if (!isSupabaseConfigured) return null;
    let sessionId = "";
    try {
      sessionId = sessionStorage.getItem("ba_session_id");
      if (!sessionId) {
        sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem("ba_session_id", sessionId);
      }
    } catch { /* sessionStorage недостъпен — продължаваме без session_id */ }
    try {
      await supabase.from("site_visits").insert({ path, referrer: referrer || null, device, session_id: sessionId });
    } catch { /* никога не чупим сайта заради проследяването */ }
    return null;
  },
};
