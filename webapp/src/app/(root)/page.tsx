import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import TodoItemComponent from './components/TodoItem';
import CreateTodoForm from './components/CreateTodoForm';
import { TodoItemStatus } from '@prisma/client';
import Header from '@/components/Header';

export default async function Home() {
  const { userId } = await getSession();

  const todos = await prisma.todoItem.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  const pendingTodos = todos.filter((todo) => todo.status === TodoItemStatus.PENDING);
  const completedTodos = todos.filter((todo) => todo.status === TodoItemStatus.COMPLETED);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <CreateTodoForm userId={userId} />

          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Pending Tasks ({pendingTodos.length})</h2>
            {pendingTodos.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No pending tasks. Great job!</p>
            ) : (
              <div>
                {pendingTodos.map((todo) => (
                  <TodoItemComponent key={todo.id} todo={todo} />
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Completed Tasks ({completedTodos.length})</h2>
            {completedTodos.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No completed tasks yet.</p>
            ) : (
              <div>
                {completedTodos.map((todo) => (
                  <TodoItemComponent key={todo.id} todo={todo} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
