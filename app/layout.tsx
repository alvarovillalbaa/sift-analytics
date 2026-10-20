import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Sift — A conversation with your data',
  description: 'Connect your data. Ask a question. Build a view. Private, reproducible conversational analytics powered by eve and DuckDB.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
