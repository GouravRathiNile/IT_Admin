-- Scope department names and short names to an organization.
-- Run this migration once against the IT Admin PostgreSQL database.

BEGIN;

-- Abort before changing constraints if organization-scoped active duplicates
-- already exist (for example, from an older/manual schema change).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM Department_Master
    WHERE IsDeleted = FALSE
    GROUP BY OrganizationID, DepartmentName
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot migrate Department_Master: duplicate active DepartmentName values exist within an organization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM Department_Master
    WHERE IsDeleted = FALSE
    GROUP BY OrganizationID, DepartmentShortName
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot migrate Department_Master: duplicate active DepartmentShortName values exist within an organization';
  END IF;
END
$$;

-- Remove the global single-column unique constraints/indexes. Catalog lookup
-- also handles deployments where PostgreSQL generated a different name.
DO $$
DECLARE
  department_table REGCLASS := to_regclass('department_master');
  item RECORD;
BEGIN
  IF department_table IS NULL THEN
    RAISE EXCEPTION 'Department_Master table does not exist';
  END IF;

  FOR item IN
    SELECT
      ns.nspname AS schema_name,
      tbl.relname AS table_name,
      idx.relname AS index_name,
      con.conname AS constraint_name
    FROM pg_index pi
    JOIN pg_class tbl ON tbl.oid = pi.indrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_class idx ON idx.oid = pi.indexrelid
    JOIN pg_attribute attr
      ON attr.attrelid = tbl.oid
     AND attr.attnum = pi.indkey[0]
    LEFT JOIN pg_constraint con ON con.conindid = pi.indexrelid
    WHERE tbl.oid = department_table
      AND pi.indisunique
      AND pi.indpred IS NULL
      AND pi.indexprs IS NULL
      AND pi.indnkeyatts = 1
      AND lower(attr.attname) IN ('departmentname', 'departmentshortname')
  LOOP
    IF item.constraint_name IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        item.schema_name,
        item.table_name,
        item.constraint_name
      );
    ELSE
      EXECUTE format(
        'DROP INDEX %I.%I',
        item.schema_name,
        item.index_name
      );
    END IF;
  END LOOP;
END
$$;

CREATE UNIQUE INDEX department_master_active_org_name_uidx
  ON Department_Master (OrganizationID, DepartmentName)
  WHERE IsDeleted = FALSE;

CREATE UNIQUE INDEX department_master_active_org_short_name_uidx
  ON Department_Master (OrganizationID, DepartmentShortName)
  WHERE IsDeleted = FALSE;

COMMIT;
