import Link from 'next/link';

export default function Header() {
  return (
    <header className="bg-indigo-600 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex-shrink-0">
            <Link href="/" className="text-xl font-bold">
              Todo App
            </Link>
          </div>
          <div>
            {/* Use <a> instead of <Link> to trigger a full-page navigation.
                The sign-out route returns a 302 redirect to Cognito, which
                would cause a CORS error if fetched via client-side navigation. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/auth/sign-out"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-indigo-600 bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Sign Out
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
