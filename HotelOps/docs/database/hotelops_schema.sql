-- HotelOps local PostgreSQL schema reconstruction
-- Reconstructed offline from application SQL and existing migrations.
-- No seed or business data is included.
-- Unquoted identifiers intentionally preserve compatibility with the application's
-- case-insensitive PostgreSQL identifiers (for example OrganizationID -> organizationid).

BEGIN;

CREATE SEQUENCE incident_report_id_seq AS BIGINT START WITH 1 INCREMENT BY 1;

-- Core master tables ---------------------------------------------------------
-- TODO: Exact legacy VARCHAR lengths, nullability and unnamed constraints for
-- core master tables could not be determined from application code alone.

CREATE TABLE brand_master (
    brandid BIGSERIAL PRIMARY KEY,
    brandcode VARCHAR(100),
    brandname VARCHAR(200) NOT NULL,
    shortname VARCHAR(100),
    brandlogo TEXT,
    website TEXT,
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT,
    createddatetime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT,
    modifieddatetime TIMESTAMP,
    deletedby BIGINT,
    deleteddatetime TIMESTAMP
);

CREATE TABLE division_master (
    divisionid BIGINT PRIMARY KEY,
    divisionname VARCHAR(200) NOT NULL,
    shortname VARCHAR(100),
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT,
    createddatetime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT,
    modifieddatetime TIMESTAMP,
    deletedby BIGINT,
    deleteddatetime TIMESTAMP
);

CREATE TABLE product_category_master (
    productcategoryid BIGSERIAL PRIMARY KEY,
    categoryname VARCHAR(200) NOT NULL,
    shortname VARCHAR(100),
    developmentlanguage VARCHAR(200),
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT,
    createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT,
    modifieddate TIMESTAMP,
    deletedby BIGINT,
    deleteddate TIMESTAMP
);

CREATE TABLE product_master (
    productid BIGSERIAL PRIMARY KEY,
    productname VARCHAR(200) NOT NULL,
    productlabel VARCHAR(200),
    productcategoryid BIGINT NOT NULL,
    developmentlanguage VARCHAR(200),
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT,
    createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT,
    modifieddate TIMESTAMP,
    deletedby BIGINT,
    deleteddate TIMESTAMP,
    CONSTRAINT fk_product_category FOREIGN KEY (productcategoryid)
        REFERENCES product_category_master(productcategoryid)
);

CREATE UNIQUE INDEX product_master_active_productname_uidx
ON product_master (productname) WHERE isdeleted = FALSE;
CREATE UNIQUE INDEX product_master_active_productlabel_uidx
ON product_master (productlabel) WHERE isdeleted = FALSE;

CREATE TABLE organization_master (
    organizationid BIGINT PRIMARY KEY,
    organizationname VARCHAR(250) NOT NULL,
    organizationcode VARCHAR(100) NOT NULL,
    shortname VARCHAR(100),
    country VARCHAR(100), state VARCHAR(100), city VARCHAR(100), address TEXT,
    currency VARCHAR(30), timezone VARCHAR(100),
    email VARCHAR(320), alternativeemail VARCHAR(320),
    phone VARCHAR(50), alternativephone VARCHAR(50),
    website TEXT, taxnumber VARCHAR(100), policydetails TEXT,
    activationstatus BOOLEAN NOT NULL DEFAULT TRUE,
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    financialyearstart DATE,
    financemodule VARCHAR(150), postalcode VARCHAR(30),
    pms VARCHAR(150), pmsidcode VARCHAR(100), legalname VARCHAR(250),
    reviewsoftware VARCHAR(150), financemodulecode VARCHAR(100), posmodule VARCHAR(150),
    brandid BIGINT,
    createdby BIGINT,
    createddatetime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT,
    modifieddatetime TIMESTAMP,
    deletedby BIGINT,
    deleteddatetime TIMESTAMP,
    CONSTRAINT fk_organization_brand FOREIGN KEY (brandid) REFERENCES brand_master(brandid)
);

CREATE UNIQUE INDEX uq_organization_code ON organization_master (organizationcode);

