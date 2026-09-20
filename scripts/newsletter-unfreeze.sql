-- Recovery only: first reconcile all writes made to the new destination.
BEGIN;
DROP TRIGGER IF EXISTS subscriber_moved ON subscriber;
DROP FUNCTION IF EXISTS subscriber_moved();
COMMIT;
