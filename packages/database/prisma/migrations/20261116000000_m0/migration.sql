-- Infrastructure only; no tenant records or seeded accounts.
CREATE TABLE "system_metadata" (
  "key" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_metadata_pkey" PRIMARY KEY ("key")
);
