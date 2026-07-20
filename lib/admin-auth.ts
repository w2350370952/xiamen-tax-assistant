import { getChatGPTUser } from "@/app/chatgpt-auth";

function configuredAdminEmail(): string {
  const value = (globalThis as unknown as { __SITES_ENV?: Record<string, string | undefined> }).__SITES_ENV?.ADMIN_EMAIL;
  return (value ?? "").trim().toLowerCase();
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const configured = configuredAdminEmail();
  return Boolean(configured && email && email.trim().toLowerCase() === configured);
}

export async function isAdminRequest(request: Request): Promise<boolean> {
  return isAdminEmail(request.headers.get("oai-authenticated-user-email"));
}

export async function getAdminUser() {
  const user = await getChatGPTUser();
  return user && isAdminEmail(user.email) ? user : null;
}

export function unauthorizedResponse() {
  return Response.json({ error: "只有管理员可以执行此操作" }, { status: 403 });
}
