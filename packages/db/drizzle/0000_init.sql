-- trigram index on gazetteer.search_text (place search in the guest form)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"payload" jsonb,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"code" text PRIMARY KEY NOT NULL,
	"group_code" text NOT NULL,
	"label" text NOT NULL,
	"sort" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_groups" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"sort" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coop_places" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"ext_id" text NOT NULL,
	"name" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"distance_km" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cooperation_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"category_code" text NOT NULL,
	"tuke_units" text[] DEFAULT '{}'::text[] NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"since" text,
	"source_url" text NOT NULL,
	"confidence" text NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"name_sk" text NOT NULL,
	"name_en" text NOT NULL,
	"continent" char(2),
	"lat" double precision,
	"lon" double precision,
	"is_hidden" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"sha256" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"stats" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_imports_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"code_hash" text,
	"display_scene" text DEFAULT 'cooperation' NOT NULL,
	"display_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"page" text NOT NULL,
	"message" text NOT NULL,
	"author" text,
	"status" text DEFAULT 'new' NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gazetteer" (
	"geoname_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ascii_name" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"admin1" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"population" integer DEFAULT 0 NOT NULL,
	"search_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"ext_id" text NOT NULL,
	"place_id" integer NOT NULL,
	"name" text NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"country_code" char(2) NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pins" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"submission_id" uuid NOT NULL,
	"geoname_id" integer,
	"country_code" char(2) NOT NULL,
	"place_name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"visit_kind" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" integer NOT NULL,
	"device_hash" text NOT NULL,
	"ip_hash" text,
	"person_role" text,
	"faculty" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_group_code_category_groups_code_fk" FOREIGN KEY ("group_code") REFERENCES "public"."category_groups"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coop_places" ADD CONSTRAINT "coop_places_import_id_dataset_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."dataset_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coop_places" ADD CONSTRAINT "coop_places_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooperation_links" ADD CONSTRAINT "cooperation_links_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooperation_links" ADD CONSTRAINT "cooperation_links_category_code_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gazetteer" ADD CONSTRAINT "gazetteer_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_import_id_dataset_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."dataset_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_place_id_coop_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."coop_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_geoname_id_gazetteer_geoname_id_fk" FOREIGN KEY ("geoname_id") REFERENCES "public"."gazetteer"("geoname_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_action_time" ON "admin_audit" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coop_places_import_ext" ON "coop_places" USING btree ("import_id","ext_id");--> statement-breakpoint
CREATE INDEX "links_institution" ON "cooperation_links" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "links_category" ON "cooperation_links" USING btree ("category_code");--> statement-breakpoint
CREATE INDEX "gazetteer_search_trgm" ON "gazetteer" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "gazetteer_country" ON "gazetteer" USING btree ("country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_import_ext" ON "institutions" USING btree ("import_id","ext_id");--> statement-breakpoint
CREATE INDEX "institutions_place" ON "institutions" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "pins_event_cursor" ON "pins" USING btree ("event_id","id");--> statement-breakpoint
CREATE INDEX "pins_submission" ON "pins" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submissions_device" ON "submissions" USING btree ("event_id","device_hash","created_at");--> statement-breakpoint
CREATE INDEX "submissions_ip" ON "submissions" USING btree ("event_id","ip_hash","created_at");