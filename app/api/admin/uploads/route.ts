import { getBucket, getD1, jsonError, listDrafts, listUploads, normalizeCourse, ensureDatabase } from "@/lib/data";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorizedResponse();
  try {
    const url = new URL(request.url);
    const uploadId = url.searchParams.get("upload_id");
    return Response.json(uploadId ? { drafts: await listDrafts(uploadId) } : { uploads: await listUploads() });
  } catch (error) {
    return jsonError(error, "审核记录读取失败");
  }
}

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorizedResponse();
  try {
    await ensureDatabase();
    const form = await request.formData();
    const file = form.get("file");
    const coursesJson = form.get("courses");
    const warningsJson = form.get("warnings");
    if (!(file instanceof File) || file.type !== "application/pdf") {
      return Response.json({ error: "请选择PDF文件" }, { status: 400 });
    }
    if (file.size > 12 * 1024 * 1024) {
      return Response.json({ error: "PDF文件不能超过12MB" }, { status: 413 });
    }
    let rawCourses: unknown;
    try {
      rawCourses = JSON.parse(String(coursesJson ?? "[]"));
    } catch {
      return Response.json({ error: "课程解析结果格式错误" }, { status: 400 });
    }
    if (!Array.isArray(rawCourses) || rawCourses.length === 0 || rawCourses.length > 500) {
      return Response.json({ error: "没有可审核的课程，或课程数量异常" }, { status: 400 });
    }
    const courses = rawCourses.map(normalizeCourse);
    if (courses.some((course) => course === null)) {
      return Response.json({ error: "部分课程缺少日期、时段或课程名称" }, { status: 400 });
    }

    const uploadId = crypto.randomUUID();
    const uploadedAt = new Date().toISOString();
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-120) || "course.pdf";
    const r2Key = `course-pdfs/${uploadedAt.slice(0, 10)}/${uploadId}-${safeName}`;
    await getBucket().put(r2Key, file.stream(), {
      httpMetadata: { contentType: "application/pdf", contentDisposition: `attachment; filename="${safeName}"` },
      customMetadata: { uploadId },
    });

    const db = getD1();
    const warnings = String(warningsJson ?? "[]");
    const statements = [
      db.prepare(`INSERT INTO uploads (id, filename, uploaded_at, status, r2_key, warnings)
        VALUES (?, ?, ?, 'pending_review', ?, ?)`).bind(uploadId, file.name, uploadedAt, r2Key, warnings),
      ...courses.map((course) => {
        const value = course!;
        return db.prepare(`INSERT INTO draft_courses (
          id, upload_id, date, weekday, period, start_time, end_time, course_name,
          teacher, class_name, classroom, remark, course_type, source_page
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          crypto.randomUUID(), uploadId, value.date, value.weekday, value.period, value.start_time,
          value.end_time, value.course_name, value.teacher, value.class_name, value.classroom,
          value.remark, value.course_type, value.source_page ?? 0,
        );
      }),
    ];
    await db.batch(statements);
    return Response.json({ upload_id: uploadId, count: courses.length, drafts: await listDrafts(uploadId) }, { status: 201 });
  } catch (error) {
    return jsonError(error, "PDF上传失败");
  }
}

