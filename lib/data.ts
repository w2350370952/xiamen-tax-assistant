import { initialCourses } from "./initial-courses";
import type { Course, CourseInput, UploadRecord, VersionMeta } from "./types";

function runtimeEnv() {
  return (globalThis as unknown as { __SITES_ENV?: { DB?: D1Database; BUCKET?: R2Bucket } }).__SITES_ENV;
}

export function getD1(): D1Database {
  const binding = runtimeEnv()?.DB;
  if (!binding) throw new Error("在线数据库暂不可用");
  return binding;
}

export function getBucket(): R2Bucket {
  const binding = runtimeEnv()?.BUCKET;
  if (!binding) throw new Error("PDF文件存储暂不可用");
  return binding;
}

export async function ensureDatabase() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, updated_at TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '', source_filename TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, uploaded_at TEXT NOT NULL,
      status TEXT NOT NULL, r2_key TEXT NOT NULL DEFAULT '', warnings TEXT NOT NULL DEFAULT '[]',
      published_version_id TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY, version_id TEXT NOT NULL, date TEXT NOT NULL, weekday TEXT NOT NULL,
      period TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      course_name TEXT NOT NULL, teacher TEXT NOT NULL DEFAULT '', class_name TEXT NOT NULL DEFAULT '',
      classroom TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', course_type TEXT NOT NULL DEFAULT 'other'
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS draft_courses (
      id TEXT PRIMARY KEY, upload_id TEXT NOT NULL, date TEXT NOT NULL, weekday TEXT NOT NULL,
      period TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      course_name TEXT NOT NULL, teacher TEXT NOT NULL DEFAULT '', class_name TEXT NOT NULL DEFAULT '',
      classroom TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', course_type TEXT NOT NULL DEFAULT 'other',
      source_page INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS courses_version_date_idx ON courses(version_id, date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS draft_courses_upload_date_idx ON draft_courses(upload_id, date)"),
  ]);
  await seedIfEmpty(db);
}

async function seedIfEmpty(db: D1Database) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM versions").first<{ count: number }>();
  if (Number(row?.count ?? 0) > 0) return;
  const versionId = "initial-course-plan-v1";
  const updatedAt = "2026-07-20T15:00:00.000Z";
  const statements = [
    db.prepare("INSERT INTO versions (id, label, updated_at, remark, source_filename) VALUES (?, ?, ?, ?, ?)")
      .bind(versionId, "v1.0", updatedAt, "根据学校课程总表初始化", "coursePlan4Student.pdf"),
    ...initialCourses.map((course, index) => insertCourseStatement(db, `initial-${index + 1}`, versionId, course)),
  ];
  await db.batch(statements);
}

function insertCourseStatement(db: D1Database, id: string, versionId: string, course: CourseInput) {
  return db.prepare(`INSERT INTO courses (
    id, version_id, date, weekday, period, start_time, end_time, course_name,
    teacher, class_name, classroom, remark, course_type
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id, versionId, course.date, course.weekday, course.period, course.start_time, course.end_time,
    course.course_name, course.teacher, course.class_name, course.classroom, course.remark, course.course_type,
  );
}

export async function getCurrentVersion(): Promise<VersionMeta | null> {
  await ensureDatabase();
  return getD1().prepare("SELECT * FROM versions ORDER BY updated_at DESC, label DESC LIMIT 1").first<VersionMeta>();
}

export async function listCurrentCourses(): Promise<Course[]> {
  await ensureDatabase();
  const db = getD1();
  const current = await db.prepare("SELECT id FROM versions ORDER BY updated_at DESC, label DESC LIMIT 1").first<{ id: string }>();
  if (!current) return [];
  const result = await db.prepare(`SELECT id, version_id, date, weekday, period, start_time, end_time,
    course_name, teacher, class_name, classroom, remark, course_type
    FROM courses WHERE version_id = ? ORDER BY date, start_time, course_name`).bind(current.id).all<Course>();
  return result.results ?? [];
}

export async function listUploads(): Promise<UploadRecord[]> {
  await ensureDatabase();
  const result = await getD1().prepare(`SELECT id, filename, uploaded_at, status, warnings, published_version_id
    FROM uploads ORDER BY uploaded_at DESC LIMIT 30`).all<UploadRecord>();
  return result.results ?? [];
}

export async function listDrafts(uploadId: string): Promise<Course[]> {
  await ensureDatabase();
  const result = await getD1().prepare(`SELECT id, upload_id, date, weekday, period, start_time, end_time,
    course_name, teacher, class_name, classroom, remark, course_type, source_page
    FROM draft_courses WHERE upload_id = ? ORDER BY date, start_time, course_name`).bind(uploadId).all<Course>();
  return result.results ?? [];
}

export function normalizeCourse(value: unknown): CourseInput | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const text = (key: string) => String(row[key] ?? "").trim();
  const date = text("date");
  const period = text("period");
  const courseName = text("course_name");
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !["上午", "下午", "晚上"].includes(period) || !courseName) return null;
  const rawType = text("course_type");
  const courseType = ["tax", "english", "digital", "other"].includes(rawType) ? rawType : "other";
  return {
    date,
    weekday: text("weekday"),
    period,
    start_time: text("start_time") || (period === "上午" ? "08:30" : "14:30"),
    end_time: text("end_time") || (period === "上午" ? "11:30" : "17:30"),
    course_name: courseName,
    teacher: text("teacher"),
    class_name: text("class_name"),
    classroom: text("classroom"),
    remark: text("remark"),
    course_type: courseType as CourseInput["course_type"],
    source_page: Number(row.source_page ?? 0),
  };
}

export function jsonError(error: unknown, fallback = "操作失败") {
  const message = error instanceof Error ? error.message : fallback;
  return Response.json({ error: message }, { status: 500 });
}