CREATE TABLE organization_master_logo (
    logoid BIGSERIAL PRIMARY KEY,
    organizationid BIGINT NOT NULL,
    logotype VARCHAR(100),
    logoname TEXT NOT NULL,
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT,
    createddatetime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT,
    modifieddatetime TIMESTAMP,
    deletedby BIGINT,
    deleteddatetime TIMESTAMP,
    CONSTRAINT fk_organization_logo_org FOREIGN KEY (organizationid)
        REFERENCES organization_master(organizationid)
);

CREATE TABLE department_master (
    departmentid BIGSERIAL PRIMARY KEY,
    departmentname VARCHAR(200) NOT NULL,
    departmentshortname VARCHAR(100),
    organizationid BIGINT,
    divisionid BIGINT,
    products JSONB NOT NULL DEFAULT '[]'::JSONB,
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT,
    createddatetime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT,
    modifieddatetime TIMESTAMP,
    deletedby BIGINT,
    deleteddatetime TIMESTAMP,
    CONSTRAINT fk_department_org FOREIGN KEY (organizationid) REFERENCES organization_master(organizationid),
    CONSTRAINT fk_department_division FOREIGN KEY (divisionid) REFERENCES division_master(divisionid)
);

-- Authentication, users and access mappings --------------------------------
-- TODO: Exact legacy mapping uniqueness rules and audit-column foreign keys
-- could not be determined from application code alone.

CREATE TABLE user_master (
    userid BIGINT PRIMARY KEY,
    employeecode VARCHAR(100),
    username VARCHAR(200) NOT NULL,
    passwordhash TEXT NOT NULL,
    fullname VARCHAR(250),
    designation VARCHAR(200),
    departmentid BIGINT,
    divisionid BIGINT,
    logintype VARCHAR(50),
    usertype VARCHAR(100),
    email VARCHAR(320),
    phonenumber VARCHAR(50),
    gender VARCHAR(30),
    profilephoto TEXT,
    lastpasswordchangeddate TIMESTAMP,
    passwordexpirydate TIMESTAMP,
    islocked BOOLEAN NOT NULL DEFAULT FALSE,
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    dateofjoining DATE,
    allorganizationaccess BOOLEAN NOT NULL DEFAULT FALSE,
    lastlogin TIMESTAMP,
    createdby BIGINT,
    createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT,
    modifieddate TIMESTAMP,
    deletedby BIGINT,
    deleteddate TIMESTAMP,
    CONSTRAINT fk_user_department FOREIGN KEY (departmentid) REFERENCES department_master(departmentid),
    CONSTRAINT fk_user_division FOREIGN KEY (divisionid) REFERENCES division_master(divisionid)
);

CREATE UNIQUE INDEX uq_user_username ON user_master (LOWER(username));

CREATE TABLE user_brand_mapping (
    userbrandmapid BIGSERIAL PRIMARY KEY,
    userid BIGINT NOT NULL,
    brandid BIGINT NOT NULL,
    username VARCHAR(200),
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP,
    CONSTRAINT fk_user_brand_user FOREIGN KEY (userid) REFERENCES user_master(userid),
    CONSTRAINT fk_user_brand_brand FOREIGN KEY (brandid) REFERENCES brand_master(brandid)
);

CREATE TABLE user_org_mapping (
    userorgmapid BIGSERIAL PRIMARY KEY,
    userid BIGINT NOT NULL,
    userbrandmapid BIGINT,
    organizationid BIGINT NOT NULL,
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP,
    CONSTRAINT fk_user_org_user FOREIGN KEY (userid) REFERENCES user_master(userid),
    CONSTRAINT fk_user_org_brand_map FOREIGN KEY (userbrandmapid) REFERENCES user_brand_mapping(userbrandmapid),
    CONSTRAINT fk_user_org_org FOREIGN KEY (organizationid) REFERENCES organization_master(organizationid)
);

CREATE TABLE user_product_mapping (
    userproductmapid BIGSERIAL PRIMARY KEY,
    userid BIGINT NOT NULL,
    productid BIGINT NOT NULL,
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP,
    CONSTRAINT fk_user_product_user FOREIGN KEY (userid) REFERENCES user_master(userid),
    CONSTRAINT fk_user_product_product FOREIGN KEY (productid) REFERENCES product_master(productid)
);

