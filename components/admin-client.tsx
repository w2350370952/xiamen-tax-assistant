"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, LogOut, Pencil, RefreshCw, Rocket, Trash2, UploadCloud, X } from "lucide-react";
import type { Course, CourseInput, UploadRecord } from "@/lib/types";
import { parseCoursePdf } from "@/lib/pdf-parser.mjs";

const statusText: Record<string, string> = { pending_review: "待审核", published: "已发布", parse_failed: "解析失败" };
const typeText: Record<string, string> = { tax: "税务课程", english: "英语课程", digital: "数字与智能", other: "其他课程" };

async function readJson(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

export default function AdminClient({ adminName, adminEmail }: { adminName: string; adminEmail: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [selected, setSelected] = useState<UploadRecord | null>(null);
  const [drafts, setDrafts] = useState<Course[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Course | null>(null);

  const loadUploads = useCallback(async () => {
    const data = await readJson(await fetch("/api/admin/uploads", { cache: "no-store" }));
    setUploads(data.uploads);
    return data.uploads as UploadRecord[];
  }, []);

  const selectUpload = useCallback(async (upload: UploadRecord) => {
    setSelected(upload);
    setError("");
    try { setWarnings(JSON.parse(upload.warnings || "[]")); } catch { setWarnings([]); }
    const data = await readJson(await fetch(`/api/admin/uploads?upload_id=${encodeURIComponent(upload.id)}`, { cache: "no-store" }));
    setDrafts(data.drafts);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUploads().then((rows) => rows[0] && selectUpload(rows[0])).catch((reason) => setError(reason.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadUploads, selectUpload]);

  async function handleFile(file: File) {
    if (file.type !== "application/pdf") return setError("请选择PDF文件");
    setBusy(true); setProgress(4); setError(""); setMessage("正在读取PDF表格…");
    try {
      const parsed = await parseCoursePdf(file, setProgress);
      if (!parsed.courses.length) throw new Error("没有识别到课程，请确认这是学校课程总表");
      setMessage(`已识别 ${parsed.courses.length} 条课程，正在安全上传…`);
      const form = new FormData();
      form.set("file", file);
      form.set("courses", JSON.stringify(parsed.courses));
      form.set("warnings", JSON.stringify(parsed.warnings));
      const data = await readJson(await fetch("/api/admin/uploads", { method: "POST", body: form }));
      setProgress(100); setMessage(`解析完成：${data.count} 条课程已进入待审核区`);
      setDrafts(data.drafts); setWarnings(parsed.warnings);
      const rows = await loadUploads();
      const current = rows.find((item) => item.id === data.upload_id);
      if (current) setSelected(current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PDF解析失败");
      setMessage("");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function saveDraft(value: Course) {
    setError("");
    try {
      await readJson(await fetch(`/api/admin/drafts/${value.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }));
      setDrafts((rows) => rows.map((row) => row.id === value.id ? value : row));
      setEditing(null); setMessage("课程草稿已保存");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
  }

  async function deleteDraft(course: Course) {
    if (!window.confirm(`确定从待审核列表删除“${course.course_name}”吗？`)) return;
    try {
      await readJson(await fetch(`/api/admin/drafts/${course.id}`, { method: "DELETE" }));
      setDrafts((rows) => rows.filter((row) => row.id !== course.id));
      setMessage("课程草稿已删除");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); }
  }

  async function publish() {
    if (!selected || !drafts.length || !window.confirm(`确认发布 ${drafts.length} 条课程吗？发布后学生端会立即读取新版本。`)) return;
    setBusy(true); setError(""); setMessage("正在发布新版本…");
    try {
      const data = await readJson(await fetch("/api/admin/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ upload_id: selected.id, remark: `审核发布：${selected.filename}` }) }));
      setMessage(`发布成功，当前版本 ${data.version.label}`);
      const rows = await loadUploads();
      const current = rows.find((item) => item.id === selected.id);
      if (current) setSelected(current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "发布失败"); setMessage(""); }
    finally { setBusy(false); }
  }

  return (
    <div className="admin-page">
      <aside className="admin-sidebar">
        <Link className="brand admin-brand" href="/"><span className="brand-mark">MT</span><span><strong>厦国会</strong><small>课程发布后台</small></span></Link>
        <div className="admin-side-title">PDF 记录</div>
        <div className="upload-history">
          {uploads.map((upload) => <button key={upload.id} className={`file-item ${selected?.id === upload.id ? "active" : ""}`} onClick={() => selectUpload(upload)}><FileText size={18} /><span><strong>{upload.filename}</strong><small>{upload.uploaded_at.slice(0, 16).replace("T", " ")} · {statusText[upload.status] || upload.status}</small></span></button>)}
          {!uploads.length && <p className="history-empty">尚未上传新PDF</p>}
        </div>
        <a className="logout-button" href="/signout-with-chatgpt?return_to=%2F"><LogOut size={17} />退出管理员账号</a>
      </aside>

      <main className="admin-main">
        <header className="admin-header"><div><p className="eyebrow">COURSE PUBLISHING</p><h1>课程发布工作台</h1><span>{adminName} · 上传、核对、确认，一切变更都由你决定。</span></div><div className="header-actions"><Link className="secondary-button" href="/"><ArrowLeft size={17} />学生端</Link><button className="primary-button" disabled={busy} onClick={() => fileInput.current?.click()}><UploadCloud size={18} />上传新PDF</button><input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])} /></div></header>

        {busy && <div className="progress-card"><div><span>{message}</span><strong>{progress}%</strong></div><i><b style={{ width: `${progress}%` }} /></i></div>}
        {message && !busy && <div className="notice success"><CheckCircle2 size={18} />{message}</div>}
        {error && <div className="notice error"><AlertTriangle size={18} />{error}</div>}

        {!selected ? <section className="admin-empty"><span><UploadCloud size={36} /></span><h2>上传第一份新课程总表</h2><p>系统会自动解析PDF，并把结果放入待审核列表，不会直接覆盖学生课表。</p><button className="primary-button" onClick={() => fileInput.current?.click()}><UploadCloud size={18} />选择PDF</button></section> : <>
          <section className="review-summary"><div><span className="summary-icon"><CheckCircle2 size={22} /></span><span><small>当前文件</small><strong>{selected.filename}</strong></span></div><div><small>状态</small><strong>{statusText[selected.status] || selected.status}</strong></div><div><small>待审核课程</small><strong>{drafts.length} 条</strong></div><div><small>管理员</small><strong>{adminEmail}</strong></div></section>
          {warnings.map((warning) => <div className="notice warning" key={warning}><AlertTriangle size={17} />{warning}</div>)}
          <section className="draft-section"><div className="section-heading admin-section-heading"><div><span className="section-index">REVIEW</span><h2>待审核课程</h2></div><div className="review-actions"><button className="secondary-button small" onClick={() => selectUpload(selected)}><RefreshCw size={15} />刷新</button><button className="publish-button" disabled={busy || selected.status !== "pending_review" || !drafts.length} onClick={publish}><Rocket size={17} />确认发布</button></div></div>
            <div className="table-wrap"><table className="draft-table"><thead><tr><th>日期</th><th>时段</th><th>课程</th><th>教师</th><th>班级</th><th>教室</th><th>类型</th><th>操作</th></tr></thead><tbody>{drafts.map((course) => <tr key={course.id}><td>{course.date}</td><td>{course.period}</td><td className="course-name-cell">{course.course_name}</td><td>{course.teacher || "—"}</td><td>{course.class_name || "—"}</td><td>{course.classroom || "—"}</td><td><span className={`type-pill ${course.course_type}`}>{typeText[course.course_type]}</span></td><td><div className="row-actions"><button title="编辑" onClick={() => setEditing(course)}><Pencil size={15} /></button><button title="删除" className="danger" onClick={() => deleteDraft(course)}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>
          </section>
        </>}
      </main>
      {editing && <EditCourseModal initial={editing} onClose={() => setEditing(null)} onSave={saveDraft} />}
    </div>
  );
}

function EditCourseModal({ initial, onClose, onSave }: { initial: Course; onClose: () => void; onSave: (course: Course) => void }) {
  const [value, setValue] = useState<Course>(initial);
  const update = (key: keyof CourseInput, next: string) => setValue((current) => ({ ...current, [key]: next }));
  return <div className="modal-backdrop"><form className="edit-modal" onSubmit={(event) => { event.preventDefault(); onSave(value); }}><button type="button" className="modal-close" onClick={onClose}><X size={19} /></button><span className="eyebrow">MANUAL REVIEW</span><h2>编辑待审核课程</h2><div className="edit-grid"><label className="span-two">课程名称<input value={value.course_name} required onChange={(event) => update("course_name", event.target.value)} /></label><label>日期<input type="date" value={value.date} required onChange={(event) => update("date", event.target.value)} /></label><label>星期<input value={value.weekday} onChange={(event) => update("weekday", event.target.value)} /></label><label>时段<select value={value.period} onChange={(event) => update("period", event.target.value)}><option>上午</option><option>下午</option><option>晚上</option></select></label><label>教师<input value={value.teacher} onChange={(event) => update("teacher", event.target.value)} /></label><label>开始时间<input type="time" value={value.start_time} onChange={(event) => update("start_time", event.target.value)} /></label><label>结束时间<input type="time" value={value.end_time} onChange={(event) => update("end_time", event.target.value)} /></label><label>班级<input value={value.class_name} onChange={(event) => update("class_name", event.target.value)} /></label><label>教室<input value={value.classroom} onChange={(event) => update("classroom", event.target.value)} /></label><label>课程类型<select value={value.course_type} onChange={(event) => update("course_type", event.target.value)}><option value="tax">税务课程</option><option value="english">英语课程</option><option value="digital">数字与智能</option><option value="other">其他课程</option></select></label><label>备注<input value={value.remark} onChange={(event) => update("remark", event.target.value)} /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" type="submit">保存修改</button></div></form></div>;
}
