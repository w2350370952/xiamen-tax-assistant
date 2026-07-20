import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "厦国会税务专硕助手",
  description: "厦门国家会计学院税务专硕智能课程管理系统",
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

