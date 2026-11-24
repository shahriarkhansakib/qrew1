CREATE TABLE "platform_security_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"require_platform_mfa" boolean NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_security_settings" ADD CONSTRAINT "platform_security_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;