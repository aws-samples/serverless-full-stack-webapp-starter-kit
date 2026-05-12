import './globals.css';
import { Toaster } from 'sonner';
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: 'Shegxy Tasks — Premium Task Management',
  description:
    'Organize your life with Shegxy Tasks. A beautiful, modern task management app with priorities, due dates, and categories.',
  robots: 'noindex, nofollow',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body className={inter.className}>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'rgba(20, 20, 32, 0.95)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: '#e8e8ed',
              fontSize: '0.875rem',
            },
          }}
        />
      </body>
    </html>
  );
}
