import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/auth';
import CreateTodoForm from './components/CreateTodoForm';
import Header from '@/components/Header';
import TodoList from './components/TodoList';

export default async function Home() {
  const { userId } = await getAuthSession();

  const todos = await prisma.todoItem.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-grow">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          {/* Page Header */}
          <div className="mb-8 animate-fade-in-up">
            <h1 className="text-2xl font-bold text-zinc-100 mb-1">
              My Tasks
            </h1>
            <p className="text-sm text-zinc-500">
              Organize, prioritize, and conquer your day.
            </p>
          </div>

          {/* Create Todo */}
          <CreateTodoForm userId={userId} />

          {/* Todo List with Search, Filters, Stats */}
          <TodoList todos={todos} userId={userId} />
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-zinc-700 border-t border-white/[0.04]">
        © {new Date().getFullYear()} Shegxy. Built with ✨
      </footer>
    </div>
  );
}
