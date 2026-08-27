BEGIN;

LOCK TABLE incident_report_entry_master IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  current_max BIGINT;
BEGIN
  IF to_regclass('incident_report_id_seq') IS NULL THEN
    CREATE SEQUENCE incident_report_id_seq
      AS BIGINT
      START WITH 1
      INCREMENT BY 1
      MINVALUE 1
      NO CYCLE;

    SELECT COALESCE(MAX(id::BIGINT), 0)
      INTO current_max
      FROM incident_report_entry_master
     WHERE id ~ '^[0-9]{1,10}$';

    IF current_max > 0 THEN
      PERFORM setval('incident_report_id_seq', current_max, TRUE);
    ELSE
      PERFORM setval('incident_report_id_seq', 1, FALSE);
    END IF;
  END IF;
END $$;

COMMIT;
