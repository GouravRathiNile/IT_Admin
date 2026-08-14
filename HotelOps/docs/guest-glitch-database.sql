-- Review and apply explicitly before using Guest Glitch APIs.
CREATE TABLE IF NOT EXISTS guest_glitch_option_master
(
    OptionID BIGSERIAL PRIMARY KEY,
    OrganizationID BIGINT NOT NULL,
    OptionType VARCHAR(60) NOT NULL,
    OptionValue VARCHAR(100) NOT NULL,
    DisplayName VARCHAR(100) NOT NULL,
    Metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    SortOrder INTEGER NOT NULL DEFAULT 0,
    IsActive BOOLEAN NOT NULL DEFAULT TRUE,
    IsDeleted BOOLEAN NOT NULL DEFAULT FALSE,
    CreatedBy BIGINT,
    CreatedDate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy BIGINT,
    ModifiedDate TIMESTAMP,
    DeletedBy BIGINT,
    DeletedDate TIMESTAMP,
    CONSTRAINT FK_GuestGlitchOption_Organization
        FOREIGN KEY (OrganizationID) REFERENCES organization_master(OrganizationID),
    CONSTRAINT CHK_GuestGlitchOption_Metadata
        CHECK (JSONB_TYPEOF(Metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_glitch_option_active
ON guest_glitch_option_master (OrganizationID, OptionType, OptionValue)
WHERE IsDeleted = FALSE;

INSERT INTO guest_glitch_option_master
    (OrganizationID, OptionType, OptionValue, DisplayName, Metadata, SortOrder)
SELECT om.OrganizationID, seed.OptionType, seed.OptionValue, seed.DisplayName,
       seed.Metadata::JSONB, seed.SortOrder
FROM organization_master om
CROSS JOIN (VALUES
    ('Status', 'Open', 'Open', '{"allowedNext":["In Progress"]}', 1),
    ('Status', 'In Progress', 'In Progress', '{"allowedNext":["Resolved"]}', 2),
    ('Status', 'Resolved', 'Resolved', '{"allowedNext":["Closed"],"requiresResolvedBy":true}', 3),
    ('Status', 'Closed', 'Closed', '{"allowedNext":[]}', 4)
) AS seed(OptionType, OptionValue, DisplayName, Metadata, SortOrder)
WHERE om.IsActive = TRUE AND om.IsDeleted = FALSE
ON CONFLICT (OrganizationID, OptionType, OptionValue) WHERE IsDeleted = FALSE DO NOTHING;

-- Recommended indexes. Review against production query plans before applying.
CREATE INDEX IF NOT EXISTS idx_guest_glitch_org_active_entrydate
ON guest_glitch_entry_master (OrganizationID, IsDeleted, EntryDate DESC, ID DESC);

CREATE INDEX IF NOT EXISTS idx_guest_glitch_org_status_entrydate
ON guest_glitch_entry_master (OrganizationID, Status, EntryDate DESC)
WHERE IsDeleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_guest_glitch_departmentids_gin
ON guest_glitch_entry_master USING GIN (DepartmentIDs jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_guest_glitch_receivedbyids_gin
ON guest_glitch_entry_master USING GIN (ReceivedByIDs jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_guest_glitch_informedtoids_gin
ON guest_glitch_entry_master USING GIN (InformedToIDs jsonb_path_ops);
