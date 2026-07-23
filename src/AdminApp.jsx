import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, CalendarDays, CheckCircle2, Eye, FileImage, FileText, LogOut, Pencil, RefreshCw, ShieldCheck, Smartphone, Soup, Sparkles, Trash2, UploadCloud, Users, UtensilsCrossed, X } from "lucide-react";

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

function notifyStudentMenuUpdated(version) {
  const value = `${version?.label || "updated"}-${Date.now()}`;
  try { localStorage.setItem("xnai_menu_updated", value); } catch {}
  try { window.opener?.postMessage({ type: "xnai-menu-updated", version: version?.label }, window.location.origin); } catch {}
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
  const sectionMeta = section === "menu"
    ? { eyebrow: "DINING MANAGEMENT", title: "一周菜单管理", description: "上传食堂一周菜单图片，自动识别并校对后发布到学生端。" }
    : section === "analytics"
      ? { eyebrow: "VISITOR ANALYTICS", title: "访问指标分析", description: "按北京时间查看每日、每小时和设备系统的匿名访问情况。" }
      : section === "users"
        ? { eyebrow: "DEVICE & BEHAVIOR", title: "用户管理与行为分析", description: "按匿名设备码查看设备信息、关键功能使用情况和历史访问轨迹。" }
        : { eyebrow: "COURSE MANAGEMENT", title: `${MAJORS.find((item) => item.id === major)?.label}专业课程管理`, description: "各专业课程独立保存，上传和调课只影响当前选择的专业。" };

  return <div className="admin-shell">
    <header className="admin-topbar"><a href="/"><ArrowLeft size={18}/>返回学生端</a><div><ShieldCheck/><span><strong>厦国会专硕课程助手</strong><small>管理员控制台 · 腾讯云 EdgeOne</small></span></div><button onClick={logout}><LogOut size={17}/>退出登录</button></header>
    <main className="admin-main">
      <section className="admin-heading"><div><em>{sectionMeta.eyebrow}</em><h1>{sectionMeta.title}</h1><p>{sectionMeta.description}</p></div>{!['menu','analytics','users'].includes(section) && <div className="admin-heading-actions"><label className="major-select">管理专业<select value={major} onChange={(event) => { setMajor(event.target.value); setNotice(""); }} disabled={busy}>{MAJORS.map((item) => <option key={item.id} value={item.id}>{item.label}专业</option>)}</select></label>{section === "uploads" && <label className={`upload-button ${busy ? "disabled" : ""}`}><UploadCloud/>上传课程 PDF<input ref={fileRef} type="file" accept="application/pdf,.pdf" disabled={busy} onChange={uploadPdf}/></label>}</div>}</section>
      <nav className="admin-tabs"><button className={section === "published" ? "active" : ""} onClick={() => setSection("published")}><CalendarDays/>现有课程 <span>{courses.length}</span></button><button className={section === "uploads" ? "active" : ""} onClick={() => setSection("uploads")}><UploadCloud/>PDF 上传与审核 <span>{uploads.length}</span></button><button className={section === "menu" ? "active" : ""} onClick={() => setSection("menu")}><UtensilsCrossed/>今日菜单</button><button className={section === "analytics" ? "active" : ""} onClick={() => setSection("analytics")}><BarChart3/>指标分析</button><button className={section === "users" ? "active" : ""} onClick={() => setSection("users")}><Users/>用户管理</button></nav>
      {busy && progress > 0 && <div className="parse-progress"><span style={{ width: `${progress}%` }}/><b>{progress}%</b><small>{progressLabel}</small></div>}
      {notice && <div className="admin-notice">{notice}<button onClick={() => setNotice("")}><X size={16}/></button></div>}
      {section === "users" ? <UserManagementPanel/> : section === "analytics" ? <AnalyticsPanel/> : section === "menu" ? <MenuManager busy={busy} setBusy={setBusy} setProgress={setProgress} setProgressLabel={setProgressLabel} setNotice={setNotice}/> : section === "published" ? <PublishedCourses majorLabel={MAJORS.find((item) => item.id === major)?.label} courses={courses} version={version} busy={busy} onSave={savePublishedCourse} onDelete={deletePublishedCourse}/> : <div className="admin-workspace">
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

const beijingTime = (value, short = false) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    ...(short ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value)).replaceAll("/", "-");
};