CREATE TABLE user_device (
    userdeviceid BIGSERIAL PRIMARY KEY,
    userid BIGINT NOT NULL,
    deviceid VARCHAR(255) NOT NULL,
    devicetoken TEXT,
    devicetype VARCHAR(100),
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP,
    CONSTRAINT uq_user_device UNIQUE (userid, deviceid),
    CONSTRAINT fk_user_device_user FOREIGN KEY (userid) REFERENCES user_master(userid)
);

CREATE TABLE auth_token_blacklist (
    authtokenblacklistid BIGSERIAL PRIMARY KEY,
    userid BIGINT NOT NULL,
    jti VARCHAR(255) NOT NULL UNIQUE,
    tokenissuedat TIMESTAMP NOT NULL,
    tokenexpiresat TIMESTAMP NOT NULL,
    revokedat TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revokedby BIGINT,
    revocationreason TEXT,
    deviceid VARCHAR(255),
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_blacklist_user FOREIGN KEY (userid) REFERENCES user_master(userid)
);

-- Guest Glitch ---------------------------------------------------------------

CREATE TABLE guest_glitch_option_master (
    optionid BIGSERIAL PRIMARY KEY,
    organizationid BIGINT NOT NULL,
    optiontype VARCHAR(60) NOT NULL,
    optionvalue VARCHAR(100) NOT NULL,
    displayname VARCHAR(100) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    sortorder INTEGER NOT NULL DEFAULT 0,
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP,
    CONSTRAINT fk_glitch_option_org FOREIGN KEY (organizationid) REFERENCES organization_master(organizationid),
    CONSTRAINT chk_glitch_option_metadata CHECK (JSONB_TYPEOF(metadata) = 'object')
);

CREATE UNIQUE INDEX uq_guest_glitch_option_active
ON guest_glitch_option_master (organizationid, optiontype, optionvalue) WHERE isdeleted = FALSE;

CREATE TABLE guest_glitch_flow_config (
    flowconfigid BIGSERIAL PRIMARY KEY,
    organizationid BIGINT NOT NULL REFERENCES organization_master(organizationid),
    stagekey VARCHAR(80) NOT NULL, stagename VARCHAR(120) NOT NULL,
    stageorder INTEGER NOT NULL CHECK (stageorder > 0),
    isfinalstage BOOLEAN NOT NULL DEFAULT FALSE,
    isactive BOOLEAN NOT NULL DEFAULT TRUE, isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP
);

CREATE UNIQUE INDEX uq_guest_glitch_flow_stage_key
ON guest_glitch_flow_config (organizationid, stagekey) WHERE isdeleted = FALSE;
CREATE UNIQUE INDEX uq_guest_glitch_flow_stage_order
ON guest_glitch_flow_config (organizationid, stageorder) WHERE isdeleted = FALSE;

CREATE TABLE guest_glitch_flow_config_detail (
    flowconfigdetailid BIGSERIAL PRIMARY KEY,
    flowconfigid BIGINT NOT NULL REFERENCES guest_glitch_flow_config(flowconfigid),
    actortype VARCHAR(30) NOT NULL CHECK (actortype IN ('USER_ID','USER_TYPE','DEPARTMENT_ID','CREATOR')),
    actorvalue VARCHAR(100),
    canview BOOLEAN NOT NULL DEFAULT TRUE, canedit BOOLEAN NOT NULL DEFAULT FALSE,
    canproceed BOOLEAN NOT NULL DEFAULT FALSE,
    editablefields JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(editablefields) = 'array'),
    requiredactionfields JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(requiredactionfields) = 'array'),
    isactive BOOLEAN NOT NULL DEFAULT TRUE, isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP,
    CHECK ((actortype = 'CREATOR' AND actorvalue IS NULL) OR
           (actortype <> 'CREATOR' AND NULLIF(BTRIM(actorvalue), '') IS NOT NULL))
);

