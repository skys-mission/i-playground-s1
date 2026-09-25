import type { Metadata } from "next";

export const metadata: Metadata = { title: "模型配置" };

export default function ModelsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