function UserManagementPanel() {
  const [devices, setDevices] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [range, setRange] = useState(7);
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState(null);
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true); setError("");
    try {
      const [deviceData, dashboardData] = await Promise.all([api("/api/admin/devices"), api(`/api/admin/user-analytics?days=${range}`)]);
      setDevices(deviceData.devices || []); setDashboard(dashboardData);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [range]);
  const openDetails = async (deviceId) => {
    setLoading(true); setError("");
    try { const data = await api(`/api/admin/devices/${encodeURIComponent(deviceId)}`); setDetails(data); setRemark(data.device?.remark || ""); }
    catch (detailError) { setError(detailError.message); }
    finally { setLoading(false); }
  };
  const saveRemark = async () => {
    if (!details?.device) return;
    setLoading(true);
    try {
      const data = await api(`/api/admin/devices/${encodeURIComponent(details.device.device_id)}`, { method: "PATCH", body: JSON.stringify({ remark }) });
      setDetails((current) => ({ ...current, device: data.device }));
      setDevices((current) => current.map((item) => item.device_id === data.device.device_id ? data.device : item));
    } catch (saveError) { setError(saveError.message); }
    finally { setLoading(false); }
  };
  const deleteDevice = async (device) => {
    if (!window.confirm(`确定删除设备 ${device.device_id} 及其全部行为记录吗？此操作无法恢复。`)) return;
    setLoading(true);
    try { await api(`/api/admin/devices/${encodeURIComponent(device.device_id)}`, { method: "DELETE" }); setDetails(null); await load(); }
    catch (deleteError) { setError(deleteError.message); setLoading(false); }
  };
  const keyword = query.trim().toLowerCase();
  const visible = devices.filter((item) => !keyword || [item.device_id, item.device_name, item.device_type, item.system, item.browser, item.remark].some((value) => String(value || "").toLowerCase().includes(keyword)));
  const summary = dashboard?.summary || { total_devices: 0, today_active: 0, week_active: 0, range_actions: 0 };
  const daily = dashboard?.daily || [];
  const maxDaily = Math.max(1, ...daily.map((item) => item.actions));
  const maxRank = Math.max(1, ...(dashboard?.page_ranking || []).map((item) => item.count), ...(dashboard?.action_ranking || []).map((item) => item.count));
  const deviceIcon = (device) => device.device_type === "手机" ? "📱" : device.device_type === "平板" ? "▣" : device.device_type === "电脑" ? "💻" : "◈";
  return <section className="user-management">
    <div className="user-toolbar"><div><span className="status published"><ShieldCheck/>匿名设备分析</span><h2>设备与行为概览</h2><p>设备码由浏览器本地匿名标识生成，不保存姓名、手机号和完整 IP。</p></div><div className="user-toolbar-actions"><div>{[7,30,90].map((value) => <button key={value} className={range === value ? "active" : ""} onClick={() => setRange(value)}>近{value}天</button>)}</div><button disabled={loading} onClick={load}><RefreshCw className={loading ? "spinning" : ""}/>刷新</button></div></div>
    {error && <div className="analytics-error">{error}</div>}
    <div className="user-metrics"><article><small>总设备数量</small><strong>{summary.total_devices}<em>台</em></strong><p>已生成匿名设备码</p></article><article><small>今日活跃设备</small><strong>{summary.today_active}<em>台</em></strong><p>北京时间今日访问</p></article><article><small>本周活跃设备</small><strong>{summary.week_active}<em>台</em></strong><p>最近7天内活跃</p></article><article><small>关键操作记录</small><strong>{summary.range_actions}<em>次</em></strong><p>近{range}天功能使用</p></article></div>
    <div className="behavior-dashboard"><div className="behavior-trend"><header><div><small>DAILY ACTIVITY</small><h3>每日行为趋势</h3></div><span>设备数 / 操作数</span></header><div>{daily.map((item) => <article key={item.date} title={`${item.date}：${item.devices}台设备，${item.actions}次操作`}><b>{item.actions || ""}</b><i><span style={{height:`${item.actions ? Math.max(8,item.actions/maxDaily*100) : 2}%`}}/></i><small>{item.date.slice(5).replace("-","/")}</small></article>)}</div></div><RankingCard title="页面访问排行" eyebrow="POPULAR PAGES" items={dashboard?.page_ranking || []} max={maxRank}/><RankingCard title="功能使用排行" eyebrow="TOP ACTIONS" items={dashboard?.action_ranking || []} max={maxRank}/></div>
    <div className="device-table-card"><header><div><small>DEVICE DIRECTORY</small><h3>设备列表</h3><p>共 {devices.length} 台设备，点击任意设备查看完整行为轨迹。</p></div><label>搜索设备<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="设备码、系统、浏览器或备注"/></label></header>{visible.length ? <><div className="device-table"><div className="device-table-head"><span>设备编号</span><span>设备类型</span><span>系统</span><span>浏览器</span><span>首次访问</span><span>最近访问</span><span>访问次数</span><span>操作</span></div>{visible.map((device) => <article key={device.device_id}><button className="device-code" onClick={() => openDetails(device.device_id)}><i>{deviceIcon(device)}</i><span><strong>{device.device_id}</strong><small>{device.remark || device.device_name}</small></span></button><span>{device.device_type}</span><span>{device.system}</span><span>{device.browser}</span><time>{beijingTime(device.first_visit_time)}</time><time>{beijingTime(device.last_visit_time)}</time><b>{device.visit_count}</b><div><button onClick={() => openDetails(device.device_id)}>查看详情</button><button className="delete" onClick={() => deleteDevice(device)}>删除</button></div></article>)}</div><div className="device-mobile-list">{visible.map((device) => <article key={device.device_id}><button onClick={() => openDetails(device.device_id)}><i>{deviceIcon(device)}</i><span><strong>{device.device_id}</strong><small>{device.device_name} · {device.system} · {device.browser}</small><em>{device.remark || `最近 ${beijingTime(device.last_visit_time, true)}`}</em></span><b>{device.visit_count}次</b></button></article>)}</div></> : <div className="user-empty"><Users/><h3>{devices.length ? "没有匹配的设备" : "还没有设备记录"}</h3><p>{devices.length ? "请更换搜索关键词" : "学生端产生新的访问后会自动出现在这里。"}</p></div>}</div>
    {details && <div className="device-detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDetails(null)}><section className="device-detail"><button className="editor-close" onClick={() => setDetails(null)}><X/></button><header><span>{deviceIcon(details.device)}</span><div><small>DEVICE PROFILE</small><h2>{details.device.device_id}</h2><p>{details.device.device_name} · {details.device.system} · {details.device.browser}</p></div></header><div className="device-basic-grid"><article><small>设备类型</small><strong>{details.device.device_type}</strong></article><article><small>屏幕尺寸</small><strong>{details.device.screen_size || "未获取"}</strong></article><article><small>首次访问</small><strong>{beijingTime(details.device.first_visit_time)}</strong></article><article><small>最近访问</small><strong>{beijingTime(details.device.last_visit_time)}</strong></article></div><div className="device-stat-grid"><article><small>累计访问</small><strong>{details.device.visit_count}<em>次</em></strong></article><article><small>行为记录</small><strong>{details.statistics.action_count}<em>条</em></strong></article><article><small>最常访问页面</small><strong>{details.statistics.favorite_page}</strong></article><article><small>最常操作</small><strong>{details.statistics.favorite_action}</strong></article></div><div className="device-remark"><label>管理员备注<input value={remark} onChange={(event) => setRemark(event.target.value)} maxLength={200} placeholder="例如：经常查看菜单的 iPhone"/></label><button disabled={loading} onClick={saveRemark}>保存备注</button></div><div className="device-log"><header><h3>历史访问记录</h3><span>最近 {details.logs.length} 条</span></header>{details.logs.length ? <div><div className="device-log-head"><span>时间</span><span>页面</span><span>操作</span></div>{details.logs.map((log) => <article key={log.id}><time>{beijingTime(log.create_time)}</time><strong>{log.page_name}</strong><p><b>{log.action_type}</b>{log.action_detail && <span>{log.action_detail}</span>}</p></article>)}</div> : <p className="no-log">暂无行为记录</p>}</div><button className="delete-device" onClick={() => deleteDevice(details.device)}><Trash2/>删除该设备及全部记录</button></section></div>}
  </section>;
}

