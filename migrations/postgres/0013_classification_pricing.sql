ALTER TABLE app_usage ADD COLUMN classifications INTEGER CHECK(classifications>=0);
ALTER TABLE app_usage ADD COLUMN escalations INTEGER CHECK(escalations>=0);
