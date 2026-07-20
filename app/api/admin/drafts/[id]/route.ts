import { ensureDatabase, getD1, jsonError, normalizeCourse } from "@/lib/data";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorizedResponse();
  try {
    await ensureDatabase();
    const { id } = await context.params;
    const course = normalizeCourse(await request.json());
    if (!course) return Response.json({ error: "课程信息不完整" }, { status: 400 });
    await getD1().prepare(`UPDATE draft_courses SET
      date=?, weekday=?, period=?, start_time=?, end_time=?, course_name=?, teacher=?,
      class_name=?, classroom=?, remark=?, course_type=? WHERE id=?`).bind(
      course.date, course.weekday, course.period, course.start_time, course.end_time,
      course.course_name, course.teacher, course.class_name, course.classroom, course.remark,
      course.course_type, id,
    ).run();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error, "草稿修改失败");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorizedResponse();
  try {
    await ensureDatabase();
    const { id } = await context.params;
    await getD1().prepare("DELETE FROM draft_courses WHERE id = ?").bind(id).run();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error, "草稿删除失败");
  }
}

