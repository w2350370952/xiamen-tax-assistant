import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getStore } from "@edgeone/pages-blob";

const store = getStore("xiamen-tax-assistant");
const STATE_KEY = "course-state.json";
const ANALYTICS_KEY = "anonymous-analytics-v1.json";
const COOKIE = "xnai_admin";
const ADMIN_USER = "xnaitax2025";
const ADMIN_PASSWORD_SHA256 = "3d4a6df67e692969e3092a220365c136d761097075b504bea76c0b2858a22bb5";
const SESSION_SECONDS = 60 * 60 * 12;
const MAJOR_KEYS = ["tax", "accounting", "audit", "finance"];
const MENU_MEALS = {
  breakfast: ["热菜", "中点", "主食", "西点", "饮料"],
  lunch: ["热菜", "免费汤", "炖汤", "主食", "面档", "饮品", "煎扒档", "饮料"],
  dinner: ["热菜", "免费汤", "主食", "面档", "煎扒档"],
};
const MENU_CATEGORY_SOURCES = {
  breakfast: { 热菜: ["热菜", "小菜"], 中点: ["中点"], 主食: ["主食"], 西点: ["西点"], 饮料: ["饮料", "水果/饮料", "水果"] },
  lunch: { 热菜: ["热菜"], 免费汤: ["免费汤", "快汤"], 炖汤: ["炖汤", "炖罐汤"], 主食: ["主食"], 面档: ["面档"], 饮品: ["饮品", "佐品"], 煎扒档: ["煎扒档"], 饮料: ["饮料", "水果/饮料", "水果"] },
  dinner: { 热菜: ["热菜"], 免费汤: ["免费汤", "快汤", "炖罐汤", "炖汤"], 主食: ["主食"], 面档: ["面档"], 煎扒档: ["煎扒档"] },
};

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
});

const fail = (detail, status = 400) => json({ detail }, status);
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const hmac = (key, value, encoding) => createHmac("sha256", key).update(value).digest(encoding);

