import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getStore } from "@edgeone/pages-blob";

const store = getStore("xiamen-tax-assistant");
const STATE_KEY = "course-state.json";
const COOKIE = "xnai_admin";
const ADMIN_USER = "xnaitax2025";
const ADMIN_PASSWORD_SHA256 = "3d4a6df67e692969e3092a220365c136d761097075b504bea76c0b2858a22bb5";
const SESSION_SECONDS = 60 * 60 * 12;

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
});

const fail = (detail, status = 400) => json({ detail }, status);
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

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

async function readState() {
  const state = await store.get(STATE_KEY, { type: "json", consistency: "strong" });
  return state || { version: { label: "v1.0", updated_at: null, remark: "内置课程数据" }, courses: [], uploads: [] };
}

async function writeState(state) {
  await store.setJSON(STATE_KEY, state, { cacheControl: "no-store" });
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

function nextVersion(label) {
  const match = String(label || "v1.0").match(/^v?(\d+)\.(\d+)$/);
  return match ? `v${match[1]}.${Number(match[2]) + 1}` : "v1.1";
}

function markCourseUpdate(state, remark) {
  state.version = {
    label: nextVersion(state.version?.label),
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

  if (path === "/api/admin/courses" && request.method === "GET") {
    const state = await readState();
    return json({ courses: state.courses || [], version: state.version || null });
  }

  if (path.startsWith("/api/admin/courses/") && request.method === "PATCH") {
    const courseId = decodeURIComponent(path.slice("/api/admin/courses/".length));
    const body = await bodyJson(request);
    const state = await readState();
    const index = (state.courses || []).findIndex((item) => item.id === courseId);
    if (index < 0) return fail("未找到已发布课程", 404);
    const course = sanitizeCourse(body.course, courseId);
    course.id = courseId;
    if (!validCourse(course)) return fail("日期、星期、时段、时间和课程名称为必填项");
    state.courses[index] = course;
    state.courses.sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
    markCourseUpdate(state, `管理员调整课程：${course.course_name}`);
    await writeState(state);
    return json({ course, version: state.version });
  }

  if (path.startsWith("/api/admin/courses/") && request.method === "DELETE") {
    const courseId = decodeURIComponent(path.slice("/api/admin/courses/".length));
    const state = await readState();
    const course = (state.courses || []).find((item) => item.id === courseId);
    if (!course) return fail("未找到已发布课程", 404);
    state.courses = state.courses.filter((item) => item.id !== courseId);
    markCourseUpdate(state, `管理员删除课程：${course.course_name}`);
    await writeState(state);
    return json({ ok: true, version: state.version });
  }

  if (path === "/api/admin/uploads" && request.method === "GET") {
    const state = await readState();
    return json({ uploads: state.uploads || [] });
  }

  if (path === "/api/admin/uploads" && request.method === "POST") {
    const body = await bodyJson(request);
    if (!Array.isArray(body.courses) || !body.courses.length || body.courses.length > 1000) return fail("课程数据为空或数量异常");
    const drafts = body.courses.map((item) => sanitizeCourse(item)).filter(validCourse);
    if (!drafts.length) return fail("课程字段不完整，无法加入审核列表");
    const upload = {
      id: randomUUID(), filename: text(body.filename, 220) || "课程总表.pdf",
      uploaded_at: new Date().toISOString(), status: "review",
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
    state.courses = courses;
    state.version = { label: nextVersion(state.version?.label), updated_at: now, remark: `来自 ${upload.filename}` };
    upload.status = "published"; upload.published_at = now;
    await writeState(state);
    return json({ ok: true, version: state.version, course_count: courses.length });
  }
  return fail("管理员接口不存在", 404);
}

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (path === "/api/courses" && request.method === "GET") {
      const state = await readState();
      return json({ courses: state.courses || [], version: state.version || null }, 200, { "Cache-Control": "no-store, no-cache, must-revalidate" });
    }
    if (path.startsWith("/api/admin/")) return await adminRoutes(request, url, path);
    return fail("接口不存在", 404);
  } catch (error) {
    console.error("course-api", error);
    return fail(error?.message === "提交数据过大" ? error.message : "腾讯云课程服务暂时不可用，请稍后重试", error?.message === "提交数据过大" ? 413 : 500);
  }
}
