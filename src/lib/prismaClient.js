// Prisma 7 liga ao Postgres através do driver "pg" (endereço em DATABASE_URL)
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

function createPrismaClient() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
}

module.exports = { createPrismaClient };
