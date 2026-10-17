// Configuração do Prisma 7: o endereço da base de dados deixou de estar no schema
import { config } from 'dotenv';
config({ quiet: true });
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'migrations' },
  // Só as migrações precisam do endereço; gerar o cliente (npm install) funciona sem ele
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
