import type { Metadata } from "next";
import { VT323 } from "next/font/google";
import "./globals.css";

const vt = VT323({ weight: "400", subsets: ["latin"], variable: "--vt" });

export const metadata: Metadata = {
  title: "Wicky Chat",
  description: "The Chadwick chat app by Output Club",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={vt.variable}>
      <body>{children}</body>
    </html>
  );
}
