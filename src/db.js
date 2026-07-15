import { supabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * Този файл замества старото window.storage (което работеше само за хора
 * с логнат Claude акаунт) с истинска, публично достъпна база данни в Supabase.
 * Пази същата форма на извикване (set/get/list/delete), за да не се налага
 * да пипаме бизнес логиката в App.jsx — само "тръбата" отдолу е сменена.
 *
 * Всеки ключ е във формат "префикс:id" (напр. "deal:abc123").
 * Префиксът определя в коя таблица отива записът — виж TABLE_MAP по-долу.
 * Ако добавиш нов тип запис в App.jsx с нов префикс, добави го и тук,
 * плюс създай съответната таблица в Supabase (виж sql/schema.sql).
 */

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
  // Запазва запис. value е JSON.stringify-нат текст (както преди).
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

  // Връща { key, value } или null, ако не съществува.
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

  // prefix е нещо от типа "deal:" — връща { keys: ["deal:abc", "deal:xyz", ...] }
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

  // Зарежда ВСИЧКИ записи от префикса с ЕДНА заявка (вместо list + по едно
  // get на всеки резултат) — много по-бързо за списъци (Оферти, Отзиви и
  // т.н.), защото няма нужда от N допълнителни отделни заявки.
  // Връща масив от { key, value } (value е JSON.stringify-нат текст,
  // както при get/set, за да заменя list+get комбинацията без промяна
  // другаде в кода).
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

  // Анонимно записва едно посещение на страница — без бисквитки, без лични
  // данни. session_id е случаен идентификатор, генериран веднъж на таб
  // (пази се в sessionStorage), само за да броим уникални посещения,
  // отделно от общия брой прегледани страници.
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
