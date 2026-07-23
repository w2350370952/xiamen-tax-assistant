import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { getStore } from "@edgeone/pages-blob";

const store = getStore("xiamen-tax-assistant");
const STATE_KEY = "course-state.json";
const ANALYTICS_KEY = "anonymous-analytics-v1.json";
const MENU_RATINGS_KEY = "menu-ratings-v1.json";
const DEVICE_BEHAVIOR_KEY = "device-behavior-v1.json";
const NASDAQ100_KEY = "nasdaq100-data-v1.json";
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
const DINNER_SHARED_CATEGORIES = new Set(["热菜", "免费汤", "主食", "面档", "煎扒档"]);
const dictionaryMeal = (meal, category) => meal === "dinner" && DINNER_SHARED_CATEGORIES.has(category) ? "lunch" : meal;

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
      ratings: sanitizeMenuRatings(state.menus?.ratings),
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

async function readMenuRatings(fallback = {}) {
  const stored = await store.get(MENU_RATINGS_KEY, { type: "json", consistency: "strong" });
  return sanitizeMenuRatings(stored || fallback);
}

async function writeMenuRatings(ratings) {
  await store.setJSON(MENU_RATINGS_KEY, ratings, { cacheControl: "no-store" });
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

function beijingDateOf(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
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

function browserName(request) {
  const ua = request.headers.get("user-agent") || "";
  if (/MicroMessenger/i.test(ua)) return "微信浏览器";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/CriOS\/|Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return "其他";
}

function deviceIdentity(request) {
  const ua = request.headers.get("user-agent") || "";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return { device_name: "iPad", device_type: "平板" };
  if (/iPhone/i.test(ua)) return { device_name: "iPhone", device_type: "手机" };
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return { device_name: "Android 手机", device_type: "手机" };
  if (/Android/i.test(ua)) return { device_name: "Android 平板", device_type: "平板" };
  if (/Windows/i.test(ua)) return { device_name: "Windows 电脑", device_type: "电脑" };
  if (/Macintosh|Mac OS X/i.test(ua)) return { device_name: "Mac", device_type: "电脑" };
  return { device_name: "未知设备", device_type: "其他" };
}

function normalizeDeviceBehavior(raw) {
  const source = raw || {};
  const devices = {};
  for (const item of Object.values(source.devices && typeof source.devices === "object" ? source.devices : {}).slice(0, 2000)) {
    const deviceId = text(item?.device_id, 24);
    if (!/^D[A-F0-9]{10}$/.test(deviceId)) continue;
    devices[deviceId] = {
      device_id: deviceId,
      device_name: text(item.device_name, 40) || "未知设备",
      device_type: text(item.device_type, 20) || "其他",
      system: text(item.system, 30) || "其他",
      browser: text(item.browser, 30) || "其他",
      screen_size: text(item.screen_size, 30),
      first_visit_time: text(item.first_visit_time, 30),
      last_visit_time: text(item.last_visit_time, 30),
      visit_count: Math.max(0, Number(item.visit_count) || 0),
      remark: text(item.remark, 200),
    };
  }
  const logs = (Array.isArray(source.logs) ? source.logs : []).slice(0, 15000).map((item) => ({
    id: text(item.id, 60) || randomUUID(),
    device_id: text(item.device_id, 24),
    action_type: text(item.action_type, 30),
    page_name: text(item.page_name, 40),
    action_detail: text(item.action_detail, 180),
    create_time: text(item.create_time, 30),
  })).filter((item) => devices[item.device_id] && item.action_type && item.page_name && item.create_time);
  return { devices, logs };
}

async function readDeviceBehavior() {
  return normalizeDeviceBehavior(await store.get(DEVICE_BEHAVIOR_KEY, { type: "json", consistency: "strong" }));
}

async function writeDeviceBehavior(data) {
  await store.setJSON(DEVICE_BEHAVIOR_KEY, data, { cacheControl: "no-store" });
}

function publicDeviceId(clientId) {
  return `D${sha256(`xnai-device:${clientId}`).slice(0, 10).toUpperCase()}`;
}

function ensureDevice(data, request, body, countVisit = false) {
  const clientId = text(body.visitor_id, 100);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(clientId)) return null;
  const deviceId = publicDeviceId(clientId);
  const now = new Date().toISOString();
  const identity = deviceIdentity(request);
  const screenSize = /^\d{2,5}x\d{2,5}$/.test(text(body.screen_size, 30)) ? text(body.screen_size, 30) : "";
  const existing = data.devices[deviceId];
  data.devices[deviceId] = {
    device_id: deviceId,
    device_name: identity.device_name,
    device_type: identity.device_type,
    system: devicePlatform(request),
    browser: browserName(request),
    screen_size: screenSize || existing?.screen_size || "",
    first_visit_time: existing?.first_visit_time || now,
    last_visit_time: now,
    visit_count: Math.max(0, Number(existing?.visit_count) || 0) + (countVisit ? 1 : 0),
    remark: existing?.remark || "",
  };
  return data.devices[deviceId];
}

function trimBehaviorLogs(data) {
  const keepFrom = new Date(Date.now() - 90 * 86400000).toISOString();
  data.logs = data.logs.filter((item) => item.create_time >= keepFrom && data.devices[item.device_id]).slice(0, 15000);
  return data;
}

const uniquePush = (list, value) => { if (!list.includes(value)) list.push(value); };
function normalizeAnalytics(raw) { return { days: raw?.days && typeof raw.days === "object" ? raw.days : {} }; }
async function readAnalytics() { return normalizeAnalytics(await store.get(ANALYTICS_KEY, { type: "json", consistency: "strong" })); }
async function writeAnalytics(data) { await store.setJSON(ANALYTICS_KEY, data, { cacheControl: "no-store" }); }

async function recordDeviceVisit(request, body) {
  const data = await readDeviceBehavior();
  const device = ensureDevice(data, request, body, true);
  if (!device) return null;
  data.logs.unshift({
    id: randomUUID(),
    device_id: device.device_id,
    action_type: "访问",
    page_name: text(body.page_name, 40) || "首页",
    action_detail: "打开网站",
    create_time: new Date().toISOString(),
  });
  trimBehaviorLogs(data);
  await writeDeviceBehavior(data);
  return device;
}

async function recordUserAction(request) {
  const ua = request.headers.get("user-agent") || "";
  if (/bot|spider|crawler|headless|preview/i.test(ua)) return json({ ok: true, ignored: true }, 202);
  const body = await bodyJson(request);
  const actionType = text(body.action_type, 30);
  const pageName = text(body.page_name, 40);
  if (!actionType || !pageName) return fail("行为记录信息不完整");
  const data = await readDeviceBehavior();
  const device = ensureDevice(data, request, body, false);
  if (!device) return fail("匿名设备标识无效");
  data.logs.unshift({
    id: randomUUID(),
    device_id: device.device_id,
    action_type: actionType,
    page_name: pageName,
    action_detail: text(body.action_detail, 180),
    create_time: new Date().toISOString(),
  });
  trimBehaviorLogs(data);
  await writeDeviceBehavior(data);
  return json({ ok: true, device_id: device.device_id }, 202);
}

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
  const device = await recordDeviceVisit(request, body);
  return json({ ok: true, device_id: device?.device_id || null }, 202);
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

function behaviorDashboard(data, url) {
  const requested = Number(url.searchParams.get("days"));
  const range = [7, 30, 90].includes(requested) ? requested : 7;
  const today = beijingDateHour().date;
  const startDate = analyticsDateOffset(today, 1 - range);
  const weekStart = analyticsDateOffset(today, -6);
  const logs = data.logs.filter((item) => beijingDateOf(item.create_time) >= startDate);
  const pageCounts = {}, actionCounts = {};
  for (const log of logs) {
    pageCounts[log.page_name] = (pageCounts[log.page_name] || 0) + 1;
    actionCounts[log.action_type] = (actionCounts[log.action_type] || 0) + 1;
  }
  const ranking = (source) => Object.entries(source).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN")).slice(0, 10);
  const daily = Array.from({ length: range }, (_, index) => analyticsDateOffset(today, index - range + 1)).map((date) => {
    const dayLogs = logs.filter((item) => beijingDateOf(item.create_time) === date);
    return { date, actions: dayLogs.length, devices: new Set(dayLogs.map((item) => item.device_id)).size };
  });
  const devices = Object.values(data.devices);
  return {
    range,
    summary: {
      total_devices: devices.length,
      today_active: devices.filter((item) => beijingDateOf(item.last_visit_time) === today).length,
      week_active: devices.filter((item) => beijingDateOf(item.last_visit_time) >= weekStart).length,
      range_actions: logs.length,
    },
    page_ranking: ranking(pageCounts),
    action_ranking: ranking(actionCounts),
    daily,
  };
}

function deviceDetails(data, deviceId) {
  const device = data.devices[deviceId];
  if (!device) return null;
  const logs = data.logs.filter((item) => item.device_id === deviceId);
  const pageCounts = {}, actionCounts = {};
  for (const log of logs) {
    pageCounts[log.page_name] = (pageCounts[log.page_name] || 0) + 1;
    actionCounts[log.action_type] = (actionCounts[log.action_type] || 0) + 1;
  }
  const topName = (source) => Object.entries(source).sort((a, b) => b[1] - a[1])[0]?.[0] || "暂无";
  return {
    device,
    statistics: {
      action_count: logs.length,
      favorite_page: topName(pageCounts),
      favorite_action: topName(actionCounts),
    },
    logs: logs.slice(0, 500),
  };
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
const finiteNumber = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value ?? "").replace(/[,%$]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

// ==================== 市场数据系统（纳斯达克100 + 上证指数） ====================
const MARKET_KEY = "market-data-v3.json";
const MARKET_HISTORY_LIMIT = 2600;
const LONG_RUN_PE = 24.25;
const FINANCE_TONES = ["low", "fair", "elevated", "high", "deep"];

const DEFAULT_FINANCE_SETTINGS = {
  valuation_bands: [
    { max: 20, label: "低估", icon: "🟢", tone: "low", advice: "估值处于低位，保持定投的同时可关注分批布局机会。" },
    { max: 30, label: "合理", icon: "🟡", tone: "fair", advice: "估值处于合理区间，保持正常定投节奏。" },
    { max: 40, label: "偏高估", icon: "🟠", tone: "elevated", advice: "估值偏高，保持正常定投，不建议一次性大额买入。" },
    { max: null, label: "高估", icon: "🔴", tone: "high", advice: "估值处于高位，建议控制投入节奏，保留现金应对波动。" },
  ],
  strategy_zones: [
    { min: 29000, max: null, state: "估值偏高", advice: "正常定投，不建议大额买入", tone: "elevated" },
    { min: 27000, max: 29000, state: "正常调整", advice: "增加20%定投", tone: "fair" },
    { min: 25000, max: 27000, state: "机会区域", advice: "增加50%定投", tone: "low" },
    { min: 22000, max: 25000, state: "明显低估", advice: "分批增加仓位", tone: "low" },
    { min: null, max: 22000, state: "历史极端机会", advice: "考虑大额买入", tone: "deep" },
  ],
  manual_pe: null,
};

function sanitizeValuationBands(raw) {
  const source = Array.isArray(raw) && raw.length ? raw : DEFAULT_FINANCE_SETTINGS.valuation_bands;
  const bands = source.slice(0, 6).map((band, index) => {
    const fallback = DEFAULT_FINANCE_SETTINGS.valuation_bands[Math.min(index, DEFAULT_FINANCE_SETTINGS.valuation_bands.length - 1)];
    const max = band?.max === null || band?.max === "" || band?.max === undefined ? null : finiteNumber(band.max);
    return {
      max: max !== null && max > 0 ? max : null,
      label: text(band?.label, 8) || fallback.label,
      icon: text(band?.icon, 4) || fallback.icon,
      tone: FINANCE_TONES.includes(band?.tone) ? band.tone : fallback.tone,
      advice: text(band?.advice, 80) || fallback.advice,
    };
  }).filter((band) => band.label);
  if (bands.length < 2) return DEFAULT_FINANCE_SETTINGS.valuation_bands;
  return bands.sort((a, b) => (a.max ?? Infinity) - (b.max ?? Infinity));
}

function sanitizeStrategyZones(raw) {
  const source = Array.isArray(raw) && raw.length ? raw : DEFAULT_FINANCE_SETTINGS.strategy_zones;
  const zones = source.slice(0, 8).map((zone, index) => {
    const fallback = DEFAULT_FINANCE_SETTINGS.strategy_zones[Math.min(index, DEFAULT_FINANCE_SETTINGS.strategy_zones.length - 1)];
    const min = zone?.min === null || zone?.min === "" || zone?.min === undefined ? null : finiteNumber(zone.min);
    const max = zone?.max === null || zone?.max === "" || zone?.max === undefined ? null : finiteNumber(zone.max);
    return {
      min: min !== null && min >= 0 ? min : null,
      max: max !== null && max > 0 ? max : null,
      state: text(zone?.state, 12) || fallback.state,
      advice: text(zone?.advice, 60) || fallback.advice,
      tone: FINANCE_TONES.includes(zone?.tone) ? zone.tone : fallback.tone,
    };
  }).filter((zone) => zone.state && (zone.min !== null || zone.max !== null));
  if (zones.length < 2) return DEFAULT_FINANCE_SETTINGS.strategy_zones;
  return zones.sort((a, b) => (b.max ?? Infinity) - (a.max ?? Infinity) || (b.min ?? -Infinity) - (a.min ?? -Infinity));
}

function sanitizeFinanceSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const manualValue = finiteNumber(source.manual_pe?.value ?? source.manual_pe);
  return {
    valuation_bands: sanitizeValuationBands(source.valuation_bands),
    strategy_zones: sanitizeStrategyZones(source.strategy_zones),
    manual_pe: manualValue !== null && manualValue > 0 && manualValue < 500
      ? { value: manualValue, note: text(source.manual_pe?.note, 60), update_time: text(source.manual_pe?.update_time, 30) || new Date().toISOString() }
      : null,
  };
}

// 财经参数固定使用内置默认值，无需管理员维护，外部数据自动驱动
async function readFinanceSettings() {
  return sanitizeFinanceSettings(null);
}

function normalizeMarketRows(rows, limit = MARKET_HISTORY_LIMIT) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = text(Array.isArray(row) ? row[0] : row?.date, 10);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) continue;
    const open = finiteNumber(Array.isArray(row) ? row[1] : row?.open);
    const high = finiteNumber(Array.isArray(row) ? row[2] : row?.high);
    const low = finiteNumber(Array.isArray(row) ? row[3] : row?.low);
    const close = finiteNumber(Array.isArray(row) ? row[4] : (Array.isArray(row) ? undefined : row?.close ?? row?.price));
    if (close === null) continue;
    byDate.set(date, [date, open ?? close, high ?? close, low ?? close, close]);
  }
  return [...byDate.values()].sort((a, b) => a[0].localeCompare(b[0])).slice(-limit);
}

