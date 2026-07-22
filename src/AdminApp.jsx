import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, FileImage, FileText, LogOut, Pencil, ShieldCheck, Soup, Trash2, UploadCloud, UtensilsCrossed, X } from "lucide-react";

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
      <section className="admin-heading"><div><em>{section === "menu" ? "DINING MANAGEMENT" : "COURSE MANAGEMENT"}</em><h1>{section === "menu" ? "一周菜单管理" : `${MAJORS.find((item) => item.id === major)?.label}专业课程管理`}</h1><p>{section === "menu" ? "上传食堂一周菜单图片，自动识别并校对后发布到学生端。" : "各专业课程独立保存，上传和调课只影响当前选择的专业。"}</p></div>{section !== "menu" && <div className="admin-heading-actions"><label className="major-select">管理专业<select value={major} onChange={(event) => { setMajor(event.target.value); setNotice(""); }} disabled={busy}>{MAJORS.map((item) => <option key={item.id} value={item.id}>{item.label}专业</option>)}</select></label>{section === "uploads" && <label className={`upload-button ${busy ? "disabled" : ""}`}><UploadCloud/>上传课程 PDF<input ref={fileRef} type="file" accept="application/pdf,.pdf" disabled={busy} onChange={uploadPdf}/></label>}</div>}</section>
      <nav className="admin-tabs"><button className={section === "published" ? "active" : ""} onClick={() => setSection("published")}><CalendarDays/>现有课程 <span>{courses.length}</span></button><button className={section === "uploads" ? "active" : ""} onClick={() => setSection("uploads")}><UploadCloud/>PDF 上传与审核 <span>{uploads.length}</span></button><button className={section === "menu" ? "active" : ""} onClick={() => setSection("menu")}><UtensilsCrossed/>今日菜单</button></nav>
      {busy && progress > 0 && <div className="parse-progress"><span style={{ width: `${progress}%` }}/><b>{progress}%</b><small>{progressLabel}</small></div>}
      {notice && <div className="admin-notice">{notice}<button onClick={() => setNotice("")}><X size={16}/></button></div>}
      {section === "menu" ? <MenuManager busy={busy} setBusy={setBusy} setProgress={setProgress} setProgressLabel={setProgressLabel} setNotice={setNotice}/> : section === "published" ? <PublishedCourses majorLabel={MAJORS.find((item) => item.id === major)?.label} courses={courses} version={version} busy={busy} onSave={savePublishedCourse} onDelete={deletePublishedCourse}/> : <div className="admin-workspace">
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

const MENU_LABELS = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐" };
const clone = (value) => JSON.parse(JSON.stringify(value));
const dateIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function currentMonday() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const map = Object.fromEntries(parts.map((part) => [part.type, part.value])); const date = new Date(`${map.year}-${map.month}-${map.day}T12:00:00`); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return dateIso(date); }

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
    setBusy(true); setProgress(1); setProgressLabel("正在本机识别菜单图片，首次使用需加载中文识别组件"); setNotice("正在自动旋转并识别表格小字，请保持页面打开…");
    try {
      const { parseMenuImage } = await import("./menu-parser.js");
      const result = await parseMenuImage(file, weekStart, setProgress);
      const record = await api("/api/admin/menu-uploads", { method: "POST", body: JSON.stringify({ filename: file.name, menu: result.menu, warnings: result.warnings, recognized_lines: result.recognized_lines }) });
      await load(); setActiveId(record.upload.id); setMode("review");
      setNotice(`菜单识别完成：提取到 ${result.recognized_lines} 行内容，请逐日校对后发布。`);
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); setProgress(0); if (fileRef.current) fileRef.current.value = ""; }
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
    <div className="menu-upload-hero"><div className="menu-upload-icon"><FileImage/></div><div><small>MENU IMAGE OCR</small><h2>上传一周菜单图片</h2><p>支持手机拍摄的横向表格，系统会自动旋转、识别并按早中晚餐分类。</p></div><label className="menu-week">菜单所属周（星期一）<input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)}/></label><label className={`upload-button ${busy ? "disabled" : ""}`}><UploadCloud/>选择菜单图片<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={uploadImage}/></label></div>
    <nav className="menu-admin-tabs"><button className={mode === "review" ? "active" : ""} onClick={() => setMode("review")}><Pencil/>识别与审核 <span>{uploads.length}</span></button><button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}><Soup/>学生端现有菜单</button></nav>
    {mode === "review" ? <div className="menu-review-layout"><aside className="menu-upload-list">{uploads.length ? uploads.map((upload) => <button className={(active?.id === upload.id) ? "active" : ""} key={upload.id} onClick={() => setActiveId(upload.id)}><FileImage/><span><strong>{upload.filename}</strong><small>{upload.menu?.week_start} · 识别 {upload.recognized_lines || 0} 行</small></span><em className={upload.status}>{upload.status === "published" ? "已发布" : "待审核"}</em></button>) : <div><FileImage/><p>还没有菜单识别记录</p></div>}</aside><div className="menu-review-main">{active ? <><div className="menu-review-head"><div><span className={`status ${active.status}`}>{active.status === "published" ? <CheckCircle2/> : <Pencil/>}{active.status === "published" ? "已发布记录" : "待审核"}</span><h2>{active.filename}</h2><p>{active.menu?.week_start} 开始的一周 · 自动识别 {active.recognized_lines || 0} 行</p></div><div><button className="danger" disabled={busy} onClick={remove}><Trash2/>删除记录</button><button className="publish" disabled={busy} onClick={publish}><CheckCircle2/>确认发布</button></div></div>{active.warnings?.length > 0 && <div className="parse-warnings">{active.warnings.map((warning, index) => <p key={index}>• {warning}</p>)}</div>}<MenuEditor key={`${active.id}-${active.uploaded_at}`} menu={active.menu} busy={busy} onSave={saveDraft} saveLabel="保存审核修改"/></> : <div className="menu-admin-empty"><Soup/><h3>上传菜单图片后在这里校对</h3><p>自动识别不会直接覆盖学生端，确认发布后才会生效。</p></div>}</div></div> : live ? <div className="menu-live-panel"><div className="menu-live-head"><div><span className="status published"><CheckCircle2/>学生端正在使用</span><h2>{live.week_start} 开始的一周菜单</h2><p>版本 {version?.label || "—"}{version?.updated_at ? ` · ${new Date(version.updated_at).toLocaleString("zh-CN")}` : ""}</p></div></div><MenuEditor key={`live-${version?.label}`} menu={live} busy={busy} onSave={saveLive} saveLabel="保存并立即更新学生端"/></div> : <div className="menu-admin-empty standalone"><Soup/><h3>学生端暂无已发布菜单</h3><p>请先上传菜单图片，校对后确认发布。</p></div>}
  </section>;
}

