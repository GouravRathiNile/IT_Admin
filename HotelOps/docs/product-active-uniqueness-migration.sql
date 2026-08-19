-- Allow a soft-deleted product name or label to be used by a new product.
-- Run this migration once against the IT Admin PostgreSQL database.

BEGIN;

-- Abort without changing indexes if active duplicates already exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM Product_Master
    WHERE IsDeleted = FALSE
    GROUP BY ProductName
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot migrate Product_Master: duplicate active ProductName values exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM Product_Master
    WHERE IsDeleted = FALSE
    GROUP BY ProductLabel
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot migrate Product_Master: duplicate active ProductLabel values exist';
  END IF;
END
$$;

-- Remove single-column, global unique constraints/indexes on ProductName and
-- ProductLabel. Catalog lookup avoids depending on deployment-specific names.
DO $$
DECLARE
  product_table REGCLASS := to_regclass('product_master');
  item RECORD;
BEGIN
  IF product_table IS NULL THEN
    RAISE EXCEPTION 'Product_Master table does not exist';
  END IF;

  FOR item IN
    SELECT
      ns.nspname AS schema_name,
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
    WHERE tbl.oid = product_table
      AND pi.indisunique
      AND pi.indpred IS NULL
      AND pi.indexprs IS NULL
      AND pi.indnkeyatts = 1
      AND lower(attr.attname) IN ('productname', 'productlabel')
  LOOP
    IF item.constraint_name IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        item.schema_name,
        'product_master',
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

-- Plain column indexes preserve the former case-sensitive equality behavior.
CREATE UNIQUE INDEX product_master_active_productname_uidx
  ON Product_Master (ProductName)
  WHERE IsDeleted = FALSE;

CREATE UNIQUE INDEX product_master_active_productlabel_uidx
  ON Product_Master (ProductLabel)
  WHERE IsDeleted = FALSE;

COMMIT;