function normalizePeSamples(raw) {
  const byDate = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    const date = text(Array.isArray(item) ? item[0] : item?.date, 10);
    const pe = finiteNumber(Array.isArray(item) ? item[1] : item?.pe);
    const kind = ["real", "manual", "estimated"].includes(Array.isArray(item) ? item[2] : item?.kind) ? (Array.isArray(item) ? item[2] : item.kind) : "estimated";
    if (/^20\d{2}-\d{2}-\d{2}$/.test(date) && pe !== null && pe > 0 && pe < 500) byDate.set(date, [pe, kind]);
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-400);
}

function normalizeMarket(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const ndxSource = source.ndx && typeof source.ndx === "object" ? source.ndx : {};
  const shSource = source.shanghai && typeof source.shanghai === "object" ? source.shanghai : null;
  const anchor = source.earnings_anchor && typeof source.earnings_anchor === "object" ? source.earnings_anchor : null;
  const pe = source.pe && typeof source.pe === "object" ? source.pe : {};
  return {
    ndx: {
      price: finiteNumber(ndxSource.price),
      change_percent: finiteNumber(ndxSource.change_percent),
      quote_date: text(ndxSource.quote_date, 10),
      source: text(ndxSource.source, 80),
      update_time: text(ndxSource.update_time, 30),
      history: normalizeMarketRows(ndxSource.history),
    },
    csi300: source.csi300 && typeof source.csi300 === "object" ? {
      price: finiteNumber(source.csi300.price),
      change_percent: finiteNumber(source.csi300.change_percent),
      quote_date: text(source.csi300.quote_date, 10),
      source: text(source.csi300.source, 80),
      update_time: text(source.csi300.update_time, 30),
      history: normalizeMarketRows(source.csi300.history),
    } : null,
    shanghai: shSource ? {
      price: finiteNumber(shSource.price),
      change_percent: finiteNumber(shSource.change_percent),
      quote_date: text(shSource.quote_date, 10),
      source: text(shSource.source, 80),
      update_time: text(shSource.update_time, 30),
      history: normalizeMarketRows(shSource.history),
    } : null,
    pe: {
      value: finiteNumber(pe.value) > 0 ? finiteNumber(pe.value) : null,
      kind: ["real", "manual", "estimated"].includes(pe.kind) ? pe.kind : null,
      label: text(pe.label, 120),
    },
    earnings_anchor: anchor && finiteNumber(anchor.pe) > 0 && finiteNumber(anchor.price) > 0
      ? { price: finiteNumber(anchor.price), pe: finiteNumber(anchor.pe), time: text(anchor.time, 30), source: text(anchor.source, 20) }
      : null,
    pe_samples: normalizePeSamples(source.pe_samples),
    last_error: text(source.last_error, 240),
  };
}

