CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unique_key" varchar(500) NOT NULL,
	"type" varchar(50) NOT NULL,
	"author" varchar(255) NOT NULL,
	"activity_date" timestamp with time zone NOT NULL,
	"repository" varchar(500) NOT NULL,
	"url" text,
	"title" text,
	"description" text,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_activities_unique_key" UNIQUE("unique_key")
);
--> statement-breakpoint
CREATE INDEX "idx_activities_type" ON "activities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_activities_author" ON "activities" USING btree ("author");--> statement-breakpoint
CREATE INDEX "idx_activities_date" ON "activities" USING btree ("activity_date");--> statement-breakpoint
CREATE INDEX "idx_activities_repository" ON "activities" USING btree ("repository");--> statement-breakpoint
CREATE INDEX "idx_activities_created_at" ON "activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_activities_author_date" ON "activities" USING btree ("author","activity_date");--> statement-breakpoint
CREATE INDEX "idx_activities_repo_date" ON "activities" USING btree ("repository","activity_date");--> statement-breakpoint
CREATE INDEX "idx_activities_unique_key" ON "activities" USING btree ("unique_key");