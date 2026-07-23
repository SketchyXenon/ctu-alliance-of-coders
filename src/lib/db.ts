import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Lazy init: only create the client (and read env) on first access.
// This avoids breaking `next build` when env vars aren't set yet.
function createClient() {
  const isProd = process.env.NODE_ENV === 'production'
  return new PrismaClient({
    log: isProd ? ['error'] : ['error', 'warn'],
  })
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
