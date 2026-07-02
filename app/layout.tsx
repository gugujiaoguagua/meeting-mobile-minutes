import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "拉迷集团 AI 会议闭环系统 Demo",
  description: "用于展示会议沉淀、纪要生成、待办闭环和总裁驾驶舱的本地 Demo"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
