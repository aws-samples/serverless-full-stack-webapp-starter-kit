import { Prisma, PrismaClient } from '@prisma/client';

// https://www.prisma.io/docs/guides/nextjs

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};

// Determine if an error is a transient connection issue that may resolve on retry.
// Aurora Serverless v2 can drop connections due to idle_session_timeout (60s) or auto-pause,
// and resume takes approximately 15 seconds.
// https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  if (
    code === 'P2024' || // Connection pool timeout
    code === 'P1001' || // Can't reach database server
    code === 'P1017' // Server has closed the connection
  ) {
    return true;
  }
  const msg = error.message;
  return (
    msg.includes('idle-session timeout') ||
    msg.includes('terminating connection') ||
    msg.includes('Connection terminated') ||
    msg.includes('Timed out fetching a new connection from the connection pool') ||
    msg.includes('ECONNRESET')
  );
}

const basePrisma = new PrismaClient();

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 0) {
        console.warn(`Prisma query succeeded after ${attempt} retry(s)`);
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableError(error)) throw error;
      // Discard stale connections before retrying
      await basePrisma.$disconnect();
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
      console.warn(`Prisma retry attempt ${attempt + 1}/${maxRetries}, waiting ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

const retryExtension = Prisma.defineExtension({
  name: 'retry-on-connection-error',
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        return withRetry(() => query(args));
      },
    },
  },
});

export const prisma = basePrisma.$extends(retryExtension) as unknown as PrismaClient;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
