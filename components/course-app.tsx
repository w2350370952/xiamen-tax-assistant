"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clock3, Database, GraduationCap, Home, MapPin, ShieldCheck, UserRound, X } from "lucide-react";
import type { Course, VersionMeta } from "@/lib/types";

type Tab = "today" | "schedule" | "month" | "profile";
const weekNames = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
const palette = {
  tax: { label: "税务课程", color: "#2f6fed", soft: "#eaf1ff" },
  english: { label: "英语课程", color: "#15966f", soft: "#e7f7f1" },
  digital: { label: "数字与智能", color: "#7657d6", soft: "#f0ecff" },
  other: { label: "其他课程", color: "#7b8798", soft: "#eef1f4" },
};

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dateFromIso(value: string) { return new Date(`${value}T12:00:00`); }
function addDays(value: Date, days: number) { const next = new Date(value); next.setDate(next.getDate() + days); return next; }
function monday(value: Date) { const day = value.getDay() || 7; return addDays(value, 1 - day); }
function dateLabel(value: Date) { return `${value.getMonth() + 1}月${value.getDate()}日`; }
function firstOfMonth(value: Date) { return new Date(value.getFullYear(), value.getMonth(), 1, 12); }
function addMonths(value: Date, months: number) { return new Date(value.getFullYear(), value.getMonth() + months, 1, 12); }