let marketMemCache = { time: 0, data: null };

async function readMarket() {
  if (marketMemCache.data && Date.now() - marketMemCache.time < 30000) return marketMemCache.data;
  let stored = await store.get(MARKET_KEY, { type: "json", consistency: "strong" });
  if (!stored) {
    // 首次升级：从旧版纳斯达克100缓存迁移已有历史数据
    const legacy = await store.get(NASDAQ100_KEY, { type: "json", consistency: "strong" });
    if (legacy && Array.isArray(legacy.history) && legacy.history.length) {
      const peSamples = legacy.history.filter((item) => finiteNumber(item.pe_ratio) > 0).map((item) => [item.date, item.pe_ratio]);
      stored = {
        ndx: {
          price: finiteNumber(legacy.price),
          change_percent: finiteNumber(legacy.change_percent),
          quote_date: legacy.history.at(-1)?.date || "",
          source: text(legacy.source, 80),
          update_time: text(legacy.update_time, 30),
          history: legacy.history.map((item) => [item.date, item.price, item.price, item.price, item.price]),
        },
        pe_samples: peSamples,
      };
    }
  }
  const normalized = normalizeMarket(stored);
  marketMemCache = { time: Date.now(), data: normalized };
  return normalized;
}

async function writeMarket(data) {
  marketMemCache = { time: 0, data: null };
  await store.setJSON(MARKET_KEY, normalizeMarket(data), { cacheControl: "no-store" });
}

function newYorkMarketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (["Sat", "Sun"].includes(map.weekday)) return false;
  const minute = Number(map.hour) * 60 + Number(map.minute);
  return minute >= 570 && minute <= 960;
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json", "User-Agent": "xnaitax-finance/2.0" } });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(`行情源返回 HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function twelveData(endpoint, parameters) {
  const apiKey = text(process.env.TWELVE_DATA_API_KEY, 200);
  if (!apiKey) throw new Error("Twelve Data API Key 尚未配置");
  const query = new URLSearchParams({ ...parameters, apikey: apiKey });
  const data = await fetchJson(`https://api.twelvedata.com/${endpoint}?${query}`);
  if (data.status === "error" || data.code) throw new Error(text(data.message, 180) || "Twelve Data 请求失败");
  return data;
}

function findTrailingPe(data) {
  const candidates = [
    data?.statistics?.valuations_metrics?.trailing_pe,
    data?.valuations_metrics?.trailing_pe,
    data?.statistics?.valuation_metrics?.trailing_pe,
    data?.valuation_metrics?.trailing_pe,
    data?.trailing_pe,
  ];
  return candidates.map(finiteNumber).find((value) => value !== null) ?? null;
}