CREATE TABLE guest_glitch_entry_master (
    -- TODO: Exact original scalar lengths/nullability and field-audit ID types
    -- could not be determined; JSONB and date types are evidenced by queries.
    id BIGSERIAL PRIMARY KEY,
    organizationid BIGINT NOT NULL REFERENCES organization_master(organizationid),
    entrydate DATE, status VARCHAR(100), currentworkflowstage VARCHAR(80),
    resolvedby VARCHAR(250), receivedby VARCHAR(250), informedto VARCHAR(250),
    guestname VARCHAR(250), roomnumber VARCHAR(100), time VARCHAR(30),
    complaint TEXT, servicerecovery TEXT, detailedinvestigation TEXT,
    internalactiontaken TEXT, companyname VARCHAR(250), rate NUMERIC(18,4),
    checkindate DATE, checkoutdate DATE, gmcomment TEXT, processlapse TEXT,
    department VARCHAR(250), sra_room TEXT, sra_food TEXT, sra_other TEXT,
    raisesource VARCHAR(150), complaintsource VARCHAR(150),
    attachmenttitle TEXT, attachment TEXT, gueststatus VARCHAR(100),
    processlapsecategory VARCHAR(150), internalactiontakencategory VARCHAR(150),
    getmetjson JSONB, departmentids JSONB NOT NULL DEFAULT '[]'::JSONB,
    receivedbyids JSONB NOT NULL DEFAULT '[]'::JSONB,
    informedtoids JSONB NOT NULL DEFAULT '[]'::JSONB,
    departmenthodcomments JSONB NOT NULL DEFAULT '[]'::JSONB,
    createdby VARCHAR(100), createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifyby VARCHAR(100), modifydate TIMESTAMP, updatedby VARCHAR(200),
    createdip VARCHAR(64), modifiedip VARCHAR(64),
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE, deletedby BIGINT, deleteddate TIMESTAMP,
    entrydateupdateby BIGINT, entrydateupdatebyon TIMESTAMP,
    statusupdateby BIGINT, statusupdatebyon TIMESTAMP,
    resolvedbyupdateby BIGINT, resolvedbyupdatebyon TIMESTAMP,
    receivedbyupdateby BIGINT, receivedbyupdatebyon TIMESTAMP,
    informedtoupdateby BIGINT, informedtoupdatebyon TIMESTAMP,
    guestnameupdateby BIGINT, guestnameupdatebyon TIMESTAMP,
    roomnumberupdateby BIGINT, roomnumberupdatebyon TIMESTAMP,
    timeupdateby BIGINT, timeupdatebyon TIMESTAMP,
    complaintupdateby BIGINT, complaintupdatebyon TIMESTAMP,
    servicerecoveryupdateby BIGINT, servicerecoveryupdatebyon TIMESTAMP,
    detailedinvestigationupdateby BIGINT, detailedinvestigationupdatebyon TIMESTAMP,
    internalactiontakenupdateby BIGINT, internalactiontakenupdatebyon TIMESTAMP,
    companynameupdateby BIGINT, companynameupdatebyon TIMESTAMP,
    rateupdateby BIGINT, rateupdatebyon TIMESTAMP,
    checkindateupdateby BIGINT, checkindateupdatebyon TIMESTAMP,
    checkoutdateupdateby BIGINT, checkoutdateupdatebyon TIMESTAMP,
    gmcommentupdateby BIGINT, gmcommentupdatebyon TIMESTAMP,
    processlapseupdateby BIGINT, processlapseupdatebyon TIMESTAMP,
    departmentupdateby BIGINT, departmentupdatebyon TIMESTAMP,
    sra_roomupdateby BIGINT, sra_roomupdatebyon TIMESTAMP,
    sra_foodupdateby BIGINT, sra_foodupdatebyon TIMESTAMP,
    sra_otherupdateby BIGINT, sra_otherupdatebyon TIMESTAMP,
    raisesourceupdateby BIGINT, raisesourceupdatebyon TIMESTAMP,
    complaintsourceupdateby BIGINT, complaintsourceupdatebyon TIMESTAMP,
    attachmenttitleupdateby BIGINT, attachmenttitleupdatebyon TIMESTAMP,
    attachmentupdateby BIGINT, attachmentupdatebyon TIMESTAMP,
    gueststatusupdateby BIGINT, gueststatusupdatebyon TIMESTAMP,
    processlapsecategoryupdateby BIGINT, processlapsecategoryupdatebyon TIMESTAMP,
    internalactiontakencategoryupdateby BIGINT, internalactiontakencategoryupdatebyon TIMESTAMP
);