export default function CourseApp({ initialCourses, initialVersion }: { initialCourses: Course[]; initialVersion: VersionMeta | null }) {
  const [tab, setTab] = useState<Tab>("today");
  const [now, setNow] = useState(new Date());
  const [selected, setSelected] = useState<Course | null>(null);
  const [courses, setCourses] = useState(initialCourses);
  const [version, setVersion] = useState(initialVersion);
  const [loading, setLoading] = useState(!initialCourses.length);
  const firstDate = courses[0]?.date;
  const lastDate = courses.at(-1)?.date;
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [monthAnchor, setMonthAnchor] = useState(firstOfMonth(new Date()));
  const [selectedMonthDate, setSelectedMonthDate] = useState(isoDate(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    fetch("/api/courses", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      setCourses(data.courses ?? []); setVersion(data.version ?? null);
      if (data.courses?.[0]?.date && isoDate(new Date()) < data.courses[0].date) {
        const firstCourseDate = dateFromIso(data.courses[0].date);
        setWeekAnchor(firstCourseDate);
        setMonthAnchor(firstOfMonth(firstCourseDate));
        setSelectedMonthDate(data.courses[0].date);
      }
    }).finally(() => setLoading(false));
    return () => window.clearInterval(timer);
  }, []);
  const today = isoDate(now);
  const todayCourses = courses.filter((course) => course.date === today);
  const futureCourses = courses.filter((course) => `${course.date}T${course.start_time}` > `${today}T${now.toTimeString().slice(0, 5)}`);
  const nextCourse = futureCourses[0] ?? null;
  const countdown = nextCourse ? Math.max(0, dateFromIso(nextCourse.date).setHours(Number(nextCourse.start_time.slice(0, 2)), Number(nextCourse.start_time.slice(3, 5))) - now.getTime()) : 0;
  const hours = Math.floor(countdown / 3600000);
  const minutes = Math.floor((countdown % 3600000) / 60000);
  const seconds = Math.floor((countdown % 60000) / 1000);

  const mondayDate = monday(weekAnchor);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(mondayDate, index));
  const semesterWeek = firstDate ? Math.floor((mondayDate.getTime() - monday(dateFromIso(firstDate)).getTime()) / 604800000) + 1 : null;
  const monthStart = firstOfMonth(monthAnchor);
  const monthGridStart = monday(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index));
  const selectedDayCourses = courses.filter((course) => course.date === selectedMonthDate);

  function moveMonth(months: number) {
    const next = addMonths(monthAnchor, months);
    setMonthAnchor(next);
    setSelectedMonthDate(isoDate(next));
  }

  function showCurrentMonth() {
    const target = firstDate && today < firstDate ? dateFromIso(firstDate) : new Date();
    setMonthAnchor(firstOfMonth(target));
    setSelectedMonthDate(isoDate(target));
  }

  const navigation = [
    { id: "today" as const, label: "今日", icon: Home },
    { id: "schedule" as const, label: "周课表", icon: CalendarDays },
    { id: "month" as const, label: "月视图", icon: CalendarRange },
    { id: "profile" as const, label: "我的", icon: UserRound },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand brand-button" onClick={() => setTab("today")}>
          <span className="brand-mark">MT</span><span><strong>厦国会</strong><small>税务专硕助手</small></span>
        </button>
        <nav className="side-nav">
          {navigation.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><item.icon size={19} />{item.label}</button>)}
        </nav>
        <Link className="admin-entry" href="/admin"><ShieldCheck size={17} />管理员入口</Link>
      </aside>

      <main className="main-content">
        {tab === "today" && (
          <div className="page home-page">
            <header className="page-header home-header">
              <div><p className="eyebrow">TODAY&apos;S FOCUS</p><h1>{["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][now.getDay()]}，专注当下。</h1><p>{now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日 · 厦门国家会计学院</p></div>
              <button className="text-action" onClick={() => setTab("schedule")}>查看周课表 <ArrowRight size={17} /></button>
            </header>
            {nextCourse && (
              <section className="next-class-banner"><span className="banner-icon"><Clock3 size={20} /></span><div><small>{todayCourses.length ? "距离下一节" : "下一节课程"} · {nextCourse.course_name}</small><strong>{nextCourse.date === today ? `${hours ? `${hours}小时 ` : ""}${minutes}分 ${String(seconds).padStart(2, "0")}秒` : `${nextCourse.date} ${nextCourse.weekday}`}</strong></div><span>{nextCourse.start_time} 开始</span></section>
            )}
            <section className="content-section">
              <div className="section-heading"><div><span className="section-index">TODAY</span><h2>今日课程</h2></div><span className="count-chip">{todayCourses.length} 节</span></div>
              {loading ? <div className="loading-state"><span /><span /><span /></div> : todayCourses.length ? <div className="course-list">{todayCourses.map((course) => <CourseCard key={course.id} course={course} onClick={() => setSelected(course)} />)}</div> : <div className="empty-state"><span className="empty-icon"><BookOpenCheck size={25} /></span><h3>今日暂无课程</h3><p>{firstDate && today < firstDate ? `本学期课程将于 ${firstDate} 开始` : "给自己留一点阅读和整理的时间。"}</p><button className="inline-link" onClick={() => setTab("schedule")}><CalendarDays size={16} />浏览本学期安排</button></div>}
            </section>
          </div>
        )}

        {tab === "schedule" && (
          <div className="page schedule-page">
            <header className="page-header schedule-header"><div><p className="eyebrow">WEEKLY SCHEDULE</p><h1>{semesterWeek && semesterWeek > 0 ? `第 ${semesterWeek} 周` : "周课表"}</h1><p>{dateLabel(weekDays[0])} – {dateLabel(weekDays[6])}</p></div><div className="week-actions"><button aria-label="上一周" onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}><ChevronLeft size={19} /></button><button className="week-today" onClick={() => setWeekAnchor(new Date())}>本周</button><button aria-label="下一周" onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}><ChevronRight size={19} /></button></div></header>
            <div className="schedule-scroll"><div className="schedule-grid"><div className="grid-corner">时段</div>{weekDays.map((day, index) => <div key={isoDate(day)} className={`day-heading ${isoDate(day) === today ? "today" : ""}`}><span>{weekNames[index]}</span><strong>{day.getDate()}</strong></div>)}{["上午", "下午"].map((period) => <ScheduleRow key={period} period={period} days={weekDays} courses={courses} onSelect={setSelected} />)}</div></div>
            <div className="schedule-legend">{Object.entries(palette).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}</div>
          </div>
        )}

        {tab === "month" && (
          <div className="page month-page">
            <header className="page-header schedule-header">
              <div><p className="eyebrow">MONTHLY CALENDAR</p><h1>{monthStart.getFullYear()}年{monthStart.getMonth() + 1}月</h1><p>按月查看全部课程安排</p></div>
              <div className="week-actions"><button aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={19} /></button><button className="week-today" onClick={showCurrentMonth}>本月</button><button aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={19} /></button></div>
            </header>
            <section className="month-calendar">
              <div className="month-weekdays">{weekNames.map((name) => <span key={name}>{name.replace("星期", "周")}</span>)}</div>
              <div className="month-grid">
                {monthDays.map((day) => {
                  const date = isoDate(day);
                  const dayCourses = courses.filter((course) => course.date === date);
                  const outside = day.getMonth() !== monthStart.getMonth();
                  return <div key={date} className={`month-cell${outside ? " outside" : ""}${date === today ? " today" : ""}${date === selectedMonthDate ? " selected" : ""}`}>
                    <button className="month-date" aria-label={`查看${date}课程`} onClick={() => setSelectedMonthDate(date)}><span>{day.getDate()}</span>{dayCourses.length > 0 && <em>{dayCourses.length}节</em>}</button>
                    <div className="month-courses">{dayCourses.map((course) => { const meta = palette[course.course_type] ?? palette.other; return <button key={course.id} className="month-course" aria-label={`${course.course_name}，${course.teacher}`} title={course.course_name} style={{ "--course-color": meta.color, "--course-soft": meta.soft } as React.CSSProperties} onClick={() => { setSelectedMonthDate(date); setSelected(course); }}><i /><span>{course.course_name}</span></button>; })}</div>
                  </div>;
                })}
              </div>
            </section>
            <section className="month-day-panel">
              <div className="section-heading"><div><span className="section-index">SELECTED DAY</span><h2>{selectedMonthDate.replaceAll("-", ".")} 课程</h2></div><span className="count-chip">{selectedDayCourses.length} 节</span></div>
              {selectedDayCourses.length ? <div className="course-list">{selectedDayCourses.map((course) => <CourseCard key={course.id} course={course} onClick={() => setSelected(course)} />)}</div> : <div className="month-day-empty">当天暂无课程</div>}
            </section>
            <div className="schedule-legend">{Object.entries(palette).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}</div>
          </div>
        )}

        {tab === "profile" && (
          <div className="page profile-page">
            <header className="profile-hero"><span className="profile-avatar"><GraduationCap size={30} /></span><div><p>2025级全日制 MT</p><h1>税务专硕课程空间</h1><span>把课程安排变成清晰、可靠的日常。</span></div></header>
            <section className="stats-grid"><article><span><BookOpenCheck size={21} /></span><small>当前课程</small><strong>{courses.length}</strong><em>条已发布安排</em></article><article><span><Database size={21} /></span><small>当前版本</small><strong>{version?.label ?? "—"}</strong><em>管理员审核后生效</em></article><article><span><Clock3 size={21} /></span><small>更新时间</small><strong className="date-value">{version ? version.updated_at.slice(0, 10).replaceAll("-", ".") : "—"}</strong><em>{lastDate ? `课程排至 ${lastDate}` : "暂无课程"}</em></article></section>
            <section className="about-card"><div><ShieldCheck size={22} /><span><strong>发布安全机制</strong><small>PDF解析结果不会直接覆盖课程，必须由管理员审核后发布。</small></span></div><Link href="/admin">管理员入口</Link></section>
          </div>
        )}
      </main>

      <nav className="bottom-nav">{navigation.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><item.icon size={21} /><span>{item.label}</span></button>)}</nav>
      {selected && <CourseModal course={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CourseCard({ course, onClick }: { course: Course; onClick: () => void }) {
  const meta = palette[course.course_type] ?? palette.other;
  return <button className="course-card" style={{ "--course-color": meta.color, "--course-soft": meta.soft } as React.CSSProperties} onClick={onClick}><span className="course-accent" /><div className="course-card-main"><span className="course-type">{meta.label}</span><h3>{course.course_name}</h3><div className="course-meta"><span><UserRound size={15} />{course.teacher || "教师待定"}</span><span><Clock3 size={15} />{course.start_time}–{course.end_time}</span>{course.classroom && <span><MapPin size={15} />{course.classroom}</span>}</div></div><span className="course-period">{course.period}</span></button>;
}

function ScheduleRow({ period, days, courses, onSelect }: { period: string; days: Date[]; courses: Course[]; onSelect: (course: Course) => void }) {
  return <><div className="period-label"><strong>{period}</strong><span>{period === "上午" ? "08:30" : "14:30"}</span></div>{days.map((day) => <div key={`${isoDate(day)}-${period}`} className="schedule-cell">{courses.filter((course) => course.date === isoDate(day) && course.period === period).map((course) => { const meta = palette[course.course_type] ?? palette.other; return <button key={course.id} className="mini-course" style={{ "--course-color": meta.color, "--course-soft": meta.soft } as React.CSSProperties} onClick={() => onSelect(course)}><strong>{course.course_name}</strong><span>{course.teacher || "教师待定"}</span></button>; })}</div>)}</>;
}

function CourseModal({ course, onClose }: { course: Course; onClose: () => void }) {
  const meta = palette[course.course_type] ?? palette.other;
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="course-modal"><button className="modal-close" onClick={onClose}><X size={19} /></button><span className="detail-type" style={{ color: meta.color }}>{meta.label}</span><h2>{course.course_name}</h2><dl><div><dt>日期</dt><dd>{course.date} · {course.weekday}</dd></div><div><dt>时间</dt><dd>{course.start_time}–{course.end_time}</dd></div><div><dt>教师</dt><dd>{course.teacher || "未填写"}</dd></div><div><dt>班级</dt><dd>{course.class_name || "未填写"}</dd></div><div><dt>教室</dt><dd>{course.classroom || "未填写"}</dd></div><div><dt>备注</dt><dd>{course.remark || "无"}</dd></div></dl></section></div>;
}
