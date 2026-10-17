#!/usr/bin/env node
require('dotenv').config({ quiet: true });


async function main() {
  const prisma = require('../src/lib/prismaClient').createPrismaClient();
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL is not set.');
    console.error('Create a .env file from .env.example and set DATABASE_URL to your PostgreSQL connection string.');
    process.exit(1);
  }

  try {
    await prisma.$connect();
    await prisma.$queryRawUnsafe('SELECT 1');

    console.log('✅ Database connection successful.');
    console.log(`Using database: ${databaseUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
    console.log('You can now run: npm run db:setup');
  } catch (error) {
    console.error('❌ Unable to connect to PostgreSQL.');
    console.error(error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('- Make sure PostgreSQL is running.');
    console.error('- Create the database if needed (for example: createdb casadaserra).');
    console.error('- Check your DATABASE_URL in .env.');
    console.error('- Example: postgresql://postgres:postgres@localhost:5432/casadaserra?schema=public');
    console.error('- If you are using Railway, paste the Railway-generated DATABASE_URL into .env.');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