function RankingCard({ title, eyebrow, items, max }) {
  return <div className="behavior-ranking"><header><small>{eyebrow}</small><h3>{title}</h3></header>{items.length ? <div>{items.map((item, index) => <article key={item.name}><i>{index + 1}</i><span><strong>{item.name}</strong><em><b style={{width:`${item.count/max*100}%`}}/></em></span><small>{item.count}次</small></article>)}</div> : <p>暂无数据</p>}</div>;
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

const WEEKDAY_NUMBERS = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };
const MEAL_KEYS = { 早餐: "breakfast", 午餐: "lunch", 晚餐: "dinner", 晚饭: "dinner" };
const OPTIONAL_MENU_CATEGORIES = new Set(["lunch:炖汤", "lunch:饮品"]);
const REQUIRED_MENU_COUNTS = { lunch: { 热菜: 8, 免费汤: 1, 面档: 1 }, dinner: { 热菜: 8, 免费汤: 1, 面档: 1 } };
const DINNER_SHARED_CATEGORIES = new Set(["热菜", "免费汤", "主食", "面档", "煎扒档"]);
const historyMeal = (meal, category) => meal === "dinner" && DINNER_SHARED_CATEGORIES.has(category) ? "lunch" : meal;
const cleanImportLine = (value) => String(value || "").replace(/[*#`]/g, "").replace(/^\s*(?:[-•·]|(?:\d+|[①-⑳])[.、)）])\s*/, "").trim();
const splitDishItems = (value) => String(value || "").split(/、|，|,|；|;|\t|\s{2,}/).map(cleanImportLine).filter(Boolean);
function categoryLineMatch(line, meal) {
  const aliases = Object.entries(MENU_TEXT_ALIASES[meal] || {}).flatMap(([category, names]) => names.map((name) => ({ category, name }))).sort((a, b) => b.name.length - a.name.length);
  return aliases.find(({ name }) => line === name || line.startsWith(`${name}：`) || line.startsWith(`${name}:`) || new RegExp(`^${name}\\s+`).test(line)) || null;
}
function parseWholeWeekText(source, baseMenu) {
  const menu = blankMenu(baseMenu.week_start); let dayIndex = -1, meal = null, category = null, ignored = 0, count = 0;
  for (const rawLine of String(source || "").split(/\r?\n/)) {
    let line = cleanImportLine(rawLine); if (!line) continue;
    const dayMatch = line.match(/星期\s*([一二三四五六日天])/);
    if (dayMatch) { dayIndex = WEEKDAY_NUMBERS[dayMatch[1]]; meal = null; category = null; line = cleanImportLine(line.replace(dayMatch[0], "")); if (!line) continue; }
    const mealMatch = line.match(/^(早餐|午餐|晚餐|晚饭)(?:\s*[:：])?/);
    if (mealMatch) { meal = MEAL_KEYS[mealMatch[1]]; category = null; line = cleanImportLine(line.slice(mealMatch[0].length)); if (!line) continue; }
    if (dayIndex < 0 || !meal) { ignored += 1; continue; }
    const categoryMatch = categoryLineMatch(line.replace(/^[【\[]|[】\]]$/g, ""), meal);
    if (categoryMatch) {
      category = categoryMatch.category;
      const items = splitDishItems(line.slice(categoryMatch.name.length).replace(/^\s*[:：]\s*/, ""));
      for (const item of items) if (!menu.days[dayIndex].meals[meal][category].includes(item)) { menu.days[dayIndex].meals[meal][category].push(item); count += 1; }
    } else if (category) {
      const items = splitDishItems(line);
      for (const item of items) if (!menu.days[dayIndex].meals[meal][category].includes(item)) { menu.days[dayIndex].meals[meal][category].push(item); count += 1; }
    } else ignored += 1;
  }
  const populatedDays = menu.days.filter((day) => Object.values(day.meals).some((mealData) => Object.values(mealData).some((items) => items.length))).length;
  return { menu, count, populatedDays, ignored };
}
const normalizedDish = (value) => String(value || "").toLowerCase().replace(/[\s·•,，。；;：:、\/\\()（）【】\[\]“”"'‘’+-]/g, "");
function editDistance(left, right) {
  const a = [...left], b = [...right], row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) { let previous = row[0]; row[0] = i; for (let j = 1; j <= b.length; j += 1) { const saved = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = saved; } }
  return row[b.length];
}
function dishSimilarity(left, right) { const a = normalizedDish(left), b = normalizedDish(right); return !a || !b ? 0 : 1 - editDistance(a, b) / Math.max(a.length, b.length); }
function menuIntelligence(menu, dictionary) {
  const issues = []; let confirmed = 0, dishCount = 0, missing = 0, suggestions = 0, newItems = 0;
  for (let dayIndex = 0; dayIndex < menu.days.length; dayIndex += 1) for (const [meal, categories] of Object.entries(MENU_CATEGORIES)) for (const category of categories) {
    const items = menu.days[dayIndex]?.meals?.[meal]?.[category] || [];
    const expected = REQUIRED_MENU_COUNTS[meal]?.[category];
    if (expected && items.length !== expected) { missing += 1; issues.push({ key: `count-${dayIndex}-${meal}-${category}`, type: "count", dayIndex, meal, category, actual: items.length, expected }); if (!items.length) continue; }
    if (!items.length) { if (!OPTIONAL_MENU_CATEGORIES.has(`${meal}:${category}`)) { missing += 1; issues.push({ key: `empty-${dayIndex}-${meal}-${category}`, type: "missing", dayIndex, meal, category }); } continue; }
    const candidates = dictionary.filter((entry) => entry.meal === historyMeal(meal, category) && entry.category === category);
    items.forEach((item, itemIndex) => {
      dishCount += 1;
      if (/无法识别|看不清|未识别|\?{2,}|？{2,}/.test(item)) { missing += 1; issues.push({ key: `unknown-${dayIndex}-${meal}-${category}-${itemIndex}`, type: "unknown", dayIndex, meal, category, itemIndex, original: item }); return; }
      const normalized = normalizedDish(item);
      const canonical = candidates.find((entry) => normalizedDish(entry.name) === normalized);
      if (canonical) { confirmed += 1; return; }
      const alias = candidates.find((entry) => (entry.aliases || []).some((value) => normalizedDish(value) === normalized));
      if (alias) { suggestions += 1; issues.push({ key: `alias-${dayIndex}-${meal}-${category}-${itemIndex}`, type: "suggestion", dayIndex, meal, category, itemIndex, original: item, suggestion: alias.name, score: 1 }); return; }
      let best = null;
      for (const entry of candidates) { const score = Math.max(dishSimilarity(item, entry.name), ...(entry.aliases || []).map((value) => dishSimilarity(item, value)), 0); if (!best || score > best.score) best = { name: entry.name, score }; }
      if (best && best.score >= 0.72) { suggestions += 1; issues.push({ key: `fuzzy-${dayIndex}-${meal}-${category}-${itemIndex}`, type: "suggestion", dayIndex, meal, category, itemIndex, original: item, suggestion: best.name, score: best.score }); }
      else { newItems += 1; issues.push({ key: `new-${dayIndex}-${meal}-${category}-${itemIndex}`, type: "new", dayIndex, meal, category, itemIndex, original: item }); }
    });
  }
  return { dishCount, confirmed, missing, suggestions, newItems, issues };
}

function MenuManager({ busy, setBusy, setProgress, setProgressLabel, setNotice }) {
  const [uploads, setUploads] = useState([]);
  const [live, setLive] = useState(null);
  const [version, setVersion] = useState(null);
  const [dictionary, setDictionary] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [mode, setMode] = useState("review");
  const [weekStart, setWeekStart] = useState(currentMonday);
  const fileRef = useRef(null);
  const active = uploads.find((item) => item.id === activeId) || uploads[0] || null;

  const load = async () => {
    const [menuData, uploadData] = await Promise.all([api("/api/admin/menu"), api("/api/admin/menu-uploads")]);
    setLive(menuData.menu || null); setVersion(menuData.version || null); setDictionary(menuData.dictionary || []); setUploads(uploadData.uploads || []);
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

  const saveDraft = async (menu, captureSource = false) => {
    if (!active) return;
    setBusy(true);
    try { const result = await api(`/api/admin/menu-uploads/${encodeURIComponent(active.id)}`, { method: "PATCH", body: JSON.stringify({ menu, capture_source: captureSource }) }); await load(); setNotice(captureSource ? `整周菜单已导入${result.upload?.dictionary_corrections ? `，历史菜品库自动纠正 ${result.upload.dictionary_corrections} 处` : ""}` : "待审核菜单已保存"); }
    catch (error) { setNotice(error.message); throw error; }
    finally { setBusy(false); }
  };
  const saveLive = async (menu) => {
    setBusy(true);
    try { const data = await api("/api/admin/menu", { method: "PATCH", body: JSON.stringify({ menu }) }); notifyStudentMenuUpdated(data.version); await load(); setNotice(`学生端菜单已更新，当前版本 ${data.version.label}；已通知打开中的学生页面刷新`); }
    catch (error) { setNotice(error.message); throw error; }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (!active || !window.confirm(`确认发布“${active.filename}”识别出的菜单？发布后学生端立即更新。`)) return;
    setBusy(true);
    try { const data = await api("/api/admin/menu-publish", { method: "POST", body: JSON.stringify({ upload_id: active.id }) }); notifyStudentMenuUpdated(data.version); await load(); setMode("live"); setNotice(`菜单发布成功，当前版本 ${data.version.label}；学生端会立即刷新`); }
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
    <nav className="menu-admin-tabs"><button className={mode === "review" ? "active" : ""} onClick={() => setMode("review")}><Pencil/>识别与审核 <span>{uploads.length}</span></button><button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}><Soup/>学生端现有菜单</button><button className={mode === "dictionary" ? "active" : ""} onClick={() => setMode("dictionary")}><FileText/>历史菜品库 <span>{dictionary.length}</span></button></nav>
    {mode === "dictionary" ? <DishDictionary dictionary={dictionary}/> : mode === "review" ? <div className="menu-review-layout"><aside className="menu-upload-list">{uploads.length ? uploads.map((upload) => <button className={(active?.id === upload.id) ? "active" : ""} key={upload.id} onClick={() => setActiveId(upload.id)}><FileImage/><span><strong>{upload.filename}</strong><small>{upload.menu?.week_start} · 识别 {upload.recognized_lines || 0} 行</small></span><em className={upload.status}>{upload.status === "published" ? "已发布" : "待审核"}</em></button>) : <div><FileImage/><p>还没有菜单识别记录</p></div>}</aside><div className="menu-review-main">{active ? <><div className="menu-review-head"><div><span className={`status ${active.status}`}>{active.status === "published" ? <CheckCircle2/> : <Pencil/>}{active.status === "published" ? "已发布记录" : "待审核"}</span><h2>{active.filename}</h2><p>{active.menu?.week_start} 开始的一周 · 菜品库 {dictionary.length} 道{active.dictionary_corrections ? ` · 已自动纠正 ${active.dictionary_corrections} 处` : ""}</p></div><div><button className="danger" disabled={busy} onClick={remove}><Trash2/>删除记录</button><button className="publish" disabled={busy} onClick={publish}><CheckCircle2/>确认发布</button></div></div>{active.warnings?.length > 0 && <div className="parse-warnings">{active.warnings.map((warning, index) => <p key={index}>• {warning}</p>)}</div>}<MenuEditor key={`${active.id}-${active.uploaded_at}`} menu={active.menu} dictionary={dictionary} busy={busy} onImport={(menu) => saveDraft(menu, true)} onSave={saveDraft} saveLabel="保存审核修改"/></> : <div className="menu-admin-empty"><Soup/><h3>上传菜单图片后在这里校对</h3><p>自动识别不会直接覆盖学生端，确认发布后才会生效。</p></div>}</div></div> : live ? <div className="menu-live-panel"><div className="menu-live-head"><div><span className="status published"><CheckCircle2/>学生端正在使用</span><h2>{live.week_start} 开始的一周菜单</h2><p>版本 {version?.label || "—"}{version?.updated_at ? ` · ${new Date(version.updated_at).toLocaleString("zh-CN")}` : ""} · 菜品库 {dictionary.length} 道</p></div></div><MenuEditor key={`live-${version?.label}`} menu={live} dictionary={dictionary} busy={busy} onSave={saveLive} saveLabel="保存并立即更新学生端"/></div> : <div className="menu-admin-empty standalone"><Soup/><h3>学生端暂无已发布菜单</h3><p>请先上传菜单图片，校对后确认发布。</p></div>}
  </section>;
}

function DishDictionary({ dictionary }) {
  const [query, setQuery] = useState("");
  const [meal, setMeal] = useState("all");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [, setRevision] = useState(0);
  const keyword = normalizedDish(query);
  const visible = dictionary.filter((entry) => (meal === "all" || (meal === "breakfast" ? entry.meal === "breakfast" : entry.meal !== "breakfast")) && (!keyword || normalizedDish(entry.name).includes(keyword) || (entry.aliases || []).some((alias) => normalizedDish(alias).includes(keyword))));
  const grouped = [{ mealKey: "breakfast", label: "早餐", entries: visible.filter((entry) => entry.meal === "breakfast") }, { mealKey: "lunch", label: "午餐 / 晚餐", entries: visible.filter((entry) => entry.meal !== "breakfast") }].filter((group) => group.entries.length);
  const replaceDictionary = (items) => { dictionary.splice(0, dictionary.length, ...(items || [])); setRevision((value) => value + 1); };
  const openCreate = () => { setError(""); setEditing({ name: "", meal: "lunch", category: MENU_CATEGORIES.lunch[0], original: null }); };
  const openEdit = (entry) => { setError(""); setEditing({ name: entry.name, meal: entry.meal, category: entry.category, original: { name: entry.name, meal: entry.meal, category: entry.category } }); };
  const changeEditingMeal = (nextMeal) => setEditing((current) => ({ ...current, meal: nextMeal, category: MENU_CATEGORIES[nextMeal][0] }));
  const saveEntry = async (event) => {
    event.preventDefault(); setSaving(true); setError("");
    const entry = { name: editing.name.trim(), meal: editing.meal, category: editing.category };
    try { const data = editing.original ? await api("/api/admin/menu-dictionary", { method: "PATCH", body: JSON.stringify({ original: editing.original, entry }) }) : await api("/api/admin/menu-dictionary", { method: "POST", body: JSON.stringify(entry) }); replaceDictionary(data.dictionary); setEditing(null); }
    catch (saveError) { setError(saveError.message); }
    finally { setSaving(false); }
  };
  const deleteEntry = async (entry) => {
    if (!window.confirm(`确定从历史菜品库删除“${entry.name}”吗？删除后将不再用于自动纠错。`)) return;
    try { const data = await api("/api/admin/menu-dictionary", { method: "DELETE", body: JSON.stringify({ name: entry.name, meal: entry.meal, category: entry.category }) }); replaceDictionary(data.dictionary); }
    catch (deleteError) { window.alert(deleteError.message); }
  };
  return <section className="dish-dictionary"><header><div><small>DISH MEMORY</small><h2>历史菜品库</h2><p>早餐单独保存，午餐和晚餐共用一套菜品并自动去重。炖汤、饮品即使本周没有，也不会从历史库删除。</p></div><div className="dictionary-tools"><label>搜索菜品<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="菜名或曾经的错别字"/></label><button type="button" onClick={openCreate}>＋ 增加菜品</button></div></header><nav><button className={meal === "all" ? "active" : ""} onClick={() => setMeal("all")}>全部 <span>{dictionary.length}</span></button><button className={meal === "breakfast" ? "active" : ""} onClick={() => setMeal("breakfast")}>早餐 <span>{dictionary.filter((entry) => entry.meal === "breakfast").length}</span></button><button className={meal === "lunch" ? "active" : ""} onClick={() => setMeal("lunch")}>午餐 / 晚餐 <span>{dictionary.filter((entry) => entry.meal !== "breakfast").length}</span></button></nav>{grouped.length ? <div className="dish-dictionary-groups">{grouped.map((group) => <article key={group.mealKey}><h3>{group.label}<span>{group.entries.length} 道</span></h3><div>{group.entries.map((entry) => <section key={`${entry.meal}-${entry.category}-${entry.name}`}><small>{entry.category}</small><strong>{entry.name}</strong><p>使用 {entry.uses || 1} 次{entry.aliases?.length ? ` · 已记住 ${entry.aliases.length} 个识别别名` : ""}</p>{entry.aliases?.length > 0 && <em>曾识别为：{entry.aliases.join("、")}</em>}<div className="dictionary-card-actions"><button type="button" onClick={() => openEdit(entry)}>修改</button><button type="button" onClick={() => deleteEntry(entry)}>删除</button></div></section>)}</div></article>)}</div> : <div className="dish-dictionary-empty"><Soup/><h3>没有找到符合条件的菜品</h3><p>{dictionary.length ? "请更换搜索词或餐次" : "点击“增加菜品”，或首次确认发布菜单后开始积累。"}</p></div>}{editing && <div className="editor-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && setEditing(null)}><form className="dish-editor" onSubmit={saveEntry}><button type="button" className="editor-close" onClick={() => setEditing(null)}><X/></button><em>DISH MEMORY</em><h2>{editing.original ? "修改历史菜品" : "增加历史菜品"}</h2><p>{editing.original ? "修改菜名后，原菜名会作为纠错别名保留。" : "新增后会立即用于菜单纠错与输入联想。"}</p><label>菜品名称<input autoFocus required value={editing.name} onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))} placeholder="请输入正确菜名"/></label><div><label>餐次<select value={editing.meal} onChange={(event) => changeEditingMeal(event.target.value)}><option value="breakfast">早餐</option><option value="lunch">午餐 / 晚餐</option></select></label><label>分类<select value={editing.category} onChange={(event) => setEditing((current) => ({ ...current, category: event.target.value }))}>{MENU_CATEGORIES[editing.meal].map((category) => <option key={category}>{category}</option>)}</select></label></div>{error && <div className="dish-editor-error">{error}</div>}<button className="dish-editor-save" disabled={saving}>{saving ? "正在保存…" : editing.original ? "保存修改" : "加入历史菜品库"}</button></form></div>}</section>;
}

function MenuEditor({ menu, dictionary = [], busy, onImport, onSave, saveLabel }) {
  const [draft, setDraft] = useState(() => clone(menu));
  const [dayIndex, setDayIndex] = useState(0);
  const [meal, setMeal] = useState("breakfast");
  const [saving, setSaving] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [quickMessage, setQuickMessage] = useState("");
  const [wholeOpen, setWholeOpen] = useState(Boolean(onImport));
  const [wholeText, setWholeText] = useState("");
  const [wholeMessage, setWholeMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [issueFilter, setIssueFilter] = useState("all");
  const [dictionaryBusy, setDictionaryBusy] = useState(false);
  const [, setDictionaryRevision] = useState(0);
  useEffect(() => { setDraft(clone(menu)); setDayIndex(0); setMeal("breakfast"); setQuickText(""); setQuickMessage(""); }, [menu]);
  useEffect(() => { setQuickText(""); setQuickMessage(""); }, [dayIndex, meal]);
  const day = draft.days[dayIndex];
  const categories = MENU_CATEGORIES[meal];
  const intelligence = menuIntelligence(draft, dictionary);
  const visibleIssues = intelligence.issues.filter((issue) => issueFilter === "all" || (issueFilter === "missing" ? ["missing", "unknown", "count"].includes(issue.type) : issue.type === issueFilter)).slice(0, 80);
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
  const importWholeWeek = async () => {
    const parsed = parseWholeWeekText(wholeText, draft);
    if (!parsed.count) { setWholeMessage("没有识别到菜品，请检查是否包含“星期一、早餐、热菜：”等标题"); return; }
    if (!window.confirm(`已识别 ${parsed.populatedDays} 天、${parsed.count} 道菜，将替换当前待审核菜单，是否继续？`)) return;
    setImporting(true); setWholeMessage("");
    try { await onImport(parsed.menu); setWholeText(""); setWholeMessage(`整周导入完成：${parsed.populatedDays} 天、${parsed.count} 道菜${parsed.ignored ? `，有 ${parsed.ignored} 行未识别` : ""}`); }
    catch (error) { setWholeMessage(error.message); }
    finally { setImporting(false); }
  };
  const jumpToIssue = (issue) => { setDayIndex(issue.dayIndex); setMeal(issue.meal); requestAnimationFrame(() => document.querySelector(".menu-editor-toolbar")?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const applySuggestion = (issue) => { const next = clone(draft); next.days[issue.dayIndex].meals[issue.meal][issue.category][issue.itemIndex] = issue.suggestion; setDraft(next); };
  const renameNewDish = (issue) => { const value = window.prompt("修改菜名", issue.original)?.trim(); if (!value || value === issue.original) return; const next = clone(draft); next.days[issue.dayIndex].meals[issue.meal][issue.category][issue.itemIndex] = value; setDraft(next); };
  const deleteIssueDish = (issue) => { if (!window.confirm(`确定从当前菜单删除“${issue.original}”吗？`)) return; const next = clone(draft); next.days[issue.dayIndex].meals[issue.meal][issue.category].splice(issue.itemIndex, 1); setDraft(next); };
  const addNewDishToHistory = async (issue) => { setDictionaryBusy(true); try { const data = await api("/api/admin/menu-dictionary", { method: "POST", body: JSON.stringify({ name: issue.original, meal: issue.meal, category: issue.category }) }); dictionary.splice(0, dictionary.length, ...(data.dictionary || [])); setDictionaryRevision((value) => value + 1); window.alert(data.added ? `“${issue.original}”已加入历史菜品库` : `“${issue.original}”已经在历史菜品库中`); } catch (error) { window.alert(error.message); } finally { setDictionaryBusy(false); } };
  const applyAllSuggestions = () => { const next = clone(draft); intelligence.issues.filter((issue) => issue.type === "suggestion").forEach((issue) => { next.days[issue.dayIndex].meals[issue.meal][issue.category][issue.itemIndex] = issue.suggestion; }); setDraft(next); };
  const submit = async () => { const cleaned = clone(draft); cleaned.days.forEach((item) => Object.values(item.meals).forEach((mealData) => Object.keys(mealData).forEach((category) => { mealData[category] = mealData[category].map((dish) => String(dish).trim()).filter(Boolean); }))); setSaving(true); try { await onSave(cleaned); setDraft(cleaned); } finally { setSaving(false); } };
  return <div className="menu-editor">
    {onImport && <section className="whole-week-import"><button type="button" className="whole-week-toggle" onClick={() => setWholeOpen((value) => !value)}><span><Sparkles/><i><small>WHOLE WEEK IMPORT</small><strong>整周菜单一键导入</strong></i></span><b>{wholeOpen ? "收起" : "展开"}</b></button>{wholeOpen && <div className="whole-week-body"><p>把外部 AI 整理好的星期一至星期日菜单一次粘贴到这里，系统会自动拆分并与历史菜品库匹配。</p><textarea value={wholeText} onChange={(event) => setWholeText(event.target.value)} placeholder={`星期一\n早餐\n热菜：洋葱云耳炒鸡蛋、五彩盐水花生\n中点：肉包、小馒头\n主食：南瓜粥\n\n午餐\n热菜：椒盐鱼、黑椒肉片\n免费汤：枸杞叶蛋汤\n……\n\n星期二\n早餐\n……`}/><div><span>{wholeMessage || `已积累 ${dictionary.length} 道历史菜品，导入后自动匹配错别字`}</span><button type="button" disabled={busy || importing || !wholeText.trim()} onClick={importWholeWeek}>{importing ? "正在导入…" : "解析并导入整周菜单"}</button></div></div>}</section>}
    {intelligence.dishCount > 0 && <section className="menu-intelligence"><header><div><small>SMART REVIEW</small><h3>智能校对结果</h3><p>历史菜品自动确认，只需要检查推荐、新菜和数量异常。</p></div>{intelligence.suggestions > 0 && <button type="button" onClick={applyAllSuggestions}><Sparkles/>应用全部 {intelligence.suggestions} 条推荐</button>}</header><div className="intelligence-metrics"><button className={issueFilter === "all" ? "active" : ""} onClick={() => setIssueFilter("all")}><strong>{intelligence.dishCount}</strong><small>全部菜品</small></button><button onClick={() => setIssueFilter("all")}><strong>{intelligence.confirmed}</strong><small>历史确认</small></button><button className={issueFilter === "suggestion" ? "active warning" : "warning"} onClick={() => setIssueFilter("suggestion")}><strong>{intelligence.suggestions}</strong><small>纠错推荐</small></button><button className={issueFilter === "new" ? "active new" : "new"} onClick={() => setIssueFilter("new")}><strong>{intelligence.newItems}</strong><small>疑似新菜</small></button><button className={issueFilter === "missing" ? "active danger" : "danger"} onClick={() => setIssueFilter("missing")}><strong>{intelligence.missing}</strong><small>数量/看不清</small></button></div>{visibleIssues.length > 0 && <div className="intelligence-issues">{visibleIssues.map((issue) => <article key={issue.key} className={`issue-${issue.type}`}><AlertTriangle/><div><small>{draft.days[issue.dayIndex]?.weekday} · {MENU_LABELS[issue.meal]} · {issue.category}</small>{issue.type === "suggestion" ? <strong>“{issue.original}”可能是“{issue.suggestion}”</strong> : issue.type === "new" ? <strong>新菜候选：{issue.original}</strong> : issue.type === "count" ? <strong>{issue.category}应有 {issue.expected} 个，目前 {issue.actual} 个</strong> : issue.type === "unknown" ? <strong>文字无法确认：{issue.original}</strong> : <strong>该分类目前没有菜品</strong>}</div>{issue.type === "suggestion" ? <button type="button" onClick={() => applySuggestion(issue)}>采用推荐</button> : issue.type === "new" ? <div className="issue-actions"><button type="button" onClick={() => renameNewDish(issue)}>修改名称</button><button type="button" disabled={dictionaryBusy} onClick={() => addNewDishToHistory(issue)}>加入历史</button><button type="button" className="delete" onClick={() => deleteIssueDish(issue)}>删除</button></div> : <button type="button" onClick={() => jumpToIssue(issue)}>去补充</button>}</article>)}</div>}</section>}
    <div className="menu-day-tabs">{draft.days.map((item, index) => <button key={item.date || index} className={dayIndex === index ? "active" : ""} onClick={() => setDayIndex(index)}><small>{item.weekday?.replace("星期", "周")}</small><strong>{item.date?.slice(5).replace("-", "/")}</strong></button>)}</div>
    <label className="menu-admin-day-select"><span>选择本周日期</span><select value={dayIndex} onChange={(event) => setDayIndex(Number(event.target.value))}>{draft.days.map((item, index) => <option key={item.date || index} value={index}>{item.weekday} · {item.date?.slice(5).replace("-", "月")}日</option>)}</select></label>
    <div className="menu-editor-toolbar"><div className="menu-current-day"><small>当前编辑</small><strong>{day.weekday} · {day.date?.replaceAll("-", ".")}</strong></div><div>{Object.entries(MENU_LABELS).map(([key, label]) => <button key={key} className={meal === key ? "active" : ""} onClick={() => setMeal(key)}>{label}</button>)}</div></div>
    <section className="menu-quick-entry"><div><small>QUICK INPUT</small><h3>文字自动分组</h3><p>先写分类标题，再逐行输入菜名；也支持用顿号或逗号分隔。只替换识别到的分类。</p></div><textarea value={quickText} onChange={(event) => setQuickText(event.target.value)} placeholder={`${categories[0]}：\n宫保鸡丁\n清蒸鱼\n\n${categories[1]}：\n请在这里继续输入`}/><div className="menu-quick-actions"><span>{quickMessage || `可识别：${categories.join("、")}`}</span><button type="button" className="clear" onClick={clearMeal}>清空当前餐次</button><button type="button" disabled={!quickText.trim()} onClick={applyQuickText}>自动识别并填入</button></div></section>
    <div className="menu-category-editor">{categories.map((category, index) => { const items = day.meals?.[meal]?.[category] || []; const suggestions = dictionary.filter((entry) => entry.meal === historyMeal(meal, category) && entry.category === category).slice(0, 80); const listId = `dish-list-${meal}-${index}`; return <article key={category} className={index % 2 ? "alternate" : ""}><header><span><i>{String(index + 1).padStart(2, "0")}</i><strong>{category}</strong></span><button type="button" onClick={() => addItem(category)}>＋ 添加菜品</button></header><datalist id={listId}>{suggestions.map((entry) => <option key={`${entry.name}-${entry.category}`} value={entry.name}/>)}</datalist>{items.length ? <div className="menu-item-input-grid">{items.map((item, itemIndex) => { const itemIssue = intelligence.issues.find((issue) => issue.dayIndex === dayIndex && issue.meal === meal && issue.category === category && issue.itemIndex === itemIndex); return <label key={`${category}-${itemIndex}`} className={itemIssue ? `has-${itemIssue.type}` : "known-item"}><span>{String(itemIndex + 1).padStart(2, "0")}</span><input list={listId} value={item} onChange={(event) => updateItem(category, itemIndex, event.target.value)} placeholder="输入菜名，可搜索历史菜品"/><button type="button" aria-label={`删除${item || "菜品"}`} onClick={() => removeItem(category, itemIndex)}><X/></button></label>; })}</div> : <button type="button" className="menu-no-item" onClick={() => addItem(category)}>本分类暂无菜品，点击添加</button>}</article>; })}</div>
    <button className="menu-save" disabled={busy || saving} onClick={submit}>{saving ? "正在保存…" : saveLabel}</button>
  </div>;
}
