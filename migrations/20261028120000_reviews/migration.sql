-- Avaliações das estadias
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "reviewRequestSentAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "Review" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reservationId" TEXT NOT NULL UNIQUE,
  "roomId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "cleanliness" INTEGER,
  "comfort" INTEGER,
  "location" INTEGER,
  "comment" TEXT NOT NULL DEFAULT '',
  "displayName" TEXT NOT NULL,
  "consent" BOOLEAN NOT NULL DEFAULT false,
  "locale" TEXT NOT NULL DEFAULT 'pt',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "ownerReply" TEXT,
  "ownerReplyAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
