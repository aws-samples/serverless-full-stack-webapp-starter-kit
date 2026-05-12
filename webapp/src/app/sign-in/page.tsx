import { Sparkles, ArrowRight } from 'lucide-react';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-4">
      {/* Animated background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-[120px] animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-500/8 rounded-full blur-[100px] animate-float" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-[150px]" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-md animate-fade-in-up">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center shadow-2xl glow-violet mb-5">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold gradient-text tracking-tight mb-2">
            Shegxy Tasks
          </h1>
          <p className="text-zinc-500 text-center text-sm">
            Your premium task management experience
          </p>
        </div>

        {/* Sign In Card */}
        <div className="glass-card rounded-2xl p-8 animate-scale-in" style={{ animationDelay: '0.15s' }}>
          <h2 className="text-lg font-semibold text-zinc-200 text-center mb-2">
            Welcome back
          </h2>
          <p className="text-sm text-zinc-500 text-center mb-8">
            Sign in to continue managing your tasks
          </p>

          {/* Use <a> instead of <Link> to trigger a full-page navigation.
              The sign-in route returns a 302 redirect to Cognito, which
              would cause a CORS error if fetched via client-side navigation. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/api/auth/sign-in"
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl btn-primary text-base font-semibold group"
          >
            Sign in with Cognito
            <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
          </a>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-zinc-600 mt-8">
          © {new Date().getFullYear()} Shegxy. All rights reserved.
        </p>
      </div>
    </div>
  );
}
