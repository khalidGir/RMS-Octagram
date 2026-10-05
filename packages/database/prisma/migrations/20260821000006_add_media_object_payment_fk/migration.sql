-- Add foreign key constraint from MediaObject.paymentId to Payment.id.
-- ON DELETE SET NULL: if a payment is deleted, media objects retain but lose the link.
ALTER TABLE "MediaObject"
  ADD CONSTRAINT "MediaObject_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
