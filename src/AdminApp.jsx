import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BarChart3, CalendarDays, CheckCircle2, Eye, FileImage, FileText, LogOut, Pencil, RefreshCw, ShieldCheck, Smartphone, Soup, Trash2, UploadCloud, Users, UtensilsCrossed, X } from "lucide-react";

const MAJORS = [
  { id: "tax", label: "税务" },
  { id: "accounting", label: "会计" },
  { id: "audit", label: "审计" },
  { id: "finance", label: "金融" },
];

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.message || `请求失败（HTTP ${response.status}）`);
  return data;
}

export default function AdminApp() {
  const [session, setSession] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [courses, setCourses] = useState([]);
  const [version, setVersion] = useState(null);
  const [major, setMajor] = useState("tax");
  const [section, setSection] = useState("published");
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("正在处理文件…");
  const [notice, setNotice] = useState("");
  const fileRef = useRef(null);

  const loadUploads = async () => {
    const data = await api(`/api/admin/uploads?major=${encodeURIComponent(major)}`);
    setUploads(data.uploads || []);
    setActiveId((current) => data.uploads?.some((item) => item.id === current) ? current : data.uploads?.[0]?.id || null);
  };

  const loadCourses = async () => {
    const data = await api(`/api/admin/courses?major=${encodeURIComponent(major)}`);
    setCourses(data.courses || []);
    setVersion(data.version || null);
  };

  const loadAdminData = async () => Promise.all([loadUploads(), loadCourses()]);

  useEffect(() => {
    api("/api/admin/session").then(() => setSession(true)).catch(() => setSession(false));
  }, []);

  useEffect(() => {
    if (session === true) loadAdminData().catch((error) => setNotice(error.message));
  }, [session, major]);

  const login = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
      setSession(true);
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    setSession(false); setUploads([]); setCourses([]); setActiveId(null);
  };

  const uploadPdf = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setNotice("请选择 PDF 文件"); return; }
    setBusy(true); setProgress(1); setNotice("正在读取 PDF，请稍候…");
    setProgressLabel("正在本机解析 PDF，文件不会公开");
    try {
      const { parseCoursePdf } = await import("./pdf-parser-edgeone.js");
      const result = await parseCoursePdf(file, setProgress);
      if (!result.courses.length) throw new Error(result.warnings.join("；") || "未识别到课程");
      const record = await api("/api/admin/uploads", { method: "POST", body: JSON.stringify({ major, filename: file.name, courses: result.courses, warnings: result.warnings }) });
      await loadUploads(); setActiveId(record.upload.id);
      setNotice(`解析完成：识别到 ${result.courses.length} 节课程，请审核后发布。`);
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); setProgress(0); if (fileRef.current) fileRef.current.value = ""; }
  };

  const deleteUpload = async (id) => {
    if (!window.confirm("确定删除这条上传记录和待审核课程吗？已发布的课表不会受影响。")) return;
    setBusy(true); setNotice("");
    try { await api(`/api/admin/uploads?id=${encodeURIComponent(id)}`, { method: "DELETE" }); await loadUploads(); setActiveId(null); setNotice("上传记录已删除"); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };

  const deleteDraft = async (uploadId, courseId) => {
    if (!window.confirm("确定删除这节待审核课程吗？")) return;
    try { await api(`/api/admin/drafts/${encodeURIComponent(courseId)}?upload_id=${encodeURIComponent(uploadId)}`, { method: "DELETE" }); await loadUploads(); }
    catch (error) { setNotice(error.message); }
  };

  const saveDraft = async (uploadId, course) => {
    try { await api(`/api/admin/drafts/${encodeURIComponent(course.id)}`, { method: "PATCH", body: JSON.stringify({ upload_id: uploadId, course }) }); await loadUploads(); setNotice("课程修改已保存"); }
    catch (error) { setNotice(error.message); throw error; }
  };

  const publish = async (upload) => {
    if (!upload.drafts?.length) return setNotice("没有可发布的课程");
    if (!window.confirm(`确认发布“${upload.filename}”中的 ${upload.drafts.length} 节课程？学生端将更新为这个版本。`)) return;
    setBusy(true); setNotice("");
    try { const data = await api("/api/admin/publish", { method: "POST", body: JSON.stringify({ upload_id: upload.id }) }); await loadAdminData(); setSection("published"); setNotice(`发布成功，当前版本 ${data.version.label}`); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };

  const savePublishedCourse = async (course) => {
    setBusy(true); setNotice("");
    try {
      const data = await api(`/api/admin/courses/${encodeURIComponent(course.id)}`, { method: "PATCH", body: JSON.stringify({ major, course }) });
      await loadCourses();
      setNotice(`调课信息已保存，当前版本 ${data.version.label}`);
    } catch (error) { setNotice(error.message); throw error; }
    finally { setBusy(false); }
  };

  const deletePublishedCourse = async (course) => {
    if (!window.confirm(`确定从当前课表删除“${course.course_name}”吗？学生端会立即更新。`)) return;
    setBusy(true); setNotice("");
    try {
      const data = await api(`/api/admin/courses/${encodeURIComponent(course.id)}?major=${encodeURIComponent(major)}`, { method: "DELETE" });
      await loadCourses();
      setNotice(`课程已删除，当前版本 ${data.version.label}`);
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };

  if (session === null) return <div className="admin-loading"><span/>正在连接腾讯云管理员服务…</div>;
  if (!session) return <Login busy={busy} notice={notice} onSubmit={login}/>;
  const active = uploads.find((item) => item.id === activeId) || null;

  return <div className="admin-shell">
    <header className="admin-topbar"><a href="/"><ArrowLeft size={18}/>返回学生端</a><div><ShieldCheck/><span><strong>厦国会专硕课程助手</strong><small>管理员控制台 · 腾讯云 EdgeOne</small></span></div><button onClick={logout}><LogOut size={17}/>退出登录</button></header>
    <main className="admin-main">
      <section className="admin-heading"><div><em>{section === "menu" ? "DINING MANAGEMENT" : section === "analytics" ? "VISITOR ANALYTICS" : "COURSE MANAGEMENT"}</em><h1>{section === "menu" ? "一周菜单管理" : section === "analytics" ? "访问指标分析" : `${MAJORS.find((item) => item.id === major)?.label}专业课程管理`}</h1><p>{section === "menu" ? "上传食堂一周菜单图片，自动识别并校对后发布到学生端。" : section === "analytics" ? "按北京时间查看每日、每小时和设备系统的匿名访问情况。" : "各专业课程独立保存，上传和调课只影响当前选择的专业。"}</p></div>{!['menu','analytics'].includes(section) && <div className="admin-heading-actions"><label className="major-select">管理专业<select value={major} onChange={(event) => { setMajor(event.target.value); setNotice(""); }} disabled={busy}>{MAJORS.map((item) => <option key={item.id} value={item.id}>{item.label}专业</option>)}</select></label>{section === "uploads" && <label className={`upload-button ${busy ? "disabled" : ""}`}><UploadCloud/>上传课程 PDF<input ref={fileRef} type="file" accept="application/pdf,.pdf" disabled={busy} onChange={uploadPdf}/></label>}</div>}</section>
      <nav className="admin-tabs"><button className={section === "published" ? "active" : ""} onClick={() => setSection("published")}><CalendarDays/>现有课程 <span>{courses.length}</span></button><button className={section === "uploads" ? "active" : ""} onClick={() => setSection("uploads")}><UploadCloud/>PDF 上传与审核 <span>{uploads.length}</span></button><button className={section === "menu" ? "active" : ""} onClick={() => setSection("menu")}><UtensilsCrossed/>今日菜单</button><button className={section === "analytics" ? "active" : ""} onClick={() => setSection("analytics")}><BarChart3/>指标分析</button></nav>
      {busy && progress > 0 && <div className="parse-progress"><span style={{ width: `${progress}%` }}/><b>{progress}%</b><small>{progressLabel}</small></div>}
      {notice && <div className="admin-notice">{notice}<button onClick={() => setNotice("")}><X size={16}/></button></div>}
      {section === "analytics" ? <AnalyticsPanel/> : section === "menu" ? <MenuManager busy={busy} setBusy={setBusy} setProgress={setProgress} setProgressLabel={setProgressLabel} setNotice={setNotice}/> : section === "published" ? <PublishedCourses majorLabel={MAJORS.find((item) => item.id === major)?.label} courses={courses} version={version} busy={busy} onSave={savePublishedCourse} onDelete={deletePublishedCourse}/> : <div className="admin-workspace">
        <aside className="upload-list"><div className="upload-list-title"><h2>上传记录</h2><span>{uploads.length}</span></div>{uploads.length ? uploads.map((item) => <button key={item.id} className={activeId === item.id ? "active" : ""} onClick={() => setActiveId(item.id)}><FileText/><span><strong>{item.filename}</strong><small>{new Date(item.uploaded_at).toLocaleString("zh-CN")}</small></span><em className={item.status}>{item.status === "published" ? "已发布" : "待审核"}</em></button>) : <div className="upload-empty"><FileText/><p>还没有上传记录</p><small>请点击右上角上传课程 PDF</small></div>}</aside>
        <section className="review-panel">{active ? <><div className="review-head"><div><span className={`status ${active.status}`}>{active.status === "published" ? <CheckCircle2/> : <Pencil/>}{active.status === "published" ? "已发布版本" : "待审核"}</span><h2>{active.filename}</h2><p>共识别 {active.drafts?.length || 0} 节课程{active.warnings?.length ? ` · ${active.warnings.length} 条提示` : ""}</p></div><div><button className="danger" disabled={busy} onClick={() => deleteUpload(active.id)}><Trash2/>删除文件记录</button><button className="publish" disabled={busy || !active.drafts?.length} onClick={() => publish(active)}><CheckCircle2/>确认发布</button></div></div>{active.warnings?.length > 0 && <div className="parse-warnings">{active.warnings.map((warning, index) => <p key={index}>• {warning}</p>)}</div>}<CourseReview upload={active} onSave={saveDraft} onDelete={deleteDraft}/></> : <div className="review-empty"><UploadCloud/><h2>上传课程总表</h2><p>系统会自动识别日期、时段、课程、教师、班级、教室和备注。</p></div>}</section>
      </div>}
    </main>
  </div>;
}

function Login({ busy, notice, onSubmit }) {
  return <div className="admin-login"><a href="/"><ArrowLeft/>返回学生端</a><form onSubmit={onSubmit}><div className="login-mark"><ShieldCheck/></div><em>ADMIN CONSOLE</em><h1>管理员登录</h1><p>只有管理员可以上传、审核和发布课程 PDF。</p><label>管理员账号<input name="username" autoComplete="username" required placeholder="请输入账号"/></label><label>登录密码<input name="password" type="password" autoComplete="current-password" required placeholder="请输入密码"/></label>{notice && <div className="login-error">{notice}</div>}<button disabled={busy}>{busy ? "正在登录…" : "登录管理员后台"}</button><small>由腾讯云 EdgeOne 同域安全服务验证</small></form></div>;
}

function PublishedCourses({ majorLabel, courses, version, busy, onSave, onDelete }) {
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState("");
  const fields = [["date", "日期"], ["weekday", "星期"], ["period", "时段"], ["start_time", "开始"], ["end_time", "结束"], ["course_name", "课程名称"], ["teacher", "教师"], ["class_name", "班级"], ["classroom", "教室"], ["remark", "备注"], ["course_type", "类型"]];
  const keyword = query.trim().toLowerCase();
  const visible = courses.filter((course) => !keyword || [course.course_name, course.teacher, course.date, course.classroom, course.remark].some((value) => String(value || "").toLowerCase().includes(keyword)));
  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const course = { ...editing };
    fields.forEach(([key]) => { course[key] = String(form.get(key) || "").trim(); });
    course.time = course.period;
    await onSave(course);
    setEditing(null);
  };

  return <section className="published-panel">
    <div className="published-head"><div><span className="status published"><CheckCircle2/>{majorLabel}专业学生端课表</span><h2>{majorLabel}专业现有课程</h2><p>版本 {version?.label || "—"}{version?.updated_at ? ` · 更新于 ${new Date(version.updated_at).toLocaleString("zh-CN")}` : ""}</p></div><label>搜索课程<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="课程、教师、日期或教室"/></label></div>
    {visible.length ? <div className="course-review-list published-list">{visible.map((course, index) => <article key={course.id}><i className={`type-${course.course_type}`}/><div><small>{course.date} · {course.weekday} · {course.period} {course.start_time}–{course.end_time}</small><h3>{course.course_name}</h3><p>{course.teacher || "教师未填写"}{course.classroom ? ` · ${course.classroom}` : ""}{course.remark ? ` · ${course.remark}` : ""}</p></div><span>#{index + 1}</span><button disabled={busy} onClick={() => setEditing(course)}><Pencil/>调课/编辑</button><button disabled={busy} className="icon-danger" onClick={() => onDelete(course)}><Trash2/>删除</button></article>)}</div> : <div className="published-empty"><CalendarDays/><h3>{courses.length ? "没有符合条件的课程" : "当前还没有已发布课程"}</h3><p>{courses.length ? "请更换搜索关键词" : "请进入“PDF 上传与审核”发布课程"}</p></div>}
    {editing && <div className="editor-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}><form className="course-editor" onSubmit={submit}><button type="button" className="editor-close" onClick={() => setEditing(null)}><X/></button><em>PUBLISHED COURSE</em><h2>调整现有课程</h2><p className="editor-tip">保存后学生端会立即读取新的课程安排，并自动生成新版本。</p><div>{fields.map(([key, label]) => <label key={key} className={key === "course_name" || key === "remark" ? "wide" : ""}>{label}{key === "course_type" ? <select name={key} defaultValue={editing[key] || "other"}><option value="tax">税务课程</option><option value="english">英语课程</option><option value="digital">人工智能/数字经济</option><option value="other">其他</option></select> : <input name={key} defaultValue={editing[key] || ""} required={["date", "weekday", "period", "start_time", "end_time", "course_name"].includes(key)}/>}</label>)}</div><button className="save-course" disabled={busy}>{busy ? "正在保存…" : "保存并更新学生端"}</button></form></div>}
  </section>;
}

function CourseReview({ upload, onSave, onDelete }) {
  const [editing, setEditing] = useState(null);
  const fields = [["date", "日期"], ["weekday", "星期"], ["period", "时段"], ["start_time", "开始"], ["end_time", "结束"], ["course_name", "课程名称"], ["teacher", "教师"], ["class_name", "班级"], ["classroom", "教室"], ["remark", "备注"], ["course_type", "类型"]];
  const submit = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const course = { ...editing }; fields.forEach(([key]) => { course[key] = String(form.get(key) || "").trim(); }); course.time = course.period; await onSave(upload.id, course); setEditing(null); };
  return <><div className="course-review-list">{upload.drafts?.map((course, index) => <article key={course.id}><i className={`type-${course.course_type}`}/><div><small>{course.date} · {course.weekday} · {course.period} {course.start_time}–{course.end_time}</small><h3>{course.course_name}</h3><p>{course.teacher || "教师未填写"}{course.classroom ? ` · ${course.classroom}` : ""}{course.remark ? ` · ${course.remark}` : ""}</p></div><span>#{index + 1}</span><button onClick={() => setEditing(course)}><Pencil/>编辑</button><button className="icon-danger" onClick={() => onDelete(upload.id, course.id)}><Trash2/>删除</button></article>)}</div>{editing && <div className="editor-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}><form className="course-editor" onSubmit={submit}><button type="button" className="editor-close" onClick={() => setEditing(null)}><X/></button><em>COURSE REVIEW</em><h2>校对课程信息</h2><div>{fields.map(([key, label]) => <label key={key} className={key === "course_name" || key === "remark" ? "wide" : ""}>{label}{key === "course_type" ? <select name={key} defaultValue={editing[key] || "other"}><option value="tax">税务课程</option><option value="english">英语课程</option><option value="digital">人工智能/数字经济</option><option value="other">其他</option></select> : <input name={key} defaultValue={editing[key] || ""} required={["date", "weekday", "period", "start_time", "end_time", "course_name"].includes(key)}/>}</label>)}</div><button className="save-course">保存修改</button></form></div>}</>;
}

function AnalyticsPanel() {
  const [range, setRange] = useState(7);
  const [data, setData] = useState(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true); setError("");
    try {
      const result = await api(`/api/admin/analytics?days=${range}`);
      setData(result);
      setSelectedDate((current) => result.days?.some((item) => item.date === current) ? current : result.days?.at(-1)?.date || "");
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [range]);
  const days = data?.days || [];
  const selected = days.find((item) => item.date === selectedDate) || days.at(-1) || { hours: [], devices: [], views: 0, visitors: 0 };
  const maxDaily = Math.max(1, ...days.map((item) => item.visitors));
  const maxHourly = Math.max(1, ...(selected.hours || []).map((item) => item.visitors));
  const deviceTotal = Math.max(1, ...(selected.devices || []).map(() => 0), (selected.devices || []).reduce((sum, item) => sum + item.visitors, 0));
  const summary = data?.summary || { today_views: 0, today_visitors: 0, range_views: 0, range_visitors: 0, mobile_share: 0 };
  return <section className="analytics-panel">
    <div className="analytics-head"><div><span className="status published"><BarChart3/>北京时间统计</span><h2>网站访问概览</h2><p>人数按匿名设备去重；同一设备多次打开计为 1 人、多次访问。</p></div><div className="analytics-controls"><div>{[7,30,90].map((value) => <button key={value} className={range === value ? "active" : ""} onClick={() => setRange(value)}>近 {value} 天</button>)}</div><button className="analytics-refresh" disabled={loading} onClick={load}><RefreshCw className={loading ? "spinning" : ""}/>刷新</button></div></div>
    {error && <div className="analytics-error">{error}</div>}
    <div className="analytics-metrics"><article><span><Users/></span><div><small>今日访客</small><strong>{summary.today_visitors}<em>人</em></strong></div></article><article><span><Eye/></span><div><small>今日访问</small><strong>{summary.today_views}<em>次</em></strong></div></article><article><span><BarChart3/></span><div><small>近 {range} 天访客</small><strong>{summary.range_visitors}<em>人</em></strong><p>{summary.range_views} 次访问</p></div></article><article><span><Smartphone/></span><div><small>移动端占比</small><strong>{summary.mobile_share}<em>%</em></strong><p>iOS、Android、HarmonyOS</p></div></article></div>
    <div className="analytics-card daily-card"><header><div><small>DAILY VISITORS</small><h3>每日访问人数</h3></div><span>点击柱形可查看当天每小时数据</span></header><div className="daily-chart-scroll"><div className={`daily-chart range-${range}`}>{days.map((item, index) => <button key={item.date} className={selected.date === item.date ? "active" : ""} onClick={() => setSelectedDate(item.date)} title={`${item.date}：${item.visitors} 人，${item.views} 次`}><b>{item.visitors || ""}</b><i><span style={{height:`${item.visitors ? Math.max(8,item.visitors/maxDaily*100) : 2}%`}}/></i><small>{range <= 7 || index % (range === 30 ? 3 : 7) === 0 ? item.date.slice(5).replace("-","/") : ""}</small></button>)}</div></div></div>
    <div className="analytics-detail-grid"><div className="analytics-card hourly-card"><header><div><small>HOURLY TRAFFIC</small><h3>{selected.date || "今日"} · 每小时人数</h3></div><label>选择日期<select value={selected.date || ""} onChange={(event) => setSelectedDate(event.target.value)}>{days.map((item) => <option key={item.date} value={item.date}>{item.date} · {item.visitors} 人</option>)}</select></label></header><div className="hour-chart-scroll"><div className="hour-chart">{(selected.hours || []).map((item) => <article key={item.hour} title={`${item.hour}:00：${item.visitors} 人，${item.views} 次`}><b>{item.visitors || ""}</b><i><span style={{height:`${item.visitors ? Math.max(8,item.visitors/maxHourly*100) : 2}%`}}/></i><small>{item.hour}</small></article>)}</div></div><footer>所选日期共 {selected.visitors || 0} 人、{selected.views || 0} 次访问</footer></div>
      <div className="analytics-card device-card"><header><div><small>DEVICE SYSTEM</small><h3>{selected.date || "今日"} · 访问设备</h3></div></header>{selected.devices?.length ? <div className="device-list">{selected.devices.map((item) => <article key={item.name}><span className={`device-dot device-${item.name.toLowerCase()}`}/><div><strong>{item.name}</strong><small>{item.visitors} 人 · {item.views} 次</small></div><b>{Math.round(item.visitors/deviceTotal*100)}%</b><i><span style={{width:`${item.visitors/deviceTotal*100}%`}}/></i></article>)}</div> : <div className="analytics-empty"><Smartphone/><p>当天还没有设备访问记录</p></div>}</div>
    </div>
    <div className="analytics-privacy"><ShieldCheck/><span><strong>匿名统计</strong><small>系统不保存姓名、手机号和完整 IP；访客人数是按浏览器中的匿名设备标识估算，同一个人使用两台设备会算作两位访客。</small></span></div>
  </section>;
}

const MENU_LABELS = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐" };
const MENU_CATEGORIES = {
  breakfast: ["热菜", "中点", "主食", "西点", "饮料"],
  lunch: ["热菜", "免费汤", "炖汤", "主食", "面档", "饮品", "煎扒档", "饮料"],
  dinner: ["热菜", "免费汤", "主食", "面档", "煎扒档"],
};
const MENU_TEXT_ALIASES = {
  breakfast: { 热菜: ["热菜", "小菜"], 中点: ["中点"], 主食: ["主食"], 西点: ["西点"], 饮料: ["饮料", "水果/饮料", "水果"] },
  lunch: { 热菜: ["热菜"], 免费汤: ["免费汤", "快汤"], 炖汤: ["炖汤", "炖罐汤"], 主食: ["主食"], 面档: ["面档"], 饮品: ["饮品", "佐品"], 煎扒档: ["煎扒档"], 饮料: ["饮料", "水果/饮料", "水果"] },
  dinner: { 热菜: ["热菜"], 免费汤: ["免费汤", "快汤", "炖汤", "炖罐汤"], 主食: ["主食"], 面档: ["面档"], 煎扒档: ["煎扒档"] },
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const dateIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function currentMonday() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const map = Object.fromEntries(parts.map((part) => [part.type, part.value])); const date = new Date(`${map.year}-${map.month}-${map.day}T12:00:00`); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return dateIso(date); }
function blankMeals() { return Object.fromEntries(Object.entries(MENU_CATEGORIES).map(([meal, categories]) => [meal, Object.fromEntries(categories.map((category) => [category, []]))])); }
function blankMenu(weekStart) { const monday = new Date(`${weekStart}T12:00:00`); const weekdays = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]; return { week_start: weekStart, days: weekdays.map((weekday, index) => { const date = new Date(monday); date.setDate(date.getDate() + index); return { date: dateIso(date), weekday, meals: blankMeals() }; }) }; }
function parseQuickMenuText(source, meal) {
  const result = Object.fromEntries(MENU_CATEGORIES[meal].map((category) => [category, []]));
  const aliases = Object.entries(MENU_TEXT_ALIASES[meal]).flatMap(([category, names]) => names.map((name) => ({ category, name }))).sort((a, b) => b.name.length - a.name.length);
  const found = new Set(); let current = null; let ignored = 0;
  const addItems = (category, value) => String(value || "").split(/、|，|,|；|;|\t|\s{2,}/).map((item) => item.replace(/^\s*(?:[-•·]|(?:\d+|[①-⑳])[.、)）])\s*/, "").trim()).filter(Boolean).forEach((item) => { if (!result[category].includes(item)) result[category].push(item); });
  for (const rawLine of String(source || "").split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[【\[]|[】\]]$/g, ""); if (!line) continue;
    const match = aliases.find(({ name }) => line === name || line.startsWith(`${name}：`) || line.startsWith(`${name}:`) || new RegExp(`^${name}\\s+`).test(line));
    if (match) { current = match.category; found.add(current); addItems(current, line.slice(match.name.length).replace(/^\s*[:：]\s*/, "")); }
    else if (current) addItems(current, line); else ignored += 1;
  }
  return { categories: result, found: [...found], ignored, count: Object.values(result).reduce((sum, items) => sum + items.length, 0) };
}

function MenuManager({ busy, setBusy, setProgress, setProgressLabel, setNotice }) {
  const [uploads, setUploads] = useState([]);
  const [live, setLive] = useState(null);
  const [version, setVersion] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [mode, setMode] = useState("review");
  const [weekStart, setWeekStart] = useState(currentMonday);
  const fileRef = useRef(null);
  const active = uploads.find((item) => item.id === activeId) || uploads[0] || null;

  const load = async () => {
    const [menuData, uploadData] = await Promise.all([api("/api/admin/menu"), api("/api/admin/menu-uploads")]);
    setLive(menuData.menu || null); setVersion(menuData.version || null); setUploads(uploadData.uploads || []);
    setActiveId((current) => uploadData.uploads?.some((item) => item.id === current) ? current : uploadData.uploads?.[0]?.id || null);
  };
  useEffect(() => { load().catch((error) => setNotice(error.message)); }, []);

  const uploadImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setNotice("请选择 JPG 或 PNG 菜单图片；iPhone 的 HEIC 图片请先存为照片或截图后上传"); return; }
    setBusy(true); setProgress(1); setProgressLabel("正在准备菜单图片"); setNotice("正在自动旋转并识别表格小字，请保持页面打开…");
    try {
      const parser = await import("./menu-parser.js");
      let result = null;
      let cloudMessage = "";
      try {
        setProgress(8); setProgressLabel("正在调用腾讯云表格识别 V3");
        const imageBase64 = await parser.imageFileToBase64(file);
        const cloud = await api("/api/admin/menu-ocr", { method: "POST", body: JSON.stringify({ image_base64: imageBase64 }) });
        if (cloud.configured) {
          setProgress(86);
          result = parser.parseTencentMenuTables(cloud.table_detections, weekStart);
        } else cloudMessage = "腾讯云 OCR 尚未配置，已自动改用本机基础识别。";
      } catch (error) { cloudMessage = `腾讯云表格识别未成功（${error.message}），已自动改用本机基础识别。`; }
      if (!result) {
        setProgressLabel("正在使用本机中文 OCR 备用识别");
        result = await parser.parseMenuImage(file, weekStart, setProgress);
        result.warnings = [cloudMessage, ...(result.warnings || [])].filter(Boolean);
      }
      const record = await api("/api/admin/menu-uploads", { method: "POST", body: JSON.stringify({ filename: file.name, menu: result.menu, warnings: result.warnings, recognized_lines: result.recognized_lines }) });
      await load(); setActiveId(record.upload.id); setMode("review");
      setNotice(`${result.engine === "tencent-table-v3" ? "腾讯云表格识别完成" : "本机初步识别完成"}：提取到 ${result.recognized_lines} 行内容，请逐日校对后发布。`);
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); setProgress(0); if (fileRef.current) fileRef.current.value = ""; }
  };

  const createTextMenu = async () => {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(weekStart)) return setNotice("请先选择菜单所属周的星期一日期");
    setBusy(true); setNotice("");
    try {
      const record = await api("/api/admin/menu-uploads", { method: "POST", body: JSON.stringify({ filename: `文字录入菜单-${weekStart}`, menu: blankMenu(weekStart), warnings: ["本记录由管理员手工创建，请录入并检查星期一至星期日的菜单后再发布。"], recognized_lines: 0 }) });
      await load(); setActiveId(record.upload.id); setMode("review"); setNotice("已新建空白一周菜单，请选择日期和餐次后快速录入");
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };

  const saveDraft = async (menu) => {
    if (!active) return;
    setBusy(true);
    try { await api(`/api/admin/menu-uploads/${encodeURIComponent(active.id)}`, { method: "PATCH", body: JSON.stringify({ menu }) }); await load(); setNotice("待审核菜单已保存"); }
    catch (error) { setNotice(error.message); throw error; }
    finally { setBusy(false); }
  };
  const saveLive = async (menu) => {
    setBusy(true);
    try { const data = await api("/api/admin/menu", { method: "PATCH", body: JSON.stringify({ menu }) }); await load(); setNotice(`学生端菜单已更新，当前版本 ${data.version.label}`); }
    catch (error) { setNotice(error.message); throw error; }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (!active || !window.confirm(`确认发布“${active.filename}”识别出的菜单？发布后学生端立即更新。`)) return;
    setBusy(true);
    try { const data = await api("/api/admin/menu-publish", { method: "POST", body: JSON.stringify({ upload_id: active.id }) }); await load(); setMode("live"); setNotice(`菜单发布成功，当前版本 ${data.version.label}`); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!active || !window.confirm("确定删除这条菜单图片识别记录吗？已发布的菜单不会受影响。")) return;
    setBusy(true);
    try { await api(`/api/admin/menu-uploads/${encodeURIComponent(active.id)}`, { method: "DELETE" }); await load(); setNotice("菜单上传记录已删除"); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };

  return <section className="menu-admin-panel">
    <div className="menu-upload-hero"><div className="menu-upload-icon"><FileImage/></div><div><small>MENU INPUT</small><h2>录入一周菜单</h2><p>可以上传图片识别，也可以新建文字菜单后批量粘贴，发布前都能继续修改。</p></div><label className="menu-week">菜单所属周（星期一）<input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)}/></label><div className="menu-create-actions"><button type="button" className="text-menu-button" disabled={busy} onClick={createTextMenu}><FileText/>新建文字菜单</button><label className={`upload-button ${busy ? "disabled" : ""}`}><UploadCloud/>上传图片识别<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={uploadImage}/></label></div></div>
    <nav className="menu-admin-tabs"><button className={mode === "review" ? "active" : ""} onClick={() => setMode("review")}><Pencil/>识别与审核 <span>{uploads.length}</span></button><button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}><Soup/>学生端现有菜单</button></nav>
    {mode === "review" ? <div className="menu-review-layout"><aside className="menu-upload-list">{uploads.length ? uploads.map((upload) => <button className={(active?.id === upload.id) ? "active" : ""} key={upload.id} onClick={() => setActiveId(upload.id)}><FileImage/><span><strong>{upload.filename}</strong><small>{upload.menu?.week_start} · 识别 {upload.recognized_lines || 0} 行</small></span><em className={upload.status}>{upload.status === "published" ? "已发布" : "待审核"}</em></button>) : <div><FileImage/><p>还没有菜单识别记录</p></div>}</aside><div className="menu-review-main">{active ? <><div className="menu-review-head"><div><span className={`status ${active.status}`}>{active.status === "published" ? <CheckCircle2/> : <Pencil/>}{active.status === "published" ? "已发布记录" : "待审核"}</span><h2>{active.filename}</h2><p>{active.menu?.week_start} 开始的一周 · 自动识别 {active.recognized_lines || 0} 行</p></div><div><button className="danger" disabled={busy} onClick={remove}><Trash2/>删除记录</button><button className="publish" disabled={busy} onClick={publish}><CheckCircle2/>确认发布</button></div></div>{active.warnings?.length > 0 && <div className="parse-warnings">{active.warnings.map((warning, index) => <p key={index}>• {warning}</p>)}</div>}<MenuEditor key={`${active.id}-${active.uploaded_at}`} menu={active.menu} busy={busy} onSave={saveDraft} saveLabel="保存审核修改"/></> : <div className="menu-admin-empty"><Soup/><h3>上传菜单图片后在这里校对</h3><p>自动识别不会直接覆盖学生端，确认发布后才会生效。</p></div>}</div></div> : live ? <div className="menu-live-panel"><div className="menu-live-head"><div><span className="status published"><CheckCircle2/>学生端正在使用</span><h2>{live.week_start} 开始的一周菜单</h2><p>版本 {version?.label || "—"}{version?.updated_at ? ` · ${new Date(version.updated_at).toLocaleString("zh-CN")}` : ""}</p></div></div><MenuEditor key={`live-${version?.label}`} menu={live} busy={busy} onSave={saveLive} saveLabel="保存并立即更新学生端"/></div> : <div className="menu-admin-empty standalone"><Soup/><h3>学生端暂无已发布菜单</h3><p>请先上传菜单图片，校对后确认发布。</p></div>}
  </section>;
}