async function fetchTwelveNdxOhlc() {
  const [quote, series, statistics] = await Promise.all([
    twelveData("quote", { symbol: "NDX" }),
    twelveData("time_series", { symbol: "NDX", interval: "1day", outputsize: "2500", order: "ASC" }),
    twelveData("statistics", { symbol: "QQQ" }).catch(() => null),
  ]);
  const returnedSymbol = text(quote.symbol || series.meta?.symbol, 20);
  if (returnedSymbol && returnedSymbol !== "NDX") throw new Error(`标的校验失败：请求 NDX，返回 ${returnedSymbol}`);
  const values = Array.isArray(series.values) ? series.values : [];
  if (!values.length) throw new Error("Twelve Data 未返回纳斯达克100历史行情");
  const rows = values.map((item) => [
    text(item.datetime, 10),
    finiteNumber(item.open),
    finiteNumber(item.high),
    finiteNumber(item.low),
    finiteNumber(item.close),
  ]).filter((row) => row[4] !== null);
  const price = finiteNumber(quote.close) ?? rows.at(-1)?.[4] ?? null;
  const change = finiteNumber(quote.percent_change) ?? (rows.length > 1 ? (rows.at(-1)[4] / rows.at(-2)[4] - 1) * 100 : null);
  if (price === null) throw new Error("Twelve Data 未返回有效点位");
  const pe = findTrailingPe(statistics);
  return {
    price, change, rows,
    quote_date: text(quote.datetime, 10) || rows.at(-1)?.[0],
    source: "Twelve Data",
    pe: pe !== null && pe > 0 ? { value: pe, label: "Invesco QQQ 跟踪基金 Trailing PE（Twelve Data 实时数据）" } : null,
  };
}

async function fetchEastmoneyOhlc(secid, expectedName) {
  const beg = `${new Date().getUTCFullYear() - 10}0101`;
  const data = await fetchJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55&klt=101&fqt=0&beg=${beg}&end=20500131`);
  const returnedName = text(data?.data?.name, 30);
  if (expectedName && returnedName && !returnedName.includes(expectedName)) throw new Error(`标的校验失败：要求${expectedName}，返回${returnedName}`);
  const klines = data?.data?.klines;
  if (!Array.isArray(klines) || !klines.length) throw new Error("东方财富未返回历史行情");
  const rows = klines.map((line) => {
    const [date, open, close, high, low] = String(line).split(",");
    return [text(date, 10), finiteNumber(open), finiteNumber(high), finiteNumber(low), finiteNumber(close)];
  }).filter((row) => /^20\d{2}-\d{2}-\d{2}$/.test(row[0]) && row[4] !== null);
  if (!rows.length) throw new Error("东方财富历史行情格式异常");
  const last = rows.at(-1);
  const previous = rows.at(-2);
  return {
    price: last[4],
    change: previous ? (last[4] / previous[4] - 1) * 100 : null,
    rows,
    quote_date: last[0],
    source: "东方财富",
    pe: null,
  };
}

async function fetchYahooOhlc(symbol, range = "10y") {
  const encoded = encodeURIComponent(symbol);
  let lastError = null;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const data = await fetchJson(`https://${host}/v8/finance/chart/${encoded}?range=${range}&interval=1d&events=history`);
      const result = data?.chart?.result?.[0];
      const returnedSymbol = text(result?.meta?.symbol, 20);
      if (returnedSymbol && returnedSymbol !== symbol) throw new Error(`标的校验失败：请求 ${symbol}，返回 ${returnedSymbol}`);
      const timestamps = result?.timestamp || [];
      const quote = result?.indicators?.quote?.[0] || {};
      const rows = timestamps.map((timestamp, index) => [
        new Date(timestamp * 1000).toISOString().slice(0, 10),
        finiteNumber(quote.open?.[index]),
        finiteNumber(quote.high?.[index]),
        finiteNumber(quote.low?.[index]),
        finiteNumber(quote.close?.[index]),
      ]).filter((row) => row[4] !== null);
      if (!rows.length) throw new Error("行情源未返回历史数据");
      const price = finiteNumber(result?.meta?.regularMarketPrice) ?? rows.at(-1)[4];
      const quoteDate = result?.meta?.regularMarketTime ? new Date(result.meta.regularMarketTime * 1000).toISOString().slice(0, 10) : rows.at(-1)[0];
      const lastIndex = rows.at(-1)[0] === quoteDate ? rows.length - 2 : rows.length - 1;
      const previous = rows[lastIndex]?.[4] ?? null;
      return { price, change: previous ? (price / previous - 1) * 100 : null, rows, quote_date: quoteDate, source: "Yahoo Finance", pe: null };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("行情源请求失败");
}

function mergeMarketRows(existing, fetched, snapshot) {
  const byDate = new Map((Array.isArray(existing) ? existing : []).map((row) => [row[0], row]));
  for (const row of Array.isArray(fetched) ? fetched : []) {
    if (Array.isArray(row) && row[4] !== null) byDate.set(row[0], row);
  }
  if (snapshot?.quote_date && finiteNumber(snapshot.price) !== null) {
    const close = finiteNumber(snapshot.price);
    const old = byDate.get(snapshot.quote_date);
    byDate.set(snapshot.quote_date, [
      snapshot.quote_date,
      old ? old[1] : close,
      old ? Math.max(old[2], close) : close,
      old ? Math.min(old[3], close) : close,
      close,
    ]);
  }
  return normalizeMarketRows([...byDate.values()]);
}

function pushPeSample(market, pe, kind = "estimated") {
  const date = (market.ndx.quote_date || new Date().toISOString()).slice(0, 10);
  market.pe_samples = normalizePeSamples([...(market.pe_samples || []), [date, pe, kind]]);
}

function resolveMarketPe(market, settings, realPe) {
  const now = new Date().toISOString();
  const price = market.ndx.price;
  if (realPe?.value > 0) {
    market.earnings_anchor = { price, pe: realPe.value, time: now, source: "real" };
    pushPeSample(market, realPe.value, "real");
    return { value: realPe.value, kind: "real", label: realPe.label || "实时 Trailing PE" };
  }
  const manual = settings.manual_pe;
  if (manual?.value > 0) {
    market.earnings_anchor = { price, pe: manual.value, time: now, source: "manual" };
    pushPeSample(market, manual.value, "manual");
    return { value: manual.value, kind: "manual", label: `管理员手动录入${manual.note ? `（${manual.note}）` : ""}` };
  }
  const anchor = market.earnings_anchor;
  if (anchor?.pe > 0 && anchor.price > 0 && price > 0) {
    const earnings = anchor.price / anchor.pe;
    const value = price / earnings;
    pushPeSample(market, value, "estimated");
    return { value, kind: "estimated", label: "模型估算 Trailing PE（基于最近一次实测估值锚定）" };
  }
  const rows = (market.ndx.history || []).slice(-250);
  if (rows.length > 20 && price > 0) {
    const avgPrice = rows.reduce((sum, row) => sum + row[4], 0) / rows.length;
    const earnings = avgPrice / LONG_RUN_PE;
    const value = price / earnings;
    pushPeSample(market, value, "estimated");
    return { value, kind: "estimated", label: "模型估算 Trailing PE（历史均值锚定，非实时数据）" };
  }
  return { value: null, kind: null, label: "估值数据待更新" };
}