function MenuEditor({ menu, busy, onSave, saveLabel }) {
  const [draft, setDraft] = useState(() => clone(menu));
  const [dayIndex, setDayIndex] = useState(0);
  const [meal, setMeal] = useState("breakfast");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(clone(menu)); setDayIndex(0); setMeal("breakfast"); }, [menu]);
  const day = draft.days[dayIndex];
  const categories = Object.keys(day?.meals?.[meal] || {});
  const updateItems = (category, value) => {
    const next = clone(draft);
    next.days[dayIndex].meals[meal][category] = value.split(/\n|、/).map((item) => item.trim()).filter(Boolean);
    setDraft(next);
  };
  const updateDate = (value) => { const next = clone(draft); next.days[dayIndex].date = value; if (dayIndex === 0) next.week_start = value; setDraft(next); };
  const submit = async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } };
  return <div className="menu-editor"><div className="menu-day-tabs">{draft.days.map((item, index) => <button key={item.date || index} className={dayIndex === index ? "active" : ""} onClick={() => setDayIndex(index)}><small>{item.weekday?.replace("星期", "周")}</small><strong>{item.date?.slice(5).replace("-", "/")}</strong></button>)}</div><div className="menu-editor-toolbar"><label>当前日期<input type="date" value={day.date} onChange={(event) => updateDate(event.target.value)}/></label><div>{Object.entries(MENU_LABELS).map(([key, label]) => <button key={key} className={meal === key ? "active" : ""} onClick={() => setMeal(key)}>{label}</button>)}</div></div><div className="menu-category-editor">{categories.map((category, index) => <label key={category} className={index % 2 ? "alternate" : ""}><span><i>{String(index + 1).padStart(2, "0")}</i><strong>{category}</strong><small>一行一道菜</small></span><textarea rows={Math.max(3, Math.min(8, day.meals[meal][category].length + 1))} value={day.meals[meal][category].join("\n")} onChange={(event) => updateItems(category, event.target.value)} placeholder={`填写${category}，每行一道菜`}/></label>)}</div><button className="menu-save" disabled={busy || saving} onClick={submit}>{saving ? "正在保存…" : saveLabel}</button></div>;
}
