// setup-db.js — cria tabelas e popula dados iniciais
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 A criar tabelas...');

  // Criar tabelas via SQL raw
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Room" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL UNIQUE,
      "type" TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "pricePerNight" DOUBLE PRECISION NOT NULL,
      "capacity" INTEGER NOT NULL,
      "sizeSqm" DOUBLE PRECISION,
      "bedrooms" INTEGER,
      "beds" INTEGER,
      "amenities" TEXT[] DEFAULT '{}',
      "images" TEXT[] DEFAULT '{}',
      "bookingIcalUrl" TEXT,
      "airbnbIcalUrl" TEXT,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Guest" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "email" TEXT NOT NULL UNIQUE,
      "phone" TEXT,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "ReservationStatus" AS ENUM ('PENDING','CONFIRMED','DECLINED','CANCELLED','COMPLETED','PAID');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Reservation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checkIn" TIMESTAMP NOT NULL,
      "checkOut" TIMESTAMP NOT NULL,
      "nights" INTEGER NOT NULL,
      "guests" INTEGER NOT NULL,
      "totalPrice" DOUBLE PRECISION NOT NULL,
      "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
      "breakfast" BOOLEAN NOT NULL DEFAULT true,
      "specialRequests" TEXT,
      "stripePaymentId" TEXT,
      "paidAt" TIMESTAMP,
      "notes" TEXT,
      "roomId" TEXT NOT NULL REFERENCES "Room"("id"),
      "guestId" TEXT NOT NULL REFERENCES "Guest"("id"),
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Reservation"
      ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT,
      ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT,
      ADD COLUMN IF NOT EXISTS "paymentExpiresAt" TIMESTAMP;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Reservation_stripeCheckoutSessionId_key"
      ON "Reservation"("stripeCheckoutSessionId");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Reservation_stripeRefundId_key"
      ON "Reservation"("stripeRefundId");
  `);

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "BlockedDateSource" AS ENUM ('MANUAL', 'BOOKING_COM', 'AIRBNB');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BlockedDate" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "date" TIMESTAMP NOT NULL,
      "reason" TEXT,
      "source" "BlockedDateSource" NOT NULL DEFAULT 'MANUAL',
      "externalUid" TEXT,
      "roomId" TEXT NOT NULL REFERENCES "Room"("id"),
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE("roomId", "date")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Admin" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL UNIQUE,
      "password" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Preços: configuração por unidade, preços por datas e idades nas reservas
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Room"
      ADD COLUMN IF NOT EXISTS "weekendPrice" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "baseOccupancy" INTEGER,
      ADD COLUMN IF NOT EXISTS "fewerGuestDiscountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "extraGuestFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "cribFeePerNight" DOUBLE PRECISION NOT NULL DEFAULT 0;
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "Room" SET "baseOccupancy" = CASE UPPER("type") WHEN 'T2' THEN 4 WHEN 'T3' THEN 6 ELSE "capacity" END
    WHERE "baseOccupancy" IS NULL;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "PriceRuleKind" AS ENUM ('SEASON', 'HOLIDAY');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PriceRule" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "kind" "PriceRuleKind" NOT NULL,
      "startDate" TIMESTAMP NOT NULL,
      "endDate" TIMESTAMP NOT NULL,
      "price" DOUBLE PRECISION NOT NULL,
      "weekendPrice" DOUBLE PRECISION,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "roomId" TEXT NOT NULL REFERENCES "Room"("id") ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PriceRule_roomId_idx" ON "PriceRule"("roomId");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Promotion" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "startDate" TIMESTAMP NOT NULL,
      "endDate" TIMESTAMP NOT NULL,
      "discountPct" DOUBLE PRECISION NOT NULL,
      "minNights" INTEGER NOT NULL DEFAULT 1,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "roomId" TEXT REFERENCES "Room"("id") ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Reservation"
      ADD COLUMN IF NOT EXISTS "adults" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "teens" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "children" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "infants" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "priceBreakdown" JSONB;
  `);

  // Segurança: data da última mudança de password e contactos guardados em cada reserva
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Reservation"
      ADD COLUMN IF NOT EXISTS "contactName" TEXT,
      ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
  `);
  // Idioma em que o hóspede preencheu o formulário (emails no mesmo idioma)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'pt';
  `);

  // Lotação atual: T2 até 6 (cama extra insuflável e sofá), T3 até 8 (sofá-cama).
  // Só altera os valores antigos conhecidos, para não sobrescrever alterações feitas no painel.
  await prisma.$executeRawUnsafe(`
    UPDATE "Room"
    SET "capacity" = CASE UPPER("type") WHEN 'T2' THEN 6 ELSE 8 END, "updatedAt" = NOW()
    WHERE (UPPER("type") = 'T2' AND "capacity" = 4)
       OR (UPPER("type") = 'T3' AND "capacity" IN (6, 9));
  `);

  console.log('✅ Tabelas criadas.');

  // Seed de dados
  console.log('🌱 A popular dados...');

  const { randomUUID: uuidv4 } = require('crypto');

  // Administrador: só com ADMIN_EMAIL e ADMIN_PASSWORD definidos (nunca com uma password por omissão)
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const strongPassword = typeof adminPassword === 'string' && adminPassword.length >= 12 && adminPassword !== 'admin1234';
  if (adminEmail && strongPassword) {
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    await prisma.$executeRaw`
      INSERT INTO "Admin" ("id", "email", "password", "name")
      VALUES (${uuidv4()}, ${adminEmail}, ${hashedPassword}, 'Administrador')
      ON CONFLICT ("email") DO NOTHING;
    `;
  } else {
    console.warn('⚠️  ADMIN_EMAIL/ADMIN_PASSWORD (mínimo 12 caracteres) não definidos: administrador inicial não criado.');
  }

  // Administradores que ainda tenham a antiga password por omissão: substituir por ADMIN_PASSWORD
  const admins = await prisma.$queryRaw`SELECT "id", "email", "password" FROM "Admin"`;
  for (const admin of admins) {
    if (!(await bcrypt.compare('admin1234', admin.password))) continue;
    if (strongPassword) {
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await prisma.$executeRaw`UPDATE "Admin" SET "password" = ${hashedPassword}, "passwordChangedAt" = NOW() WHERE "id" = ${admin.id}`;
      console.log(`🔐 Password por omissão de ${admin.email} substituída por ADMIN_PASSWORD.`);
    } else {
      console.error(`🚨 ${admin.email} usa a password por omissão, que está bloqueada. Defina ADMIN_PASSWORD (mínimo 12 caracteres) e reinicie.`);
    }
  }

  const rooms = [
    { name: 'Suite Panorâmica', type: 'Suite', description: 'Vista deslumbrante sobre a serra, cama king-size e banheira de hidromassagem privativa.', price: 185, capacity: 2, amenities: ['King-size','Vista serra','Jacuzzi','AC','Varanda','Wi-Fi','TV'] },
    { name: 'Quarto Deluxe', type: 'Deluxe', description: 'Espaçoso e acolhedor, com decoração em madeira natural e casa de banho em pedra.', price: 120, capacity: 2, amenities: ['Queen-size','Casa banho privada','AC','Wi-Fi','TV'] },
    { name: 'Quarto Superior', type: 'Superior', description: 'Vistas para o jardim e floresta, com cama de casal e ambiente sereno.', price: 95, capacity: 2, amenities: ['Casal','Vista jardim','AC','Wi-Fi'] },
    { name: 'Quarto Twin', type: 'Twin', description: 'Duas camas individuais, ideal para amigos ou famílias.', price: 85, capacity: 2, amenities: ['2 camas','AC','Wi-Fi','TV'] },
    { name: 'Quarto Lareira', type: 'Especial', description: 'Lareira a lenha para noites frias de inverno, cama king e ambiente íntimo.', price: 145, capacity: 2, amenities: ['King-size','Lareira','AC','Vista'] },
    { name: 'Suite Familiar', type: 'Suite', description: 'Dois quartos comunicantes, perfeita para famílias. Sala de estar privativa.', price: 220, capacity: 4, amenities: ['2 quartos','Sala estar','Cozinha','AC','Wi-Fi'] },
  ];

  for (const r of rooms) {
    const amenitiesLiteral = `'{${r.amenities.map(a => `"${a}"`).join(',')}}'`;
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Room" ("id", "name", "type", "description", "pricePerNight", "capacity", "sizeSqm", "bedrooms", "beds", "amenities", "images", "bookingIcalUrl", "airbnbIcalUrl")
      VALUES ('${uuidv4()}', '${r.name.replace(/'/g, "''")}', '${r.type}', '${r.description.replace(/'/g, "''")}', ${r.price}, ${r.capacity}, ${r.sizeSqm || 'NULL'}, ${r.bedrooms || 'NULL'}, ${r.beds || 'NULL'}, ${amenitiesLiteral}, '{}', ${r.bookingIcalUrl ? `'${r.bookingIcalUrl.replace(/'/g, "''")}'` : 'NULL'}, ${r.airbnbIcalUrl ? `'${r.airbnbIcalUrl.replace(/'/g, "''")}'` : 'NULL'})
      ON CONFLICT ("name") DO NOTHING;
    `);
    console.log(`✓ ${r.name}`);
  }

  console.log('✅ Base de dados pronta!');
}

main()
  .catch(e => { console.error('Erro:', e); })
  .finally(() => prisma.$disconnect());