async function refreshMarket(cached, settings) {
  // 45秒内的重复刷新请求直接返回缓存，避免频繁请求外部行情接口
  const lastUpdate = Date.parse(cached?.ndx?.update_time || 0);
  if (cached?.ndx?.price && Date.now() - lastUpdate < 45000) return normalizeMarket(cached);
  const errors = [];
  let ndxSnapshot = null;
  let realPe = null;
  const ndxSources = [];
  if (text(process.env.TWELVE_DATA_API_KEY, 200)) ndxSources.push(["Twelve Data", fetchTwelveNdxOhlc]);
  ndxSources.push(["Yahoo Finance", () => fetchYahooOhlc("^NDX")], ["东方财富", () => fetchEastmoneyOhlc("100.NDX", "纳斯达克100")]);
  const cachedNdxPrice = cached?.ndx?.price;
  for (const [name, fetcher] of ndxSources) {
    try {
      const snapshot = await fetcher();
      // 偏差守卫：与缓存点位偏差超8%视为口径异常，拒绝该源并切换下一个
      if (cachedNdxPrice && snapshot?.price && Math.abs(snapshot.price / cachedNdxPrice - 1) > 0.08) {
        errors.push(`${name}：数据偏差异常，已自动切换`);
        continue;
      }
      ndxSnapshot = snapshot;
      if (ndxSnapshot?.pe) realPe = ndxSnapshot.pe;
      break;
    } catch (error) {
      errors.push(`${name}：${text(error?.message, 120)}`);
    }
  }
  if (!ndxSnapshot) throw new Error(`纳斯达克100行情源全部不可用（${errors.join("；")}）`);
  let shSnapshot = null;
  const cachedShPrice = cached?.shanghai?.price;
  for (const [name, fetcher] of [["东方财富", () => fetchEastmoneyOhlc("1.000001", "上证指数")], ["Yahoo Finance", () => fetchYahooOhlc("000001.SS")]]) {
    try {
      const snapshot = await fetcher();
      if (cachedShPrice && snapshot?.price && Math.abs(snapshot.price / cachedShPrice - 1) > 0.08) {
        errors.push(`上证指数/${name}：数据偏差异常，已自动切换`);
        continue;
      }
      shSnapshot = snapshot;
      break;
    } catch (error) {
      errors.push(`上证指数/${name}：${text(error?.message, 120)}`);
    }
  }
  let csiSnapshot = null;
  const cachedCsiPrice = cached?.csi300?.price;
  for (const [name, fetcher] of [["东方财富", () => fetchEastmoneyOhlc("1.000300", "沪深300")], ["Yahoo Finance", () => fetchYahooOhlc("000300.SS")]]) {
    try {
      const snapshot = await fetcher();
      if (cachedCsiPrice && snapshot?.price && Math.abs(snapshot.price / cachedCsiPrice - 1) > 0.08) {
        errors.push(`沪深300/${name}：数据偏差异常，已自动切换`);
        continue;
      }
      csiSnapshot = snapshot;
      break;
    } catch (error) {
      errors.push(`沪深300/${name}：${text(error?.message, 120)}`);
    }
  }
  const now = new Date().toISOString();
  const next = {
    ...cached,
    ndx: {
      price: ndxSnapshot.price,
      change_percent: ndxSnapshot.change,
      quote_date: ndxSnapshot.quote_date,
      source: ndxSnapshot.source,
      update_time: now,
      history: mergeMarketRows(cached.ndx?.history, ndxSnapshot.rows, ndxSnapshot),
    },
    shanghai: shSnapshot ? {
      price: shSnapshot.price,
      change_percent: shSnapshot.change,
      quote_date: shSnapshot.quote_date,
      source: shSnapshot.source,
      update_time: now,
      history: mergeMarketRows(cached.shanghai?.history, shSnapshot.rows, shSnapshot),
    } : cached.shanghai || null,
    csi300: csiSnapshot ? {
      price: csiSnapshot.price,
      change_percent: csiSnapshot.change,
      quote_date: csiSnapshot.quote_date,
      source: csiSnapshot.source,
      update_time: now,
      history: mergeMarketRows(cached.csi300?.history, csiSnapshot.rows, csiSnapshot),
    } : cached.csi300 || null,
    pe_samples: cached.pe_samples || [],
    earnings_anchor: cached.earnings_anchor || null,
  };
  next.pe = resolveMarketPe(next, settings, realPe);
  next.last_error = errors.filter(Boolean).join("；");
  await writeMarket(next);
  return normalizeMarket(next);
}

const changeFromRows = (rows, days) => {
  const end = rows.at(-1);
  if (!end) return null;
  const cutoff = new Date(`${end[0]}T12:00:00Z`).getTime() - days * 86400000;
  const start = rows.find((row) => new Date(`${row[0]}T12:00:00Z`).getTime() >= cutoff) || rows[0];
  return start?.[4] ? (end[4] / start[4] - 1) * 100 : null;
};

const expandMarketRows = (rows) => (Array.isArray(rows) ? rows : []).map(([date, open, high, low, close]) => ({ date, open, high, low, close, price: close }));

function comparisonStats(rows) {
  if (!Array.isArray(rows) || rows.length < 200) return null;
  const window = rows.slice(-2600);
  const start = window[0][4];
  const end = window.at(-1)[4];
  if (!start || !end) return null;
  const years = (new Date(`${window.at(-1)[0]}T12:00:00Z`) - new Date(`${window[0][0]}T12:00:00Z`)) / (365.25 * 86400000);
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const row of window) {
    const close = row[4];
    if (close > peak) peak = close;
    const drawdown = (close / peak - 1) * 100;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }
  return {
    total: Math.round(((end / start - 1) * 100) * 10) / 10,
    annual: Math.round(((Math.pow(end / start, 1 / years) - 1) * 100) * 10) / 10,
    max_drawdown: Math.round(maxDrawdown * 10) / 10,
    years: Math.round(years * 10) / 10,
  };
}

