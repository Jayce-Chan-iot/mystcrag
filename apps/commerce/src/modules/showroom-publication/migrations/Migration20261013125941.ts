import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261013125941 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "showroom_approval_record" ("id" text not null, "subject_kind" text not null, "subject_ref" text not null, "public_revision" integer not null, "authorization" jsonb not null, "availability" text null, "prices" jsonb null, "locales" jsonb not null, "media" jsonb not null, "audit" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "showroom_approval_record_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_showroom_approval_record_deleted_at" ON "showroom_approval_record" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "showroom_approval_record" cascade;`);
  }

}
