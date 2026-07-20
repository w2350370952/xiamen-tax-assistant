import Link from "next/link";
import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import AdminClient from "@/components/admin-client";
import { isAdminEmail } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireChatGPTUser("/admin");
  if (!isAdminEmail(user.email)) {
    return (
      <main className="access-page">
        <div className="access-card">
          <div className="brand-mark">MT</div>
          <span className="eyebrow">ACCESS DENIED</span>
          <h1>此账号不是课程管理员</h1>
          <p>学生可以正常查看课表，但只有站点管理员账号能够上传和发布PDF。</p>
          <div className="access-actions">
            <Link className="primary-button" href="/">返回学生端</Link>
            <a className="secondary-button" href={chatGPTSignOutPath("/admin")}>切换账号</a>
          </div>
        </div>
      </main>
    );
  }
  return <AdminClient adminName={user.fullName ?? "课程管理员"} adminEmail={user.email} />;
}

