-- Review and apply explicitly before enabling the Guest Glitch workflow APIs.
CREATE TABLE IF NOT EXISTS guest_glitch_flow_config (
    FlowConfigID BIGSERIAL PRIMARY KEY,
    OrganizationID BIGINT NOT NULL REFERENCES organization_master(OrganizationID),
    StageKey VARCHAR(80) NOT NULL,
    StageName VARCHAR(120) NOT NULL,
    StageOrder INTEGER NOT NULL CHECK (StageOrder > 0),
    IsFinalStage BOOLEAN NOT NULL DEFAULT FALSE,
    IsActive BOOLEAN NOT NULL DEFAULT TRUE,
    IsDeleted BOOLEAN NOT NULL DEFAULT FALSE,
    CreatedBy BIGINT,
    CreatedDate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy BIGINT,
    ModifiedDate TIMESTAMP,
    DeletedBy BIGINT,
    DeletedDate TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_glitch_flow_stage_key
ON guest_glitch_flow_config (OrganizationID, StageKey) WHERE IsDeleted = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_glitch_flow_stage_order
ON guest_glitch_flow_config (OrganizationID, StageOrder) WHERE IsDeleted = FALSE;

CREATE TABLE IF NOT EXISTS guest_glitch_flow_config_detail (
    FlowConfigDetailID BIGSERIAL PRIMARY KEY,
    FlowConfigID BIGINT NOT NULL REFERENCES guest_glitch_flow_config(FlowConfigID),
    ActorType VARCHAR(30) NOT NULL CHECK (ActorType IN ('USER_ID','USER_TYPE','DEPARTMENT_ID','CREATOR')),
    ActorValue VARCHAR(100),
    CanView BOOLEAN NOT NULL DEFAULT TRUE,
    CanEdit BOOLEAN NOT NULL DEFAULT FALSE,
    CanProceed BOOLEAN NOT NULL DEFAULT FALSE,
    EditableFields JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(EditableFields) = 'array'),
    RequiredActionFields JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(RequiredActionFields) = 'array'),
    IsActive BOOLEAN NOT NULL DEFAULT TRUE,
    IsDeleted BOOLEAN NOT NULL DEFAULT FALSE,
    CreatedBy BIGINT,
    CreatedDate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy BIGINT,
    ModifiedDate TIMESTAMP,
    DeletedBy BIGINT,
    DeletedDate TIMESTAMP,
    CHECK ((ActorType = 'CREATOR' AND ActorValue IS NULL) OR (ActorType <> 'CREATOR' AND NULLIF(BTRIM(ActorValue), '') IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_guest_glitch_flow_detail_active
ON guest_glitch_flow_config_detail (FlowConfigID, ActorType, ActorValue)
WHERE IsDeleted = FALSE AND IsActive = TRUE;

ALTER TABLE guest_glitch_entry_master
ADD COLUMN IF NOT EXISTS CurrentWorkflowStage VARCHAR(80);

-- Existing rows are intentionally not assigned a guessed stage. After configuring
-- each organization, backfill them to that organization's first stage explicitly.
