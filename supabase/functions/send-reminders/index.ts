// [سهل] مواعيد السيلز — Edge Function: بيبعت إشعارات التذكير
// - pg_cron بينادي عليها كل دقيقة (بالـ x-cron-secret المحفوظ في app_settings)
// - الموقع بيطلب منها مفتاح الإشعارات العام {vapid:true}، وبيبعت إشعار تجريبي {test:true} بتوكن المستخدم
// مفاتيح VAPID بتتولد هنا أول مرة وبتتحفظ في app_settings — مفيش أسرار بتتكتب يدوي.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch (_) { /* ignore */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const SERVICE_KEY = secretKey();
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "https://shal-agency.github.io/sahl-meetings/";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function getSetting(key: string): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

let vapid: { publicKey: string; privateKey: string } | null = null;
async function loadVapid() {
  if (vapid) return vapid;
  let pub = await getSetting("vapid_public");
  let priv = await getSetting("vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    // ignoreDuplicates: لو نسختين اشتغلوا مع بعض، الأولى بس اللي تتحفظ
    await admin.from("app_settings").upsert(
      [{ key: "vapid_public", value: k.publicKey }, { key: "vapid_private", value: k.privateKey }],
      { onConflict: "key", ignoreDuplicates: true },
    );
    pub = await getSetting("vapid_public");
    priv = await getSetting("vapid_private");
  }
  vapid = { publicKey: pub!, privateKey: priv! };
  webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);
  return vapid;
}

const CHANNELS: Record<string, string> = {
  call: "مكالمة تليفون", whatsapp: "واتساب", zoom: "Zoom", meet: "Google Meet", teams: "Teams", other: "",
};
const WHEN: Record<number, string> = {
  0: "دلوقتي", 10: "بعد 10 دقايق", 30: "بعد نص ساعة", 60: "بعد ساعة", 1440: "بكرة في نفس الميعاد",
};
const fmt = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone: tz, hour: "numeric", minute: "2-digit" })
    .format(new Date(iso));

async function sendToUser(userId: string, payload: Record<string, unknown>): Promise<number> {
  await loadVapid();
  const { data: subs, error } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
  if (error) { console.error("subs error", error); return 0; }
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        console.error("push failed", s.id, code, (e as Error).message);
      }
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));

  // ---- المفتاح العام للإشعارات (عام بطبيعته)
  if (body?.vapid) {
    const v = await loadVapid();
    return json({ key: v.publicKey });
  }

  // ---- إشعار تجريبي من صفحة الإعدادات
  if (body?.test) {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) return json({ ok: false, error: "unauthorized" }, 401);
    const n = await sendToUser(data.user.id, {
      title: "إشعار تجريبي ✓",
      body: "لو شايف ده يبقى التذكيرات هتوصلك على الجهاز ده.",
      tag: "test",
      url: "",
    });
    return json({ ok: n > 0, devices: n });
  }

  // ---- التشغيل الدوري من pg_cron
  const secret = await getSetting("cron_secret");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  const { data: rows, error } = await admin.rpc("claim_due_reminders");
  if (error) { console.error("claim error", error); return json({ ok: false }, 500); }

  let sent = 0;
  for (const r of rows ?? []) {
    if (!["upcoming", "postponed"].includes(r.status) || r.stale) continue;
    const parts = [
      r.store,
      `🕒 ${fmt(r.starts_at, "Africa/Cairo")} مصر / ${fmt(r.starts_at, "Asia/Riyadh")} السعودية`,
      CHANNELS[r.channel],
    ].filter(Boolean);
    sent += await sendToUser(r.user_id, {
      title: `اجتماع ${r.client_name} ${WHEN[r.offset_min] ?? ""}`.trim(),
      body: parts.join(" · "),
      tag: `meeting-${r.meeting_id}`,
      url: `#/m/${r.meeting_id}`,
    });
  }
  return json({ ok: true, reminders: rows?.length ?? 0, pushes: sent });
});
