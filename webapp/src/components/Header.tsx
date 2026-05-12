import Link from 'next/link';
import { Sparkles, LogOut } from 'lucide-react';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 glass-card border-b border-white/[0.06]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shadow-lg glow-violet transition-all duration-300 group-hover:scale-105">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold gradient-text tracking-tight">
              Shegxy
            </span>
          </Link>

          {/* Sign Out */}
          <div>
            {/* Use <a> instead of <Link> to trigger a full-page navigation.
                The sign-out route returns a 302 redirect to Cognito, which
                would cause a CORS error if fetched via client-side navigation. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/auth/sign-out"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl text-zinc-400 border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:text-zinc-200 hover:border-white/[0.15] transition-all duration-200"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
