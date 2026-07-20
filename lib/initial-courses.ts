import type { CourseInput, CourseType } from "./types";

const weekdayNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function build(
  dates: string[],
  period: "上午" | "下午",
  courseName: string,
  teacher: string,
  className: string,
  courseType: CourseType,
): CourseInput[] {
  return dates.map((date) => ({
    date,
    weekday: weekdayNames[new Date(`${date}T12:00:00+08:00`).getUTCDay()],
    period,
    start_time: period === "上午" ? "08:30" : "14:30",
    end_time: period === "上午" ? "11:30" : "17:30",
    course_name: courseName,
    teacher,
    class_name: className,
    classroom: "",
    remark: "",
    course_type: courseType,
  }));
}

export const initialCourses: CourseInput[] = [
  ...build(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"], "上午", "重点领域税务专题", "陈丽", "", "tax"),
  ...build(["2026-09-08", "2026-09-15", "2026-09-20", "2026-09-29", "2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10", "2026-11-17"], "上午", "商务英语听说", "蒋艳虹", "2", "english"),
  ...build(["2026-09-11", "2026-09-18", "2026-09-22", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13", "2026-11-20"], "上午", "综合商务英语", "陈巧玲", "2", "english"),
  ...build(["2026-09-15", "2026-09-22", "2026-09-29", "2026-10-13"], "下午", "数字经济与数据资产管理", "蹇薇", "", "digital"),
  ...build(["2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"], "上午", "人工智能、大数据分析与税收应用", "陈丽", "", "digital"),
  ...build(["2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"], "上午", "人工智能、大数据分析与税收应用", "张小三", "", "digital"),
  ...build(["2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30", "2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"], "下午", "纳税申报与税费争议", "薛伟", "", "tax"),
].sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));

