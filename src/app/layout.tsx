import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Financial Agent",
  description:
    "Hackaholics 7.0 financial workflow prototype. Prepare, review, approve and track Nigerian transfers.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
