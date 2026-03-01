import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aldershot — AI Film Studio",
  description: "Generate scripts, storyboards, and shot lists for music videos and cinematic films",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}