function publicMarket(market, settings, stale = false, lite = false) {
  const fullRows = market.ndx.history || [];
  const rows = lite ? fullRows.slice(-400) : fullRows;
  const trim = (index) => index ? { ...index, history: lite ? (index.history || []).slice(-400) : index.history } : null;
  const shIndex = trim(market.shanghai);
  const csiIndex = trim(market.csi300);
  const sampleItems = Array.isArray(market.pe_samples) ? market.pe_samples : [];
  const samples = sampleItems.map((item) => (Array.isArray(item) ? item[1] : item?.pe)).filter((value) => value > 0);
  const realCount = sampleItems.filter((item) => (Array.isArray(item) ? item[2] : item?.kind) === "real").length;
  const peAverage = samples.length >= 5 ? Math.round((samples.reduce((sum, value) => sum + value, 0) / samples.length) * 10) / 10 : null;
  const pe = market.pe?.value ?? null;
  const pePercentile = samples.length >= 20 && pe !== null ? Math.round(samples.filter((value) => value <= pe).length / samples.length * 1000) / 10 : null;
  return {
    index_name: "NASDAQ-100 Index",
    symbol: "NDX",
    price: market.ndx.price,
    change: market.ndx.change_percent,
    history: expandMarketRows(rows),
    performance: {
      month_1: changeFromRows(rows, 31),
      month_3: changeFromRows(rows, 93),
      half_year: changeFromRows(rows, 186),
      year_1: changeFromRows(rows, 370),
    },
    pe,
    pe_kind: market.pe?.kind || null,
    pe_source: market.pe?.label || "",
    pe_average: peAverage,
    pe_percentile: pePercentile,
    pe_average_source: samples.length >= 5 ? `基于本站已积累的 ${samples.length} 天每日估值样本动态计算${realCount >= 30 ? "（以实测为主）" : "（含模型估算样本）"}` : "样本积累中，满5天后自动生成",
    update_time: market.ndx.update_time,
    source: market.ndx.source,
    stale,
    lite,
    comparison: {
      ndx: comparisonStats(fullRows),
      shanghai: comparisonStats(market.shanghai?.history),
      csi300: comparisonStats(market.csi300?.history),
    },
    shanghai: shIndex ? {
      price: shIndex.price,
      change: shIndex.change_percent,
      update_time: shIndex.update_time,
      history: expandMarketRows(shIndex.history),
    } : null,
    csi300: csiIndex ? {
      price: csiIndex.price,
      change: csiIndex.change_percent,
      update_time: csiIndex.update_time,
      history: expandMarketRows(csiIndex.history),
    } : null,
    settings: {
      valuation_bands: settings.valuation_bands,
      strategy_zones: settings.strategy_zones,
    },
  };
}

function marketJson(payload, request) {
  const body = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate", Vary: "Accept-Encoding" };
  const accept = request?.headers?.get?.("accept-encoding") || "";
  if (body.length > 20000 && accept.includes("gzip")) {
    headers["Content-Encoding"] = "gzip";
    return new Response(gzipSync(Buffer.from(body)), { status: 200, headers });
  }
  return new Response(body, { status: 200, headers });
}

async function nasdaq100Response(url, waitUntil, request) {
  const settings = await readFinanceSettings();
  let cached = await readMarket();
  const force = Boolean(url?.searchParams?.get("refresh"));
  const age = cached.ndx?.update_time ? Date.now() - new Date(cached.ndx.update_time).getTime() : Infinity;
  const needUpgrade = (cached.ndx?.history?.length || 0) < 1500 || !cached.shanghai || !cached.csi300;
  let due = age > (newYorkMarketOpen() ? 60000 : 30 * 60000);
  if (needUpgrade && age > 15 * 60000) due = true;
  // 有缓存且非手动强制：一律立即返回缓存，页面秒开；追新由定时任务执行（waitUntil 可用时顺便后台刷新）
  if (cached.ndx?.price && !force) {
    if (due && typeof waitUntil === "function") {
      waitUntil(refreshMarket(cached, settings).catch((error) => console.error("market-refresh-bg", error)));
    }
    return marketJson(publicMarket(cached, settings, age > 2 * 3600000, url?.searchParams?.get("lite") === "1"), request);
  }
  if (force || due || !cached.ndx?.price) {
    try {
      cached = await refreshMarket(cached, settings);
    } catch (error) {
      console.error("market-refresh", error);
      if (!cached.ndx?.price) return json({ detail: "行情暂时不可用，请稍后重试", update_time: cached.ndx?.update_time || null }, 503);
      return marketJson(publicMarket(cached, settings, true, url?.searchParams?.get("lite") === "1"), request);
    }
  }
  return marketJson(publicMarket(cached, settings, false, url?.searchParams?.get("lite") === "1"), request);
}
// ==================== 市场数据系统结束 ====================

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

function menuRatingKey(name, meal, category) {
  return `${dictionaryMeal(meal, category)}|${text(category, 30)}|${normalizedDishName(name)}`;
}

function sanitizeMenuRatings(raw) {
  const result = {};
  for (const source of Object.values(raw && typeof raw === "object" ? raw : {}).slice(0, 2000)) {
    const sourceMeal = ["breakfast", "lunch", "dinner"].includes(source?.meal) ? source.meal : "";
    const category = text(source?.category, 30), name = text(source?.name, 100);
    if (!name || !sourceMeal || !MENU_MEALS[sourceMeal]?.includes(category)) continue;
    const meal = dictionaryMeal(sourceMeal, category), voters = {};
    for (const [voter, vote] of Object.entries(source?.voters && typeof source.voters === "object" ? source.voters : {}).slice(0, 500)) if (["like", "dislike"].includes(vote)) voters[text(voter, 64)] = vote;
    const key = menuRatingKey(name, meal, category), existing = result[key];
    if (existing) Object.assign(existing.voters, voters);
    else result[key] = { name, meal, category, voters };
  }
  for (const rating of Object.values(result)) { const votes = Object.values(rating.voters); rating.likes = votes.filter((vote) => vote === "like").length; rating.dislikes = votes.filter((vote) => vote === "dislike").length; }
  return result;
}

function canonicalDish(dictionary, name, meal, category) {
  const normalized = normalizedDishName(name), storedMeal = dictionaryMeal(meal, category);
  return dictionary.find((entry) => entry.meal === storedMeal && entry.category === category && (normalizedDishName(entry.name) === normalized || (entry.aliases || []).some((alias) => normalizedDishName(alias) === normalized))) || null;
}

function publicRatingsForMenu(menu, dictionary, ratings) {
  const result = {};
  for (const day of menu?.days || []) for (const [meal, categories] of Object.entries(day.meals || {})) for (const [category, items] of Object.entries(categories || {})) for (const dish of items || []) {
    const canonical = canonicalDish(dictionary, dish, meal, category);
    const storedRating = ratings[menuRatingKey(canonical?.name || dish, meal, category)];
    const clientKey = menuRatingKey(dish, meal, category);
    result[clientKey] = { likes: storedRating?.likes || 0, dislikes: storedRating?.dislikes || 0 };
  }
  return result;
}

