-- Idioma em que o hóspede preencheu o formulário: os emails seguem o mesmo idioma
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'pt';
