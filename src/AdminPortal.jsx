import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, FileText, LockKeyhole, LogOut,
  Pencil, RefreshCw, Rocket, ShieldCheck, Trash2, UploadCloud, X,
} from "lucide-react";
import "./admin.css";

const statusText = { pending_review: "待审核", published: "已发布", parse_failed: "解析失败" };
const typeText = { tax: "税务课程", english: "英语课程", digital: "数字与智能", other: "其他课程" };

async function readJson(response) {
  let data = {};
  try { data = await response.json(); } catch { /* 保留统一错误信息 */ }
  if (!response.ok) {
    const error = new Error(data.error || (response.status === 401 ? "登录已失效，请重新登录" : "操作失败"));
    error.status = response.status;
    throw error;
  }
  return data;
}

export default function AdminPortal({ onBack }) {
  const [authorized, setAuthorized] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);

  const loadUploads = useCallback(async () => {
    const data = await readJson(await fetch("/api/admin/uploads", { cache: "no-store" }));
    const rows = data.uploads || [];
    setUploads(rows);
    setAuthorized(true);
    return rows;
  }, []);

  const selectUpload = useCallback(async (upload) => {
    setSelected(upload); setError("");
    try { setWarnings(JSON.parse(upload.warnings || "[]")); } catch { setWarnings([]); }
    const data = await readJson(await fetch(`/api/admin/uploads?upload_id=${encodeURIComponent(upload.id)}`, { cache: "no-store" }));
    setDrafts(data.drafts || []);
  }, []);

  useEffect(() => {
    loadUploads().then(rows => rows[0] && selectUpload(rows[0])).catch(reason => {
      if (reason.status === 401) setAuthorized(false);
      else { setAuthorized(false); setError(reason.message); }
    });
  }, [loadUploads, selectUpload]);

  if (authorized === null) return <div className="admin-loading"><span/><p>正在验证管理员身份…</p></div>;
  if (!authorized) return <AdminLogin onBack={onBack} onSuccess={() => {
    setAuthorized(true); setError("");
    loadUploads().then(rows => rows[0] && selectUpload(rows[0])).catch(reason => setError(reason.message));
  }}/>;

  async function handleFile(file) {
    if (!file || (file.type && file.type !== "application/pdf") || !file.name.toLowerCase().endsWith(".pdf")) return setError("请选择PDF文件");
    setBusy(true); setProgress(4); setError(""); setMessage("正在读取PDF表格…");
    try {
      const { parseCoursePdf } = await import("./pdf-parser.mjs");
      const parsed = await parseCoursePdf(file, setProgress);
      if (!parsed.courses.length) throw new Error("没有识别到课程，请确认这是学校课程总表");
      setMessage(`已识别 ${parsed.courses.length} 条课程，正在安全上传…`);
      const form = new FormData();
      form.set("file", file);
      form.set("courses", JSON.stringify(parsed.courses));
      form.set("warnings", JSON.stringify(parsed.warnings));
      const data = await readJson(await fetch("/api/admin/uploads", { method: "POST", body: form }));
      setProgress(100); setMessage(`解析完成：${data.count} 条课程已进入待审核区`);
      setDrafts(data.drafts || []); setWarnings(parsed.warnings || []);
      const rows = await loadUploads();
      const current = rows.find(item => item.id === data.upload_id);
      if (current) setSelected(current);
    } catch (reason) { setError(reason.message || "PDF解析失败"); setMessage(""); }
    finally { setBusy(false); }
  }

  async function saveDraft(value) {
    setError("");
    try {
      await readJson(await fetch(`/api/admin/drafts/${value.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }));
      setDrafts(rows => rows.map(row => row.id === value.id ? value : row));
      setEditing(null); setMessage("课程草稿已保存");
    } catch (reason) { setError(reason.message || "保存失败"); }
  }

  async function deleteDraft(course) {
    if (!window.confirm(`确定从待审核列表删除“${course.course_name}”吗？`)) return;
    try {
      await readJson(await fetch(`/api/admin/drafts/${course.id}`, { method: "DELETE" }));
      setDrafts(rows => rows.filter(row => row.id !== course.id)); setMessage("课程草稿已删除");
    } catch (reason) { setError(reason.message || "删除失败"); }
  }

  async function publishCourses() {
    if (!selected || !drafts.length || !window.confirm(`确认发布 ${drafts.length} 条课程吗？发布后学生端会立即更新。`)) return;
    setBusy(true); setError(""); setMessage("正在发布新版本…");
    try {
      const data = await readJson(await fetch("/api/admin/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ upload_id: selected.id, remark: `审核发布：${selected.filename}` }) }));
      setMessage(`发布成功，当前版本 ${data.version.label}`);
      const rows = await loadUploads();
      const current = rows.find(item => item.id === selected.id);
      if (current) { setSelected(current); await selectUpload(current); }
    } catch (reason) { setError(reason.message || "发布失败"); setMessage(""); }
    finally { setBusy(false); }
  }

  async function deleteUpload() {
    if (!selected || !window.confirm(`确定删除“${selected.filename}”吗？原PDF、上传记录和待审核草稿都会删除；已经发布的学生课表不会受影响。`)) return;
    setBusy(true); setError(""); setMessage("正在删除文件记录…");
    try {
      await readJson(await fetch(`/api/admin/uploads?upload_id=${encodeURIComponent(selected.id)}`, { method: "DELETE" }));
      const remaining = uploads.filter(row => row.id !== selected.id);
      setUploads(remaining); setSelected(null); setDrafts([]); setWarnings([]); setMessage("文件及相关待审核记录已删除");
      if (remaining[0]) await selectUpload(remaining[0]);
    } catch (reason) { setError(reason.message || "删除失败"); setMessage(""); }
    finally { setBusy(false); }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthorized(false); setUploads([]); setSelected(null); setDrafts([]);
  }

  return <AdminWorkspace {...{
    uploads, selected, drafts, warnings, busy, progress, message, error, editing,
    onBack, setEditing, handleFile, selectUpload, deleteUpload, publishCourses,
    deleteDraft, saveDraft, logout,
  }}/>;
}

function AdminLogin({ onBack, onSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await readJson(await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }));
      onSuccess();
    } catch (reason) { setError(reason.message || "登录失败"); }
    finally { setBusy(false); }
  }
  return <main className="admin-access"><section className="admin-login-card"><div className="admin-login-mark"><ShieldCheck size={22}/></div><em>ADMIN ACCESS</em><h1>管理员登录</h1><p>学生无需登录即可查看课表，只有管理员能够上传、审核和发布PDF。</p><form onSubmit={submit}><label>管理员账号<input autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)} required/></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required/></label>{error&&<div className="admin-login-error"><LockKeyhole size={16}/>{error}</div>}<button className="admin-primary" disabled={busy}>{busy?"正在验证…":"登录管理后台"}</button></form><button className="admin-back-link" onClick={onBack}><ArrowLeft size={15}/>返回学生端</button></section></main>;
}

function AdminWorkspace(props) {
  const fileInput = useRef(null);
  const { uploads, selected, drafts, warnings, busy, progress, message, error, editing, onBack, setEditing, handleFile, selectUpload, deleteUpload, publishCourses, deleteDraft, saveDraft, logout } = props;
  return <div className="admin-page"><aside className="admin-sidebar"><button className="admin-brand" onClick={onBack}><b>MT</b><span><strong>厦国会</strong><small>课程发布后台</small></span></button><div className="admin-side-title">PDF 记录</div><div className="admin-history">{uploads.map(upload=><button key={upload.id} className={selected?.id===upload.id?"active":""} onClick={()=>selectUpload(upload)}><FileText size={18}/><span><strong>{upload.filename}</strong><small>{upload.uploaded_at.slice(0,16).replace("T"," ")} · {statusText[upload.status]||upload.status}</small></span></button>)}{!uploads.length&&<p>尚未上传新PDF</p>}</div><button className="admin-logout" onClick={logout}><LogOut size={17}/>退出管理员账号</button></aside><main className="admin-main"><header className="admin-header"><div><em>COURSE PUBLISHING</em><h1>课程发布工作台</h1><p>上传、核对、确认，一切变更都由管理员决定。</p></div><div className="admin-header-actions"><button className="admin-secondary" onClick={onBack}><ArrowLeft size={17}/>学生端</button><button className="admin-primary" disabled={busy} onClick={()=>fileInput.current?.click()}><UploadCloud size={18}/>上传新PDF</button><input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={event=>{const file=event.target.files?.[0]; if(file) handleFile(file); event.target.value="";}}/></div></header>{busy&&<div className="admin-progress"><div><span>{message}</span><strong>{progress}%</strong></div><i><b style={{width:`${progress}%`}}/></i></div>}{message&&!busy&&<div className="admin-notice success"><CheckCircle2 size={18}/>{message}</div>}{error&&<div className="admin-notice error"><AlertTriangle size={18}/>{error}</div>}{!selected?<section className="admin-empty"><span><UploadCloud size={36}/></span><h2>上传新的课程总表</h2><p>系统会自动解析PDF，并把结果放入待审核列表，不会直接覆盖学生课表。</p><button className="admin-primary" onClick={()=>fileInput.current?.click()}><UploadCloud size={18}/>选择PDF</button></section>:<><section className="admin-summary"><div><span><CheckCircle2 size={22}/></span><div><small>当前文件</small><strong>{selected.filename}</strong></div></div><div><small>状态</small><strong>{statusText[selected.status]||selected.status}</strong></div><div><small>待审核课程</small><strong>{drafts.length} 条</strong></div></section>{warnings.map(warning=><div className="admin-notice warning" key={warning}><AlertTriangle size={17}/>{warning}</div>)}<section className="admin-drafts"><div className="admin-section-head"><div><em>REVIEW</em><h2>待审核课程</h2></div><div><button className="admin-secondary danger" disabled={busy} onClick={deleteUpload}><Trash2 size={15}/>删除文件</button><button className="admin-secondary compact" onClick={()=>selectUpload(selected)}><RefreshCw size={15}/>刷新</button><button className="admin-publish" disabled={busy||selected.status!=="pending_review"||!drafts.length} onClick={publishCourses}><Rocket size={17}/>确认发布</button></div></div><div className="admin-table-wrap"><table><thead><tr><th>日期</th><th>时段</th><th>课程</th><th>教师</th><th>班级</th><th>教室</th><th>类型</th><th>操作</th></tr></thead><tbody>{drafts.map(course=><tr key={course.id}><td>{course.date}</td><td>{course.period}</td><td className="admin-course-name">{course.course_name}</td><td>{course.teacher||"—"}</td><td>{course.class_name||"—"}</td><td>{course.classroom||"—"}</td><td><span className={`admin-type ${course.course_type}`}>{typeText[course.course_type]||"其他课程"}</span></td><td><div className="admin-row-actions"><button title="编辑" onClick={()=>setEditing(course)}><Pencil size={15}/></button><button title="删除" className="danger" onClick={()=>deleteDraft(course)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div></section></>}</main>{editing&&<EditCourse initial={editing} onClose={()=>setEditing(null)} onSave={saveDraft}/>}</div>;
}

function EditCourse({ initial, onClose, onSave }) {
  const [value,setValue]=useState(initial);
  const update=(key,next)=>setValue(current=>({...current,[key]:next}));
  return <div className="admin-modal-backdrop"><form className="admin-edit" onSubmit={event=>{event.preventDefault();onSave(value)}}><button type="button" className="admin-modal-close" onClick={onClose}><X size={19}/></button><em>MANUAL REVIEW</em><h2>编辑待审核课程</h2><div className="admin-edit-grid"><label className="wide">课程名称<input value={value.course_name} required onChange={e=>update("course_name",e.target.value)}/></label><label>日期<input type="date" value={value.date} required onChange={e=>update("date",e.target.value)}/></label><label>星期<input value={value.weekday} onChange={e=>update("weekday",e.target.value)}/></label><label>时段<select value={value.period} onChange={e=>update("period",e.target.value)}><option>上午</option><option>下午</option><option>晚上</option></select></label><label>教师<input value={value.teacher||""} onChange={e=>update("teacher",e.target.value)}/></label><label>开始时间<input type="time" value={value.start_time} onChange={e=>update("start_time",e.target.value)}/></label><label>结束时间<input type="time" value={value.end_time} onChange={e=>update("end_time",e.target.value)}/></label><label>班级<input value={value.class_name||""} onChange={e=>update("class_name",e.target.value)}/></label><label>教室<input value={value.classroom||""} onChange={e=>update("classroom",e.target.value)}/></label><label>课程类型<select value={value.course_type} onChange={e=>update("course_type",e.target.value)}><option value="tax">税务课程</option><option value="english">英语课程</option><option value="digital">数字与智能</option><option value="other">其他课程</option></select></label><label>备注<input value={value.remark||""} onChange={e=>update("remark",e.target.value)}/></label></div><div className="admin-modal-actions"><button type="button" className="admin-secondary" onClick={onClose}>取消</button><button className="admin-primary">保存修改</button></div></form></div>;
}