function safeEqualHex(left, right) {
  try {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

function cookieValue(request, name) {
  const source = request.headers.get("cookie") || "";
  const match = source.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

const defaultVersion = (remark = "暂无已发布课程") => ({ label: "v1.0", updated_at: null, remark });
const majorKey = (value) => MAJOR_KEYS.includes(value) ? value : "tax";

function normalizeState(raw) {
  const state = raw || {};
  const legacyTax = {
    courses: Array.isArray(state.courses) ? state.courses : [],
    version: state.version || defaultVersion("内置税务课程数据"),
  };
  const majors = state.majors || { tax: legacyTax };
  for (const key of MAJOR_KEYS) {
    majors[key] ||= { courses: [], version: defaultVersion() };
    majors[key].courses = Array.isArray(majors[key].courses) ? majors[key].courses : [];
    majors[key].version ||= defaultVersion();
  }
  return {
    majors,
    uploads: (state.uploads || []).map((upload) => ({ ...upload, major: majorKey(upload.major) })),
    menus: {
      current: state.menus?.current ? sanitizeMenu(state.menus.current) : null,
      version: state.menus?.version || defaultVersion("暂无已发布菜单"),
      uploads: Array.isArray(state.menus?.uploads) ? state.menus.uploads.map((upload) => ({ ...upload, menu: sanitizeMenu(upload.menu), source_menu: upload.source_menu ? sanitizeMenu(upload.source_menu) : null })) : [],
      dictionary: sanitizeDishDictionary(state.menus?.dictionary, state.menus?.current),
    },
  };
}

async function readState() {
  const state = await store.get(STATE_KEY, { type: "json", consistency: "strong" });
  return normalizeState(state);
}

async function writeState(state) {
  await store.setJSON(STATE_KEY, state, { cacheControl: "no-store" });
}

function beijingDateHour(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${map.year}-${map.month}-${map.day}`, hour: map.hour };
}

function analyticsDateOffset(date, offset) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function devicePlatform(request) {
  const ua = request.headers.get("user-agent") || "";
  if (/HarmonyOS|HUAWEI.*Harmony/i.test(ua)) return "HarmonyOS";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "其他";
}

const uniquePush = (list, value) => { if (!list.includes(value)) list.push(value); };
function normalizeAnalytics(raw) { return { days: raw?.days && typeof raw.days === "object" ? raw.days : {} }; }
async function readAnalytics() { return normalizeAnalytics(await store.get(ANALYTICS_KEY, { type: "json", consistency: "strong" })); }
async function writeAnalytics(data) { await store.setJSON(ANALYTICS_KEY, data, { cacheControl: "no-store" }); }

async function recordAnonymousVisit(request) {
  const ua = request.headers.get("user-agent") || "";
  if (/bot|spider|crawler|headless|preview/i.test(ua)) return json({ ok: true, ignored: true }, 202);
  const body = await bodyJson(request);
  const clientId = text(body.visitor_id, 100);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(clientId)) return fail("匿名访客标识无效");
  const visitor = sha256(`xnai-anonymous:${clientId}`).slice(0, 24);
  const platform = devicePlatform(request);
  const { date, hour } = beijingDateHour();
  const analytics = await readAnalytics();
  const day = analytics.days[date] ||= { views: 0, visitors: [], hours: {}, devices: {} };
  day.views = Math.max(0, Number(day.views) || 0) + 1;
  day.visitors = Array.isArray(day.visitors) ? day.visitors : [];
  uniquePush(day.visitors, visitor);
  const hourData = day.hours[hour] ||= { views: 0, visitors: [] };
  hourData.views = Math.max(0, Number(hourData.views) || 0) + 1;
  hourData.visitors = Array.isArray(hourData.visitors) ? hourData.visitors : [];
  uniquePush(hourData.visitors, visitor);
  const deviceData = day.devices[platform] ||= { views: 0, visitors: [] };
  deviceData.views = Math.max(0, Number(deviceData.views) || 0) + 1;
  deviceData.visitors = Array.isArray(deviceData.visitors) ? deviceData.visitors : [];
  uniquePush(deviceData.visitors, visitor);
  const keepFrom = analyticsDateOffset(date, -89);
  for (const key of Object.keys(analytics.days)) if (key < keepFrom || key > date) delete analytics.days[key];
  await writeAnalytics(analytics);
  return json({ ok: true }, 202);
}

async function analyticsReport(url) {
  const requested = Number(url.searchParams.get("days"));
  const range = [7, 30, 90].includes(requested) ? requested : 7;
  const today = beijingDateHour().date;
  const analytics = await readAnalytics();
  const rangeVisitors = new Set();
  const deviceVisitors = {};
  const days = Array.from({ length: range }, (_, index) => analyticsDateOffset(today, index - range + 1)).map((date) => {
    const source = analytics.days[date] || {};
    const visitors = Array.isArray(source.visitors) ? source.visitors : [];
    visitors.forEach((visitor) => rangeVisitors.add(visitor));
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const key = String(hour).padStart(2, "0"), item = source.hours?.[key] || {};
      return { hour: key, views: Math.max(0, Number(item.views) || 0), visitors: Array.isArray(item.visitors) ? item.visitors.length : 0 };
    });
    const devices = Object.entries(source.devices || {}).map(([name, item]) => {
      deviceVisitors[name] ||= new Set();
      if (Array.isArray(item.visitors)) item.visitors.forEach((visitor) => deviceVisitors[name].add(visitor));
      return { name, views: Math.max(0, Number(item.views) || 0), visitors: Array.isArray(item.visitors) ? item.visitors.length : 0 };
    }).sort((a, b) => b.visitors - a.visitors || b.views - a.views);
    return { date, views: Math.max(0, Number(source.views) || 0), visitors: visitors.length, hours, devices };
  });
  const totalViews = days.reduce((sum, day) => sum + day.views, 0);
  const mobileVisitors = new Set([...(deviceVisitors.iOS || []), ...(deviceVisitors.Android || []), ...(deviceVisitors.HarmonyOS || [])]);
  const todayData = days[days.length - 1];
  return json({ range, generated_at: new Date().toISOString(), summary: { today_views: todayData.views, today_visitors: todayData.visitors, range_views: totalViews, range_visitors: rangeVisitors.size, mobile_visitors: mobileVisitors.size, mobile_share: rangeVisitors.size ? Math.round(mobileVisitors.size / rangeVisitors.size * 100) : 0 }, days });
}

async function requireAdmin(request) {
  const token = cookieValue(request, COOKIE);
  if (!token || token.length > 200) return false;
  const key = `sessions/${sha256(token)}.json`;
  const session = await store.get(key, { type: "json", consistency: "strong" });
  if (!session || session.expires_at < Date.now()) {
    if (session) await store.delete(key).catch(() => {});
    return false;
  }
  return true;
}

async function bodyJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 900_000) throw new Error("提交数据过大");
  return request.json();
}

async function recognizeMenuTable(imageBase64) {
  const secretId = process.env.TENCENT_OCR_SECRET_ID || "";
  const secretKey = process.env.TENCENT_OCR_SECRET_KEY || "";
  if (!secretId || !secretKey) return { configured: false };
  const host = "ocr.tencentcloudapi.com";
  const service = "ocr";
  const action = "RecognizeTableAccurateOCR";
  const version = "2018-11-19";
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({ ImageBase64: imageBase64, UseNewModel: true });
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`;
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: host,
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": version,
      "X-TC-Region": "ap-guangzhou",
    },
    body: payload,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.Response?.Error) {
    const message = result.Response?.Error?.Message || `腾讯云 OCR 请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return { configured: true, table_detections: result.Response?.TableDetections || [], angle: result.Response?.Angle || 0, request_id: result.Response?.RequestId || "" };
}

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
function sanitizeCourse(input, fallbackId = null) {
  return {
    id: text(input.id, 120) || fallbackId || randomUUID(),
    date: text(input.date, 10),
    weekday: text(input.weekday, 4),
    time: text(input.period || input.time, 10),
    period: text(input.period || input.time, 10),
    start_time: text(input.start_time, 5),
    end_time: text(input.end_time, 5),
    course_name: text(input.course_name, 200),
    teacher: text(input.teacher, 100),
    class_name: text(input.class_name, 100),
    classroom: text(input.classroom, 100),
    remark: text(input.remark, 300),
    course_type: ["tax", "english", "digital", "other"].includes(input.course_type) ? input.course_type : "other",
    source_page: Number(input.source_page) || null,
  };
}

function validCourse(course) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(course.date) && course.course_name && course.weekday && course.period && /^\d{2}:\d{2}$/.test(course.start_time) && /^\d{2}:\d{2}$/.test(course.end_time);
}

function sanitizeMenu(input) {
  const source = input || {};
  const days = Array.isArray(source.days) ? source.days.slice(0, 7).map((day, dayIndex) => {
    const meals = {};
    for (const [meal, categories] of Object.entries(MENU_MEALS)) {
      meals[meal] = {};
      for (const category of categories) {
        const sourceNames = MENU_CATEGORY_SOURCES[meal]?.[category] || [category];
        const items = sourceNames.flatMap((sourceName) => Array.isArray(day?.meals?.[meal]?.[sourceName]) ? day.meals[meal][sourceName] : []);
        meals[meal][category] = [...new Set(items.slice(0, 40).map((item) => text(item, 100)).filter(Boolean))];
      }
    }
    return {
      date: text(day?.date, 10),
      weekday: text(day?.weekday, 4) || ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"][dayIndex],
      meals,
    };
  }) : [];
  return { week_start: text(source.week_start, 10), days };
}

function normalizedDishName(value) {
  return text(value, 100).toLowerCase().replace(/[\s·•,，。；;：:、\/\\()（）【】\[\]“”"'‘’+-]/g, "");
}

function sanitizeDishDictionary(raw, currentMenu = null) {
  const entries = Array.isArray(raw) ? raw.slice(0, 1200).map((entry) => ({
    name: text(entry?.name, 100),
    meal: ["breakfast", "lunch", "dinner"].includes(entry?.meal) ? entry.meal : "lunch",
    category: text(entry?.category, 30),
    aliases: Array.isArray(entry?.aliases) ? [...new Set(entry.aliases.slice(0, 30).map((item) => text(item, 100)).filter(Boolean))] : [],
    uses: Math.max(1, Number(entry?.uses) || 1),
    updated_at: text(entry?.updated_at, 30) || null,
  })).filter((entry) => entry.name && MENU_MEALS[entry.meal]?.includes(entry.category)) : [];
  if (currentMenu) ensureMenuDishes(entries, sanitizeMenu(currentMenu), false);
  return entries.slice(0, 1200);
}

function dictionaryEntry(dictionary, name, meal, category) {
  const normalized = normalizedDishName(name);
  return dictionary.find((entry) => entry.meal === meal && entry.category === category && normalizedDishName(entry.name) === normalized);
}

function ensureMenuDishes(dictionary, menu, increaseUses = true) {
  for (const day of menu?.days || []) for (const [meal, categories] of Object.entries(day.meals || {})) for (const [category, items] of Object.entries(categories || {})) for (const rawName of items || []) {
    const name = text(rawName, 100); if (!name || /无法识别|看不清|未识别/.test(name)) continue;
    const existing = dictionaryEntry(dictionary, name, meal, category);
    if (existing) { if (increaseUses) existing.uses = Math.min(9999, existing.uses + 1); existing.updated_at = new Date().toISOString(); }
    else dictionary.push({ name, meal, category, aliases: [], uses: 1, updated_at: new Date().toISOString() });
  }
  dictionary.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, "zh-CN"));
  if (dictionary.length > 1200) dictionary.length = 1200;
  return dictionary;
}

function addCorrectionAliases(dictionary, sourceMenu, confirmedMenu) {
  if (!sourceMenu || !confirmedMenu) return;
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) for (const [meal, categories] of Object.entries(MENU_MEALS)) for (const category of categories) {
    const sourceItems = sourceMenu.days?.[dayIndex]?.meals?.[meal]?.[category] || [];
    const confirmedItems = confirmedMenu.days?.[dayIndex]?.meals?.[meal]?.[category] || [];
    if (sourceItems.length !== confirmedItems.length) continue;
    for (let index = 0; index < confirmedItems.length; index += 1) {
      const source = text(sourceItems[index], 100), confirmed = text(confirmedItems[index], 100);
      if (!source || !confirmed || normalizedDishName(source) === normalizedDishName(confirmed) || /无法识别|看不清|未识别/.test(source)) continue;
      const entry = dictionaryEntry(dictionary, confirmed, meal, category);
      if (entry && !entry.aliases.some((alias) => normalizedDishName(alias) === normalizedDishName(source))) entry.aliases.push(source);
    }
  }
}

function applyKnownDishAliases(menu, dictionary) {
  const corrected = sanitizeMenu(menu); let corrections = 0;
  for (const day of corrected.days) for (const [meal, categories] of Object.entries(day.meals)) for (const [category, items] of Object.entries(categories)) {
    categories[category] = items.map((item) => {
      const normalized = normalizedDishName(item);
      const match = dictionary.find((entry) => entry.meal === meal && entry.category === category && (normalizedDishName(entry.name) === normalized || entry.aliases.some((alias) => normalizedDishName(alias) === normalized)));
      if (match && match.name !== item) { corrections += 1; return match.name; }
      return item;
    });
  }
  return { menu: corrected, corrections };
}

function validMenu(menu) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(menu.week_start) && menu.days.length === 7 && menu.days.every((day) => /^20\d{2}-\d{2}-\d{2}$/.test(day.date));
}

function nextVersion(label) {
  const match = String(label || "v1.0").match(/^v?(\d+)\.(\d+)$/);
  return match ? `v${match[1]}.${Number(match[2]) + 1}` : "v1.1";
}

function markCourseUpdate(majorData, remark) {
  majorData.version = {
    label: nextVersion(majorData.version?.label),
    updated_at: new Date().toISOString(),
    remark,
  };
}

async function login(request) {
  const body = await bodyJson(request);
  const userOk = text(body.username, 80) === ADMIN_USER;
  const passwordOk = safeEqualHex(sha256(body.password || ""), ADMIN_PASSWORD_SHA256);
  if (!userOk || !passwordOk) return fail("账号或密码错误", 401);
  const token = randomBytes(32).toString("hex");
  await store.setJSON(`sessions/${sha256(token)}.json`, { expires_at: Date.now() + SESSION_SECONDS * 1000 }, { cacheControl: "no-store" });
  return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}` });
}

