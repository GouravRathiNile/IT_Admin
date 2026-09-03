BEGIN;

ALTER TABLE hlpreport_master_list
  ADD COLUMN IF NOT EXISTS organizationid BIGINT;

-- Copy the previous global active configuration to every active organization.
-- The temporary map is also used to repoint existing report details to their
-- organization's new master IDs, preserving all historical report values.
CREATE TEMP TABLE hlp_master_org_map (
  old_id BIGINT NOT NULL,
  organizationid BIGINT NOT NULL,
  new_id BIGINT NOT NULL,
  PRIMARY KEY (old_id, organizationid)
) ON COMMIT DROP;

DO $$
DECLARE
  legacy_row RECORD;
  organization_row RECORD;
  generated_id BIGINT;
BEGIN
  FOR legacy_row IN
    SELECT id, title, orderby, createdby, createddatetime, modifyby, modifydatetime
    FROM hlpreport_master_list
    WHERE organizationid IS NULL AND isactive = TRUE
    ORDER BY orderby NULLS LAST, id
  LOOP
    FOR organization_row IN
      SELECT organizationid
      FROM organization_master
      WHERE isactive = TRUE AND activationstatus = TRUE AND isdeleted = FALSE
      ORDER BY organizationid
    LOOP
      INSERT INTO hlpreport_master_list
        (organizationid, title, orderby, isactive, createdby, createddatetime, modifyby, modifydatetime)
      VALUES
        (organization_row.organizationid, legacy_row.title, legacy_row.orderby, TRUE,
         legacy_row.createdby, COALESCE(legacy_row.createddatetime, CURRENT_TIMESTAMP),
         legacy_row.modifyby, legacy_row.modifydatetime)
      RETURNING id INTO generated_id;

      INSERT INTO hlp_master_org_map (old_id, organizationid, new_id)
      VALUES (legacy_row.id, organization_row.organizationid, generated_id);
    END LOOP;
  END LOOP;
END $$;

UPDATE hlpreport_entry_details detail
SET masterid = mapping.new_id
FROM hlpreport_entry_master entry,
     hlp_master_org_map mapping
WHERE detail.entryid = entry.id
  AND mapping.old_id = detail.masterid
  AND mapping.organizationid = entry.organizationid;

-- Retain legacy rows for audit/history, but remove them from active screens.
UPDATE hlpreport_master_list
SET isactive = FALSE, orderby = NULL
WHERE organizationid IS NULL AND isactive = TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hlpreport_master_list_organization_fk'
  ) THEN
    ALTER TABLE hlpreport_master_list
      ADD CONSTRAINT hlpreport_master_list_organization_fk
      FOREIGN KEY (organizationid) REFERENCES organization_master(organizationid);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_hlp_master_org_active_title
  ON hlpreport_master_list (organizationid, LOWER(title))
  WHERE isactive = TRUE AND organizationid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_hlp_master_org_active_order
  ON hlpreport_master_list (organizationid, orderby)
  WHERE isactive = TRUE AND organizationid IS NOT NULL;

COMMIT;
