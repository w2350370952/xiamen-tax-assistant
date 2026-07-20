import { ensureDatabase, getD1, jsonError, listDrafts } from "@/lib/data";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorizedResponse();
  try {
    await ensureDatabase();
    const payload = await request.json() as { upload_id?: string; remark?: string };
    const uploadId = String(payload.upload_id ?? "");
    const drafts = await listDrafts(uploadId);
    if (!uploadId || !drafts.length) return Response.json({ error: "没有可发布的审核课程" }, { status: 400 });

    const db = getD1();
    const upload = await db.prepare("SELECT filename FROM uploads WHERE id = ? AND status = 'pending_review'")
      .bind(uploadId).first<{ filename: string }>();
    if (!upload) return Response.json({ error: "该文件已经发布或状态异常" }, { status: 409 });
    const count = await db.prepare("SELECT COUNT(*) AS count FROM versions").first<{ count: number }>();
    const versionId = crypto.randomUUID();
    const label = `v1.${Number(count?.count ?? 0)}`;
    const updatedAt = new Date().toISOString();
    const remark = String(payload.remark ?? "管理员审核发布").trim() || "管理员审核发布";
    const statements = [
      db.prepare("INSERT INTO versions (id, label, updated_at, remark, source_filename) VALUES (?, ?, ?, ?, ?)")
        .bind(versionId, label, updatedAt, remark, upload.filename),
      ...drafts.map((course) => db.prepare(`INSERT INTO courses (
        id, version_id, date, weekday, period, start_time, end_time, course_name,
        teacher, class_name, classroom, remark, course_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        crypto.randomUUID(), versionId, course.date, course.weekday, course.period,
        course.start_time, course.end_time, course.course_name, course.teacher,
        course.class_name, course.classroom, course.remark, course.course_type,
      )),
      db.prepare("UPDATE uploads SET status='published', published_version_id=? WHERE id=?").bind(versionId, uploadId),
    ];
    await db.batch(statements);
    return Response.json({ version: { id: versionId, label, updated_at: updatedAt }, count: drafts.length });
  } catch (error) {
    return jsonError(error, "课程发布失败");
  }
}

