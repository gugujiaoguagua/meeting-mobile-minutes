import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 会议闭环",
  description: "用于会议沉淀、纪要生成、待办闭环和总裁驾驶舱。",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png"
  }
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
