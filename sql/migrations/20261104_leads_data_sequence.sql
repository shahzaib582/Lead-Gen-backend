-- Remove application-side max(id)+1 allocation; repair the DB-owned sequence once.
BEGIN;
DO $$
DECLARE seq_name TEXT; highest BIGINT; sequence_value BIGINT;
BEGIN
  IF to_regclass('public.leads_data') IS NULL THEN RETURN; END IF;
  LOCK TABLE public.leads_data IN ACCESS EXCLUSIVE MODE;
  seq_name := pg_get_serial_sequence('public.leads_data', 'id');
  IF seq_name IS NULL THEN
    RAISE EXCEPTION 'leads_data.id requires a database-owned bigint sequence/identity';
  END IF;
  SELECT max(id) INTO highest FROM public.leads_data;
  EXECUTE format('SELECT last_value FROM %s', seq_name) INTO sequence_value;
  IF highest IS NOT NULL THEN
    PERFORM setval(seq_name, greatest(highest, sequence_value), true);
  END IF;
END $$;
COMMIT;
