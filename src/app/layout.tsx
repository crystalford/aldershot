import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aldershot - Video Pipeline",
  description: "Automated video ingestion, analysis, and publishing pipeline",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 antialiased">{children}</body>
    </html>
  );
}