function sanitizeDishDictionary(raw, currentMenu = null) {
  const entries = [];
  for (const source of Array.isArray(raw) ? raw.slice(0, 1200) : []) {
    const sourceMeal = ["breakfast", "lunch", "dinner"].includes(source?.meal) ? source.meal : "lunch";
    const category = text(source?.category, 30);
    if (!MENU_MEALS[sourceMeal]?.includes(category)) continue;
    const entry = { name: text(source?.name, 100), meal: dictionaryMeal(sourceMeal, category), category, aliases: Array.isArray(source?.aliases) ? [...new Set(source.aliases.slice(0, 30).map((item) => text(item, 100)).filter(Boolean))] : [], uses: Math.max(1, Number(source?.uses) || 1), updated_at: text(source?.updated_at, 30) || null };
    if (!entry.name) continue;
    const existing = entries.find((item) => item.meal === entry.meal && item.category === entry.category && normalizedDishName(item.name) === normalizedDishName(entry.name));
    if (existing) { existing.uses = Math.min(9999, existing.uses + entry.uses); existing.aliases = [...new Set([...existing.aliases, ...entry.aliases])].slice(0, 30); if ((entry.updated_at || "") > (existing.updated_at || "")) existing.updated_at = entry.updated_at; }
    else entries.push(entry);
  }
  if (currentMenu) ensureMenuDishes(entries, sanitizeMenu(currentMenu), false);
  return entries.slice(0, 1200);
}

function dictionaryEntry(dictionary, name, meal, category) {
  const normalized = normalizedDishName(name);
  const storedMeal = dictionaryMeal(meal, category);
  return dictionary.find((entry) => entry.meal === storedMeal && entry.category === category && normalizedDishName(entry.name) === normalized);
}

