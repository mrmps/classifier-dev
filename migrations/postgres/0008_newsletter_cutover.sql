-- The copy installs this guard after verification; activation removes it.
CREATE FUNCTION subscriber_cutover_pending() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Newsletter cutover is pending; retry confirmation shortly.';
END;
$$;
