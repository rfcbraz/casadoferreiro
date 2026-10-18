-- Berços partilhados pelas casas: número pedido em cada reserva, total e registos manuais
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "cribs" INTEGER;
UPDATE "Reservation" SET "cribs" = COALESCE("infants", 0) WHERE "cribs" IS NULL;
ALTER TABLE "Reservation" ALTER COLUMN "cribs" SET DEFAULT 0, ALTER COLUMN "cribs" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "Setting" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "CribHold" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "cribs" INTEGER NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