async function logout(request) {
  const token = cookieValue(request, COOKIE);
  if (token) await store.delete(`sessions/${sha256(token)}.json`).catch(() => {});
  return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
}

async function adminRoutes(request, url, path) {
  if (path === "/api/admin/login" && request.method === "POST") return login(request);
  if (path === "/api/admin/logout" && request.method === "POST") return logout(request);
  if (!(await requireAdmin(request))) return fail("管理员登录已失效，请重新登录", 401);
  if (path === "/api/admin/session" && request.method === "GET") return json({ authenticated: true });
  if (path === "/api/admin/analytics" && request.method === "GET") return analyticsReport(url);

  if (path === "/api/admin/courses" && request.method === "GET") {
    const state = await readState();
    const major = majorKey(url.searchParams.get("major"));
    return json({ major, courses: state.majors[major].courses, version: state.majors[major].version });
  }

  if (path === "/api/admin/menu" && request.method === "GET") {
    const state = await readState();
    return json({ menu: state.menus.current ? sanitizeMenu(state.menus.current) : null, version: state.menus.version, dictionary: state.menus.dictionary });
  }

  if (path === "/api/admin/menu-ocr" && request.method === "POST") {
    const body = await bodyJson(request);
    const imageBase64 = String(body.image_base64 || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
    if (!imageBase64 || imageBase64.length > 800_000) return fail("菜单图片为空或过大，请使用小于 600KB 的清晰 JPG 图片");
    const result = await recognizeMenuTable(imageBase64);
    return json(result);
  }

  if (path === "/api/admin/menu" && request.method === "PATCH") {
    const body = await bodyJson(request);
    const menu = sanitizeMenu(body.menu);
    if (!validMenu(menu)) return fail("菜单所属周和七天日期不完整");
    const state = await readState();
    state.menus.current = menu;
    ensureMenuDishes(state.menus.dictionary, menu, true);
    state.menus.version = { label: nextVersion(state.menus.version?.label), updated_at: new Date().toISOString(), remark: "管理员修改已发布菜单" };
    await writeState(state);
    return json({ menu, version: state.menus.version });
  }

  if (path === "/api/admin/menu-uploads" && request.method === "GET") {
    const state = await readState();
    return json({ uploads: state.menus.uploads });
  }

  if (path === "/api/admin/menu-uploads" && request.method === "POST") {
    const body = await bodyJson(request);
    const sourceMenu = sanitizeMenu(body.menu);
    if (!validMenu(sourceMenu)) return fail("菜单所属周和七天日期不完整");
    const state = await readState();
    const matched = applyKnownDishAliases(sourceMenu, state.menus.dictionary);
    const upload = {
      id: randomUUID(),
      filename: text(body.filename, 220) || "一周菜单图片",
      uploaded_at: new Date().toISOString(),
      status: "review",
      warnings: Array.isArray(body.warnings) ? body.warnings.slice(0, 20).map((item) => text(item, 300)) : [],
      recognized_lines: Math.max(0, Number(body.recognized_lines) || 0),
      menu: matched.menu,
      source_menu: sourceMenu,
      dictionary_corrections: matched.corrections,
    };
    state.menus.uploads = [upload, ...state.menus.uploads].slice(0, 12);
    await writeState(state);
    return json({ upload }, 201);
  }

  if (path.startsWith("/api/admin/menu-uploads/") && request.method === "PATCH") {
    const uploadId = decodeURIComponent(path.slice("/api/admin/menu-uploads/".length));
    const body = await bodyJson(request);
    const menu = sanitizeMenu(body.menu);
    if (!validMenu(menu)) return fail("菜单所属周和七天日期不完整");
    const state = await readState();
    const upload = state.menus.uploads.find((item) => item.id === uploadId);
    if (!upload) return fail("未找到菜单上传记录", 404);
    if (body.capture_source) {
      upload.source_menu = menu;
      const matched = applyKnownDishAliases(menu, state.menus.dictionary);
      upload.menu = matched.menu;
      upload.dictionary_corrections = matched.corrections;
    } else upload.menu = menu;
    upload.status = "review";
    await writeState(state);
    return json({ upload });
  }

  if (path.startsWith("/api/admin/menu-uploads/") && request.method === "DELETE") {
    const uploadId = decodeURIComponent(path.slice("/api/admin/menu-uploads/".length));
    const state = await readState();
    const before = state.menus.uploads.length;
    state.menus.uploads = state.menus.uploads.filter((item) => item.id !== uploadId);
    if (before === state.menus.uploads.length) return fail("未找到菜单上传记录", 404);
    await writeState(state);
    return json({ ok: true });
  }

  if (path === "/api/admin/menu-publish" && request.method === "POST") {
    const body = await bodyJson(request);
    const state = await readState();
    const upload = state.menus.uploads.find((item) => item.id === body.upload_id);
    if (!upload) return fail("未找到菜单上传记录", 404);
    const menu = sanitizeMenu(upload.menu);
    if (!validMenu(menu)) return fail("菜单信息不完整，无法发布");
    const now = new Date().toISOString();
    state.menus.current = menu;
    ensureMenuDishes(state.menus.dictionary, menu, true);
    addCorrectionAliases(state.menus.dictionary, upload.source_menu, menu);
    state.menus.version = { label: nextVersion(state.menus.version?.label), updated_at: now, remark: `来自 ${upload.filename}` };
    upload.status = "published";
    upload.published_at = now;
    await writeState(state);
    return json({ ok: true, version: state.menus.version });
  }

  if (path.startsWith("/api/admin/courses/") && request.method === "PATCH") {
    const courseId = decodeURIComponent(path.slice("/api/admin/courses/".length));
    const body = await bodyJson(request);
    const state = await readState();
    const major = majorKey(body.major);
    const majorData = state.majors[major];
    const index = majorData.courses.findIndex((item) => item.id === courseId);
    if (index < 0) return fail("未找到已发布课程", 404);
    const course = sanitizeCourse(body.course, courseId);
    course.id = courseId;
    if (!validCourse(course)) return fail("日期、星期、时段、时间和课程名称为必填项");
    majorData.courses[index] = course;
    majorData.courses.sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
    markCourseUpdate(majorData, `管理员调整课程：${course.course_name}`);
    await writeState(state);
    return json({ course, version: majorData.version });
  }

  if (path.startsWith("/api/admin/courses/") && request.method === "DELETE") {
    const courseId = decodeURIComponent(path.slice("/api/admin/courses/".length));
    const state = await readState();
    const major = majorKey(url.searchParams.get("major"));
    const majorData = state.majors[major];
    const course = majorData.courses.find((item) => item.id === courseId);
    if (!course) return fail("未找到已发布课程", 404);
    majorData.courses = majorData.courses.filter((item) => item.id !== courseId);
    markCourseUpdate(majorData, `管理员删除课程：${course.course_name}`);
    await writeState(state);
    return json({ ok: true, version: majorData.version });
  }

  if (path === "/api/admin/uploads" && request.method === "GET") {
    const state = await readState();
    const major = majorKey(url.searchParams.get("major"));
    return json({ major, uploads: state.uploads.filter((upload) => upload.major === major) });
  }

  if (path === "/api/admin/uploads" && request.method === "POST") {
    const body = await bodyJson(request);
    if (!Array.isArray(body.courses) || !body.courses.length || body.courses.length > 1000) return fail("课程数据为空或数量异常");
    const drafts = body.courses.map((item) => sanitizeCourse(item)).filter(validCourse);
    if (!drafts.length) return fail("课程字段不完整，无法加入审核列表");
    const upload = {
      id: randomUUID(), filename: text(body.filename, 220) || "课程总表.pdf",
      uploaded_at: new Date().toISOString(), status: "review",
      major: majorKey(body.major),
      warnings: Array.isArray(body.warnings) ? body.warnings.slice(0, 50).map((item) => text(item, 300)) : [],
      drafts,
    };
    const state = await readState();
    state.uploads = [upload, ...(state.uploads || [])].slice(0, 30);
    await writeState(state);
    return json({ upload }, 201);
  }

  if (path === "/api/admin/uploads" && request.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return fail("缺少文件记录 ID");
    const state = await readState();
    const before = state.uploads?.length || 0;
    state.uploads = (state.uploads || []).filter((item) => item.id !== id);
    if (state.uploads.length === before) return fail("未找到上传记录", 404);
    await writeState(state);
    return json({ ok: true });
  }

  if (path.startsWith("/api/admin/drafts/") && request.method === "PATCH") {
    const courseId = decodeURIComponent(path.slice("/api/admin/drafts/".length));
    const body = await bodyJson(request);
    const state = await readState();
    const upload = (state.uploads || []).find((item) => item.id === body.upload_id);
    if (!upload) return fail("未找到上传记录", 404);
    const index = upload.drafts.findIndex((item) => item.id === courseId);
    if (index < 0) return fail("未找到课程", 404);
    const course = sanitizeCourse(body.course, courseId); course.id = courseId;
    if (!validCourse(course)) return fail("日期、时段、时间和课程名称为必填项");
    upload.drafts[index] = course; upload.status = "review";
    await writeState(state);
    return json({ course });
  }

  if (path.startsWith("/api/admin/drafts/") && request.method === "DELETE") {
    const courseId = decodeURIComponent(path.slice("/api/admin/drafts/".length));
    const uploadId = url.searchParams.get("upload_id");
    const state = await readState();
    const upload = (state.uploads || []).find((item) => item.id === uploadId);
    if (!upload) return fail("未找到上传记录", 404);
    upload.drafts = upload.drafts.filter((item) => item.id !== courseId); upload.status = "review";
    await writeState(state);
    return json({ ok: true });
  }

  if (path === "/api/admin/publish" && request.method === "POST") {
    const body = await bodyJson(request);
    const state = await readState();
    const upload = (state.uploads || []).find((item) => item.id === body.upload_id);
    if (!upload) return fail("未找到上传记录", 404);
    if (!upload.drafts?.length) return fail("没有可发布的课程");
    const courses = upload.drafts.map((item) => sanitizeCourse(item)).filter(validCourse)
      .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
    const now = new Date().toISOString();
    const major = majorKey(upload.major);
    const majorData = state.majors[major];
    majorData.courses = courses;
    majorData.version = { label: nextVersion(majorData.version?.label), updated_at: now, remark: `来自 ${upload.filename}` };
    upload.status = "published"; upload.published_at = now;
    await writeState(state);
    return json({ ok: true, major, version: majorData.version, course_count: courses.length });
  }
  return fail("管理员接口不存在", 404);
}

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (path === "/api/analytics/visit" && request.method === "POST") return await recordAnonymousVisit(request);
    if ((path === "/api/live-courses" || path.startsWith("/api/live-courses/") || path === "/api/courses") && request.method === "GET") {
      const state = await readState();
      const pathMajor = path.startsWith("/api/live-courses/") ? decodeURIComponent(path.slice("/api/live-courses/".length)) : null;
      const major = majorKey(pathMajor || url.searchParams.get("major"));
      return json({ major, courses: state.majors[major].courses, version: state.majors[major].version }, 200, { "Cache-Control": "no-store, no-cache, must-revalidate" });
    }
    if (path === "/api/live-menu" && request.method === "GET") {
      const state = await readState();
      return json({ menu: state.menus.current ? sanitizeMenu(state.menus.current) : null, version: state.menus.version }, 200, { "Cache-Control": "no-store, no-cache, must-revalidate" });
    }
    if (path.startsWith("/api/admin/")) return await adminRoutes(request, url, path);
    return fail("接口不存在", 404);
  } catch (error) {
    console.error("course-api", error);
    return fail(error?.message === "提交数据过大" ? error.message : "腾讯云课程服务暂时不可用，请稍后重试", error?.message === "提交数据过大" ? 413 : 500);
  }
}
