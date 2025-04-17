import { PrismaClient } from '@prisma/client';

// https://www.prisma.io/docs/guides/nextjs

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};

console.log(process.env.DATABASE_URL);
export const prisma = globalForPrisma.prisma || new PrismaClient({ log: ['query', 'info', 'warn', 'error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
