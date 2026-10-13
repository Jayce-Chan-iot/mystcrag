import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261013140512 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "showroom_approval_record" drop constraint if exists "showroom_approval_record_subject_kind_subject_ref_unique";`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_showroom_approval_record_subject_kind_subject_ref_unique" ON "showroom_approval_record" ("subject_kind", "subject_ref") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_showroom_approval_record_subject_kind_subject_ref_unique";`);
  }

}
