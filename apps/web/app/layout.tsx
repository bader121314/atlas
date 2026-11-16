import type { ReactNode } from 'react';
export const metadata = {
  title: 'Atlas',
  description: 'Collaborative workspace — development foundation',
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
