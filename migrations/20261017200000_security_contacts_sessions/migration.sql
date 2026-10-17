-- Sessões do painel terminam ao mudar a password
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

-- Nome e telefone indicados em cada pedido de reserva
ALTER TABLE "Reservation"
  ADD COLUMN IF NOT EXISTS "contactName" TEXT,
  ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