function ensureMenuDishes(dictionary, menu, increaseUses = true) {
  for (const day of menu?.days || []) for (const [meal, categories] of Object.entries(day.meals || {})) for (const [category, items] of Object.entries(categories || {})) for (const rawName of items || []) {
    const name = text(rawName, 100); if (!name || /无法识别|看不清|未识别/.test(name)) continue;
    const existing = dictionaryEntry(dictionary, name, meal, category);
    if (existing) { if (increaseUses) existing.uses = Math.min(9999, existing.uses + 1); existing.updated_at = new Date().toISOString(); }
    else dictionary.push({ name, meal: dictionaryMeal(meal, category), category, aliases: [], uses: 1, updated_at: new Date().toISOString() });
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
      const storedMeal = dictionaryMeal(meal, category);
      const match = dictionary.find((entry) => entry.meal === storedMeal && entry.category === category && (normalizedDishName(entry.name) === normalized || entry.aliases.some((alias) => normalizedDishName(alias) === normalized)));
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

async function voteMenuDish(request) {
  const body = await bodyJson(request);
  const visitorId = text(body.visitor_id, 120), dish = text(body.dish, 100);
  const meal = ["breakfast", "lunch", "dinner"].includes(body.meal) ? body.meal : "";
  const category = text(body.category, 30), vote = ["like", "dislike"].includes(body.vote) ? body.vote : "";
  if (visitorId.length < 8 || !dish || !meal || !MENU_MEALS[meal]?.includes(category) || !vote) return fail("评价信息不完整");
  const state = await readState(), menu = state.menus.current ? sanitizeMenu(state.menus.current) : null;
  const exists = menu?.days?.some((day) => (day.meals?.[meal]?.[category] || []).some((item) => normalizedDishName(item) === normalizedDishName(dish)));
  if (!exists) return fail("当前已发布菜单中没有这道菜", 404);
  const ratings = await readMenuRatings(state.menus.ratings);
  const canonical = canonicalDish(state.menus.dictionary, dish, meal, category);
  const name = canonical?.name || dish, storedMeal = dictionaryMeal(meal, category), key = menuRatingKey(name, storedMeal, category);
  const rating = ratings[key] || { name, meal: storedMeal, category, voters: {}, likes: 0, dislikes: 0 };
  const voter = sha256(visitorId).slice(0, 32), previous = rating.voters[voter] || null;
  if (previous === vote) delete rating.voters[voter]; else rating.voters[voter] = vote;
  const votes = Object.values(rating.voters); rating.likes = votes.filter((item) => item === "like").length; rating.dislikes = votes.filter((item) => item === "dislike").length;
  ratings[key] = rating;
  await writeMenuRatings(ratings);
  return json({ key: menuRatingKey(dish, meal, category), rating: { likes: rating.likes, dislikes: rating.dislikes }, user_vote: previous === vote ? null : vote });
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
  if (path === "/api/admin/user-analytics" && request.method === "GET") {
    const data = await readDeviceBehavior();
    return json(behaviorDashboard(data, url));
  }
  if (path === "/api/admin/devices" && request.method === "GET") {
    const data = await readDeviceBehavior();
    const query = text(url.searchParams.get("query"), 80).toLowerCase();
    const devices = Object.values(data.devices)
      .filter((item) => !query || [item.device_id, item.device_name, item.device_type, item.system, item.browser, item.remark].some((value) => String(value || "").toLowerCase().includes(query)))
      .sort((a, b) => b.last_visit_time.localeCompare(a.last_visit_time));
    return json({ devices, total: devices.length });
  }
  if (path.startsWith("/api/admin/devices/")) {
    const deviceId = decodeURIComponent(path.slice("/api/admin/devices/".length)).toUpperCase();
    if (!/^D[A-F0-9]{10}$/.test(deviceId)) return fail("设备编号无效");
    if (request.method === "GET") {
      const details = deviceDetails(await readDeviceBehavior(), deviceId);
      return details ? json(details) : fail("未找到设备记录", 404);
    }
    if (request.method === "PATCH") {
      const body = await bodyJson(request);
      const data = await readDeviceBehavior();
      if (!data.devices[deviceId]) return fail("未找到设备记录", 404);
      data.devices[deviceId].remark = text(body.remark, 200);
      await writeDeviceBehavior(data);
      return json({ device: data.devices[deviceId] });
    }
    if (request.method === "DELETE") {
      const data = await readDeviceBehavior();
      if (!data.devices[deviceId]) return fail("未找到设备记录", 404);
      delete data.devices[deviceId];
      data.logs = data.logs.filter((item) => item.device_id !== deviceId);
      await writeDeviceBehavior(data);
      return json({ ok: true });
    }
  }

  if (path === "/api/admin/courses" && request.method === "GET") {
    const state = await readState();
    const major = majorKey(url.searchParams.get("major"));
    return json({ major, courses: state.majors[major].courses, version: state.majors[major].version });
  }

  if (path === "/api/admin/menu" && request.method === "GET") {
    const state = await readState();
    return json({ menu: state.menus.current ? sanitizeMenu(state.menus.current) : null, version: state.menus.version, dictionary: state.menus.dictionary });
  }

  if (path === "/api/admin/menu-dictionary" && request.method === "POST") {
    const body = await bodyJson(request);
    const name = text(body.name, 100);
    const meal = ["breakfast", "lunch", "dinner"].includes(body.meal) ? body.meal : "";
    const category = text(body.category, 30);
    if (!name || !meal || !MENU_MEALS[meal]?.includes(category)) return fail("菜名、餐次或分类不正确");
    if (/无法识别|看不清|未识别/.test(name)) return fail("无法确认的文字不能加入历史菜品库");
    const state = await readState();
    const existing = dictionaryEntry(state.menus.dictionary, name, meal, category);
    if (!existing) state.menus.dictionary.push({ name, meal: dictionaryMeal(meal, category), category, aliases: [], uses: 1, updated_at: new Date().toISOString() });
    state.menus.dictionary.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, "zh-CN"));
    if (state.menus.dictionary.length > 1200) state.menus.dictionary.length = 1200;
    await writeState(state);
    return json({ added: !existing, dictionary: state.menus.dictionary });
  }

  if (path === "/api/admin/menu-dictionary" && request.method === "PATCH") {
    const body = await bodyJson(request);
    const originalName = text(body.original?.name, 100);
    const originalMeal = ["breakfast", "lunch", "dinner"].includes(body.original?.meal) ? body.original.meal : "";
    const originalCategory = text(body.original?.category, 30);
    const name = text(body.entry?.name, 100);
    const meal = ["breakfast", "lunch", "dinner"].includes(body.entry?.meal) ? body.entry.meal : "";
    const category = text(body.entry?.category, 30);
    if (!originalName || !originalMeal || !name || !meal || !MENU_MEALS[meal]?.includes(category)) return fail("菜品修改信息不完整");
    const state = await readState();
    const storedOriginalMeal = dictionaryMeal(originalMeal, originalCategory);
    const storedMeal = dictionaryMeal(meal, category);
    const index = state.menus.dictionary.findIndex((entry) => entry.meal === storedOriginalMeal && entry.category === originalCategory && normalizedDishName(entry.name) === normalizedDishName(originalName));
    if (index < 0) return fail("未找到历史菜品", 404);
    const duplicate = state.menus.dictionary.some((entry, entryIndex) => entryIndex !== index && entry.meal === storedMeal && entry.category === category && normalizedDishName(entry.name) === normalizedDishName(name));
    if (duplicate) return fail("修改后的菜品已存在于相同餐次和分类");
    const current = state.menus.dictionary[index];
    const aliases = [...(current.aliases || [])];
    if (normalizedDishName(current.name) !== normalizedDishName(name) && !aliases.some((alias) => normalizedDishName(alias) === normalizedDishName(current.name))) aliases.push(current.name);
    const oldRatingKey = menuRatingKey(current.name, current.meal, current.category);
    const newRatingKey = menuRatingKey(name, storedMeal, category);
    if (oldRatingKey !== newRatingKey && state.menus.ratings[oldRatingKey]) {
      const oldRating = state.menus.ratings[oldRatingKey], targetRating = state.menus.ratings[newRatingKey] || { name, meal: storedMeal, category, voters: {} };
      targetRating.name = name; targetRating.meal = storedMeal; targetRating.category = category; targetRating.voters = { ...(targetRating.voters || {}), ...(oldRating.voters || {}) };
      const votes = Object.values(targetRating.voters); targetRating.likes = votes.filter((vote) => vote === "like").length; targetRating.dislikes = votes.filter((vote) => vote === "dislike").length;
      state.menus.ratings[newRatingKey] = targetRating; delete state.menus.ratings[oldRatingKey];
    }
    state.menus.dictionary[index] = { ...current, name, meal: storedMeal, category, aliases: aliases.slice(0, 30), updated_at: new Date().toISOString() };
    state.menus.dictionary.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, "zh-CN"));
    await writeState(state);
    return json({ entry: state.menus.dictionary.find((entry) => entry.meal === storedMeal && entry.category === category && normalizedDishName(entry.name) === normalizedDishName(name)), dictionary: state.menus.dictionary });
  }

  if (path === "/api/admin/menu-dictionary" && request.method === "DELETE") {
    const body = await bodyJson(request);
    const name = text(body.name, 100);
    const meal = ["breakfast", "lunch", "dinner"].includes(body.meal) ? body.meal : "";
    const category = text(body.category, 30);
    const state = await readState();
    const storedMeal = dictionaryMeal(meal, category);
    const before = state.menus.dictionary.length;
    state.menus.dictionary = state.menus.dictionary.filter((entry) => !(entry.meal === storedMeal && entry.category === category && normalizedDishName(entry.name) === normalizedDishName(name)));
    if (state.menus.dictionary.length === before) return fail("未找到历史菜品", 404);
    await writeState(state);
    return json({ ok: true, dictionary: state.menus.dictionary });
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

export async function onRequest(context) {
  const { request } = context;
  const waitUntilFn = typeof context?.waitUntil === "function" ? context.waitUntil.bind(context) : null;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (path === "/api/analytics/visit" && request.method === "POST") return await recordAnonymousVisit(request);
    if (path === "/api/analytics/action" && request.method === "POST") return await recordUserAction(request);
    if (path === "/api/menu-vote" && request.method === "POST") return await voteMenuDish(request);
    if (path === "/api/nasdaq100" && request.method === "GET") return await nasdaq100Response(url, typeof waitUntilFn === "function" ? waitUntilFn : null, request);
    if ((path === "/api/live-courses" || path.startsWith("/api/live-courses/") || path === "/api/courses") && request.method === "GET") {
      const state = await readState();
      const pathMajor = path.startsWith("/api/live-courses/") ? decodeURIComponent(path.slice("/api/live-courses/".length)) : null;
      const major = majorKey(pathMajor || url.searchParams.get("major"));
      return json({ major, courses: state.majors[major].courses, version: state.majors[major].version }, 200, { "Cache-Control": "no-store, no-cache, must-revalidate" });
    }
    if (path === "/api/live-menu" && request.method === "GET") {
      const state = await readState();
      const menu = state.menus.current ? sanitizeMenu(state.menus.current) : null;
      const ratings = await readMenuRatings(state.menus.ratings);
      return json({ menu, version: state.menus.version, ratings: publicRatingsForMenu(menu, state.menus.dictionary, ratings) }, 200, {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "CDN-Cache-Control": "no-store",
        "Surrogate-Control": "no-store",
        "Pragma": "no-cache",
        "Expires": "0",
      });
    }
    if (path.startsWith("/api/admin/")) return await adminRoutes(request, url, path);
    return fail("接口不存在", 404);
  } catch (error) {
    console.error("course-api", error);
    return fail(error?.message === "提交数据过大" ? error.message : "腾讯云课程服务暂时不可用，请稍后重试", error?.message === "提交数据过大" ? 413 : 500);
  }
}
