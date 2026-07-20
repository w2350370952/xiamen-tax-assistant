import { getCurrentVersion, jsonError, listCurrentCourses } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const courses = (await listCurrentCourses()).filter((course) =>
      (!from || course.date >= from) && (!to || course.date <= to),
    );
    const version = await getCurrentVersion();
    return Response.json({ courses, version });
  } catch (error) {
    return jsonError(error, "课程读取失败");
  }
}