CREATE INDEX idx_guest_glitch_org_active_entrydate
ON guest_glitch_entry_master (organizationid, isdeleted, entrydate DESC, id DESC);
CREATE INDEX idx_guest_glitch_org_status_entrydate
ON guest_glitch_entry_master (organizationid, status, entrydate DESC) WHERE isdeleted = FALSE;
CREATE INDEX idx_guest_glitch_departmentids_gin ON guest_glitch_entry_master USING GIN (departmentids jsonb_path_ops);
CREATE INDEX idx_guest_glitch_receivedbyids_gin ON guest_glitch_entry_master USING GIN (receivedbyids jsonb_path_ops);
CREATE INDEX idx_guest_glitch_informedtoids_gin ON guest_glitch_entry_master USING GIN (informedtoids jsonb_path_ops);

-- Incident and HLP reports ---------------------------------------------------

CREATE TABLE incident_report_entry_master (
    id BIGINT PRIMARY KEY DEFAULT nextval('incident_report_id_seq'),
    organizationid BIGINT NOT NULL REFERENCES organization_master(organizationid),
    reportdate DATE NOT NULL, incidentdate DATE NOT NULL, time VARCHAR(20) NOT NULL,
    location VARCHAR(150) NOT NULL, accidentcause VARCHAR(150) NOT NULL,
    anycasualty VARCHAR(150) NOT NULL, description TEXT NOT NULL,
    damagedcaused VARCHAR(2000), investigation VARCHAR(2000),
    investigatedby VARCHAR(60), presentduringincident VARCHAR(60),
    reportto VARCHAR(60), reportby VARCHAR(60),
    createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, createdby VARCHAR(100),
    modifydate TIMESTAMP, modifyby VARCHAR(100), isdeleted BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER SEQUENCE incident_report_id_seq OWNED BY incident_report_entry_master.id;
CREATE INDEX idx_incident_org_reportdate ON incident_report_entry_master (organizationid, reportdate DESC, id DESC) WHERE isdeleted = FALSE;

CREATE TABLE hlpreport_master_list (
    id BIGINT PRIMARY KEY, title VARCHAR(250) NOT NULL, orderby INTEGER,
    isactive BOOLEAN NOT NULL DEFAULT TRUE,
    createdby BIGINT, createddatetime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifyby BIGINT, modifydatetime TIMESTAMP
);
CREATE UNIQUE INDEX uq_hlp_active_order ON hlpreport_master_list(orderby) WHERE isactive = TRUE;

CREATE TABLE hlpreport_entry_master (
    id BIGINT PRIMARY KEY,
    organizationid BIGINT NOT NULL REFERENCES organization_master(organizationid),
    entrydate DATE NOT NULL,
    createdby BIGINT, createddatetime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifyby BIGINT, modifydatetime TIMESTAMP,
    CONSTRAINT uq_hlp_org_date UNIQUE (organizationid, entrydate)
);

CREATE TABLE hlpreport_entry_details (
    id BIGINT PRIMARY KEY, entryid BIGINT NOT NULL, masterid BIGINT NOT NULL,
    title VARCHAR(250) NOT NULL, yod TEXT, lyod TEXT,
    createdby BIGINT, createddatetime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifyby BIGINT, modifydatetime TIMESTAMP,
    CONSTRAINT fk_hlp_detail_entry FOREIGN KEY (entryid) REFERENCES hlpreport_entry_master(id),
    CONSTRAINT fk_hlp_detail_master FOREIGN KEY (masterid) REFERENCES hlpreport_master_list(id),
    CONSTRAINT uq_hlp_entry_master UNIQUE (entryid, masterid)
);

-- Guest Meet ----------------------------------------------------------------
-- TODO: Exact original numeric precision and nullable fields could not be
-- determined from application code.

CREATE TABLE guestmeet_daily_entry_master (
    gmmasterid BIGSERIAL PRIMARY KEY,
    organizationid BIGINT NOT NULL REFERENCES organization_master(organizationid),
    entrydate DATE NOT NULL,
    roomsinhouse INTEGER, guestsinhouse INTEGER, arrivals INTEGER, departures INTEGER,
    occupancy NUMERIC(10,2),
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP
);
CREATE UNIQUE INDEX uq_guestmeet_org_entrydate_active
ON guestmeet_daily_entry_master (organizationid, entrydate) WHERE isdeleted = FALSE;

CREATE TABLE guestmeet_daily_entry_details (
    gmdetailid BIGSERIAL PRIMARY KEY,
    organizationid BIGINT NOT NULL REFERENCES organization_master(organizationid),
    gmmasterid BIGINT NOT NULL REFERENCES guestmeet_daily_entry_master(gmmasterid),
    guestname VARCHAR(250), roomno VARCHAR(100), bookingsource VARCHAR(150),
    arrival DATE, departure DATE, feedback TEXT, actiontaken TEXT,
    metby BIGINT, meton DATE, feedbacktype VARCHAR(100), gueststatus VARCHAR(100),
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP
);

-- CAPEX ---------------------------------------------------------------------
-- TODO: Exact original money/quantity precision, status defaults and legacy
-- constraint names could not be determined from application code.

CREATE TABLE capex_organization_sequence (
    organizationid BIGINT PRIMARY KEY REFERENCES organization_master(organizationid),
    lastcapexnumber BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE capex_master (
    capexid BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    organizationid BIGINT NOT NULL REFERENCES organization_master(organizationid),
    capexnumber BIGINT NOT NULL, department VARCHAR(250), item VARCHAR(500),
    description TEXT, make VARCHAR(250), qty NUMERIC(18,4), rate NUMERIC(18,4), total NUMERIC(18,4),
    status VARCHAR(100), isvoid BOOLEAN NOT NULL DEFAULT FALSE, voidremarks TEXT,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP,
    CONSTRAINT uq_capex_org_number UNIQUE (organizationid, capexnumber)
);

CREATE TABLE capex_documents (
    capexdocumentid BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    capexid BIGINT NOT NULL REFERENCES capex_master(capexid), capexnumber BIGINT,
    filename TEXT NOT NULL, filepath TEXT NOT NULL, filetype VARCHAR(200), filesize BIGINT,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP
);

CREATE TABLE capex_approval_config (
    capexapprovalconfigid BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    organizationid BIGINT NOT NULL REFERENCES organization_master(organizationid),
    approvallevel INTEGER NOT NULL, approvalrole VARCHAR(100) NOT NULL,
    approvalorder INTEGER NOT NULL, ismandatory BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP
);
CREATE UNIQUE INDEX uq_capex_config_active_level
ON capex_approval_config (organizationid, approvallevel) WHERE isdeleted = FALSE;

CREATE TABLE capex_approval (
    capexapprovalid BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    capexid BIGINT NOT NULL REFERENCES capex_master(capexid),
    gmstatus VARCHAR(50) DEFAULT 'Pending', gmstatusdatetime TIMESTAMP, gmstatusapprovedby BIGINT, gmremarks TEXT, gmapprovedquantity NUMERIC(18,4),
    ceostatus VARCHAR(50) DEFAULT 'Pending', ceostatusdatetime TIMESTAMP, ceostatusapprovedby BIGINT, ceoremarks TEXT, ceoapprovedquantity NUMERIC(18,4),
    ownerstatus VARCHAR(50) DEFAULT 'Pending', ownerstatusdatetime TIMESTAMP, ownerstatusapprovedby BIGINT, ownerremarks TEXT, ownerapprovedquantity NUMERIC(18,4),
    finalstatus VARCHAR(50) DEFAULT 'Pending', finalstatusdatetime TIMESTAMP,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP
);
CREATE UNIQUE INDEX uq_capex_active_approval ON capex_approval(capexid) WHERE isdeleted = FALSE;

-- OPEX ----------------------------------------------------------------------
-- TODO: Exact original money/quantity precision, status defaults and legacy
-- constraint names could not be determined from application code.

CREATE TABLE opex_organization_sequence (
    organizationid BIGINT PRIMARY KEY REFERENCES organization_master(organizationid),
    lastopexnumber BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE opex_master (
    opexid BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    organizationid BIGINT NOT NULL REFERENCES organization_master(organizationid),
    opexnumber BIGINT NOT NULL, department VARCHAR(250), item VARCHAR(500),
    description TEXT, make VARCHAR(250), qty NUMERIC(18,4), rate NUMERIC(18,4), total NUMERIC(18,4),
    status VARCHAR(100), isvoid BOOLEAN NOT NULL DEFAULT FALSE, voidremarks TEXT,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP,
    CONSTRAINT uq_opex_org_number UNIQUE (organizationid, opexnumber)
);

CREATE TABLE opex_documents (
    opexdocumentid BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    opexid BIGINT NOT NULL REFERENCES opex_master(opexid), opexnumber BIGINT,
    filename TEXT NOT NULL, filepath TEXT NOT NULL, filetype VARCHAR(200), filesize BIGINT,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP
);

CREATE TABLE opex_approval_config (
    opexapprovalconfigid BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    organizationid BIGINT NOT NULL REFERENCES organization_master(organizationid),
    approvallevel INTEGER NOT NULL, approvalrole VARCHAR(100) NOT NULL,
    approvalorder INTEGER NOT NULL, ismandatory BOOLEAN NOT NULL DEFAULT TRUE,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP
);
CREATE UNIQUE INDEX uq_opex_config_active_level
ON opex_approval_config (organizationid, approvallevel) WHERE isdeleted = FALSE;

CREATE TABLE opex_approval (
    opexapprovalid BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    opexid BIGINT NOT NULL REFERENCES opex_master(opexid),
    hodstatus VARCHAR(50) DEFAULT 'Pending', hodstatusdatetime TIMESTAMP, hodstatusapprovedby BIGINT, hodremarks TEXT, hodapprovedquantity NUMERIC(18,4),
    fcstatus VARCHAR(50) DEFAULT 'Pending', fcstatusdatetime TIMESTAMP, fcstatusapprovedby BIGINT, fcremarks TEXT, fcapprovedquantity NUMERIC(18,4),
    gmstatus VARCHAR(50) DEFAULT 'Pending', gmstatusdatetime TIMESTAMP, gmstatusapprovedby BIGINT, gmremarks TEXT, gmapprovedquantity NUMERIC(18,4),
    rdfcstatus VARCHAR(50) DEFAULT 'Pending', rdfcstatusdatetime TIMESTAMP, rdfcstatusapprovedby BIGINT, rdfcremarks TEXT, rdfcapprovedquantity NUMERIC(18,4),
    ceostatus VARCHAR(50) DEFAULT 'Pending', ceostatusdatetime TIMESTAMP, ceostatusapprovedby BIGINT, ceoremarks TEXT, ceoapprovedquantity NUMERIC(18,4),
    finalstatus VARCHAR(50) DEFAULT 'Pending', finalstatusdatetime TIMESTAMP,
    isdeleted BOOLEAN NOT NULL DEFAULT FALSE,
    createdby BIGINT, createddate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modifiedby BIGINT, modifieddate TIMESTAMP, deletedby BIGINT, deleteddate TIMESTAMP
);
CREATE UNIQUE INDEX uq_opex_active_approval ON opex_approval(opexid) WHERE isdeleted = FALSE;

-- Common access and lookup indexes ------------------------------------------

CREATE INDEX idx_user_org_active ON user_org_mapping(userid, organizationid) WHERE isactive = TRUE AND isdeleted = FALSE;
CREATE INDEX idx_user_product_active ON user_product_mapping(userid, productid) WHERE isactive = TRUE AND isdeleted = FALSE;
CREATE INDEX idx_department_org_active ON department_master(organizationid) WHERE isdeleted = FALSE;
CREATE INDEX idx_capex_org_active ON capex_master(organizationid, createddate DESC) WHERE isdeleted = FALSE;
CREATE INDEX idx_opex_org_active ON opex_master(organizationid, createddate DESC) WHERE isdeleted = FALSE;
CREATE INDEX idx_guestmeet_master_date ON guestmeet_daily_entry_master(organizationid, entrydate DESC) WHERE isdeleted = FALSE;

COMMIT;