function MenuEditor({ menu, busy, onSave, saveLabel }) {
  const [draft, setDraft] = useState(() => clone(menu));
  const [dayIndex, setDayIndex] = useState(0);
  const [meal, setMeal] = useState("breakfast");
  const [saving, setSaving] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [quickMessage, setQuickMessage] = useState("");
  useEffect(() => { setDraft(clone(menu)); setDayIndex(0); setMeal("breakfast"); setQuickText(""); setQuickMessage(""); }, [menu]);
  useEffect(() => { setQuickText(""); setQuickMessage(""); }, [dayIndex, meal]);
  const day = draft.days[dayIndex];
  const categories = MENU_CATEGORIES[meal];
  const changeItems = (category, updater) => { const next = clone(draft); const current = next.days[dayIndex].meals[meal][category] || []; next.days[dayIndex].meals[meal][category] = updater(current); setDraft(next); };
  const updateItem = (category, itemIndex, value) => changeItems(category, (items) => items.map((item, index) => index === itemIndex ? value : item));
  const addItem = (category) => changeItems(category, (items) => [...items, ""]);
  const removeItem = (category, itemIndex) => changeItems(category, (items) => items.filter((_, index) => index !== itemIndex));
  const applyQuickText = () => {
    const parsed = parseQuickMenuText(quickText, meal);
    if (!parsed.found.length) { setQuickMessage(`未识别到分类，请使用“${categories.join("、")}”作为标题`); return; }
    const next = clone(draft);
    parsed.found.forEach((category) => { next.days[dayIndex].meals[meal][category] = parsed.categories[category]; });
    setDraft(next); setQuickMessage(`已识别 ${parsed.found.length} 个分类、${parsed.count} 道菜${parsed.ignored ? `，忽略 ${parsed.ignored} 行标题前文字` : ""}`);
  };
  const clearMeal = () => { if (!window.confirm(`确定清空${day.weekday}${MENU_LABELS[meal]}的全部菜品吗？`)) return; const next = clone(draft); categories.forEach((category) => { next.days[dayIndex].meals[meal][category] = []; }); setDraft(next); setQuickMessage("当前餐次已清空，保存后生效"); };
  const submit = async () => { const cleaned = clone(draft); cleaned.days.forEach((item) => Object.values(item.meals).forEach((mealData) => Object.keys(mealData).forEach((category) => { mealData[category] = mealData[category].map((dish) => String(dish).trim()).filter(Boolean); }))); setSaving(true); try { await onSave(cleaned); setDraft(cleaned); } finally { setSaving(false); } };
  return <div className="menu-editor">
    <div className="menu-day-tabs">{draft.days.map((item, index) => <button key={item.date || index} className={dayIndex === index ? "active" : ""} onClick={() => setDayIndex(index)}><small>{item.weekday?.replace("星期", "周")}</small><strong>{item.date?.slice(5).replace("-", "/")}</strong></button>)}</div>
    <label className="menu-admin-day-select"><span>选择本周日期</span><select value={dayIndex} onChange={(event) => setDayIndex(Number(event.target.value))}>{draft.days.map((item, index) => <option key={item.date || index} value={index}>{item.weekday} · {item.date?.slice(5).replace("-", "月")}日</option>)}</select></label>
    <div className="menu-editor-toolbar"><div className="menu-current-day"><small>当前编辑</small><strong>{day.weekday} · {day.date?.replaceAll("-", ".")}</strong></div><div>{Object.entries(MENU_LABELS).map(([key, label]) => <button key={key} className={meal === key ? "active" : ""} onClick={() => setMeal(key)}>{label}</button>)}</div></div>
    <section className="menu-quick-entry"><div><small>QUICK INPUT</small><h3>文字自动分组</h3><p>先写分类标题，再逐行输入菜名；也支持用顿号或逗号分隔。只替换识别到的分类。</p></div><textarea value={quickText} onChange={(event) => setQuickText(event.target.value)} placeholder={`${categories[0]}：\n宫保鸡丁\n清蒸鱼\n\n${categories[1]}：\n请在这里继续输入`}/><div className="menu-quick-actions"><span>{quickMessage || `可识别：${categories.join("、")}`}</span><button type="button" className="clear" onClick={clearMeal}>清空当前餐次</button><button type="button" disabled={!quickText.trim()} onClick={applyQuickText}>自动识别并填入</button></div></section>
    <div className="menu-category-editor">{categories.map((category, index) => { const items = day.meals?.[meal]?.[category] || []; return <article key={category} className={index % 2 ? "alternate" : ""}><header><span><i>{String(index + 1).padStart(2, "0")}</i><strong>{category}</strong></span><button type="button" onClick={() => addItem(category)}>＋ 添加菜品</button></header>{items.length ? <div className="menu-item-input-grid">{items.map((item, itemIndex) => <label key={`${category}-${itemIndex}`}><span>{String(itemIndex + 1).padStart(2, "0")}</span><input value={item} onChange={(event) => updateItem(category, itemIndex, event.target.value)} placeholder="输入菜名"/><button type="button" aria-label={`删除${item || "菜品"}`} onClick={() => removeItem(category, itemIndex)}><X/></button></label>)}</div> : <button type="button" className="menu-no-item" onClick={() => addItem(category)}>本分类暂无菜品，点击添加</button>}</article>; })}</div>
    <button className="menu-save" disabled={busy || saving} onClick={submit}>{saving ? "正在保存…" : saveLabel}</button>
  </div>;
}
