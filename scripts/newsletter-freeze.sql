-- Apply only to the old newsletter database immediately before final copy.
-- DDL waits for in-flight subscriber writes, so all successful writes are copied.
BEGIN;
CREATE OR REPLACE FUNCTION subscriber_moved() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Newsletter storage moved; retry confirmation on classifier.dev.';
END;
$$;
CREATE TRIGGER subscriber_moved BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON subscriber
  FOR EACH STATEMENT EXECUTE FUNCTION subscriber_moved();
COMMIT;
