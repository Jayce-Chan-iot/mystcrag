-- Product Schema V2 (KNOWLEDGE_SYSTEM_SPEC section 6): additive, nullable columns only.
-- Existing rows and order snapshots are untouched; old data never silently lost.

ALTER TABLE "material_products" ADD COLUMN "length_along_string_mm" DOUBLE PRECISION;
ALTER TABLE "material_products" ADD COLUMN "hole_diameter_mm" DOUBLE PRECISION;
ALTER TABLE "material_products" ADD COLUMN "grade" TEXT;
ALTER TABLE "material_products" ADD COLUMN "visual_profile" JSONB;

ALTER TABLE "accessory_products" ADD COLUMN "length_along_string_mm" DOUBLE PRECISION;
ALTER TABLE "accessory_products" ADD COLUMN "visual_profile" JSONB;

-- Domain invariants mirroring the init migration's CHECK style:
-- string length and hole diameter, when present, must be positive.
ALTER TABLE "material_products" ADD CONSTRAINT "material_products_length_along_string_mm_positive" CHECK ("length_along_string_mm" IS NULL OR "length_along_string_mm" > 0);
ALTER TABLE "material_products" ADD CONSTRAINT "material_products_hole_diameter_mm_positive" CHECK ("hole_diameter_mm" IS NULL OR "hole_diameter_mm" > 0);
ALTER TABLE "accessory_products" ADD CONSTRAINT "accessory_products_length_along_string_mm_positive" CHECK ("length_along_string_mm" IS NULL OR "length_along_string_mm" > 0);
