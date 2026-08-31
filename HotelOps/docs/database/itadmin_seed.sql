-- HotelOps IT Admin master-data insert commands
-- Sample values ko apne local environment ke hisab se edit karein.
-- Run after: docs/database/hotelops_schema.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Brand
-- ---------------------------------------------------------------------------

INSERT INTO brand_master
(
    brandid,
    brandcode,
    brandname,
    shortname,
    brandlogo,
    website,
    isactive,
    isdeleted,
    createdby,
    createddatetime
)
VALUES
(
    1,
    'HOTEL-BRAND-001',
    'HotelOps Brand',
    'HOB',
    NULL,
    'https://example.com',
    TRUE,
    FALSE,
    NULL,
    CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 2. Division
-- ---------------------------------------------------------------------------

INSERT INTO division_master
(
    divisionid,
    divisionname,
    shortname,
    isactive,
    isdeleted,
    createdby,
    createddatetime
)
VALUES
(
    1,
    'Hotel Operations',
    'OPS',
    TRUE,
    FALSE,
    NULL,
    CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 3. Product category
-- ---------------------------------------------------------------------------

INSERT INTO product_category_master
(
    productcategoryid,
    categoryname,
    shortname,
    developmentlanguage,
    isactive,
    isdeleted,
    createdby,
    createddate
)
VALUES
(
    1,
    'Hotel Operations',
    'HOTEL-OPS',
    'Node.js',
    TRUE,
    FALSE,
    NULL,
    CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 4. Product
-- ---------------------------------------------------------------------------

INSERT INTO product_master
(
    productid,
    productname,
    productlabel,
    productcategoryid,
    developmentlanguage,
    isactive,
    isdeleted,
    createdby,
    createddate
)
VALUES
(
    1,
    'HotelOps',
    'Hotel Operations',
    1,
    'Node.js',
    TRUE,
    FALSE,
    NULL,
    CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 5. Organization
-- ---------------------------------------------------------------------------

INSERT INTO organization_master
(
    organizationid,
    organizationname,
    organizationcode,
    shortname,
    country,
    state,
    city,
    address,
    currency,
    timezone,
    email,
    alternativeemail,
    phone,
    alternativephone,
    website,
    taxnumber,
    policydetails,
    activationstatus,
    isactive,
    isdeleted,
    financialyearstart,
    financemodule,
    postalcode,
    pms,
    pmsidcode,
    legalname,
    reviewsoftware,
    financemodulecode,
    posmodule,
    brandid,
    createdby,
    createddatetime
)
VALUES
(
    1,
    'HotelOps Demo Hotel',
    'HOTEL-001',
    'Demo Hotel',
    'India',
    'Delhi',
    'New Delhi',
    'Demo Address',
    'INR',
    'Asia/Calcutta',
    'hotel@example.com',
    NULL,
    '9999999999',
    NULL,
    'https://example.com',
    NULL,
    NULL,
    TRUE,
    TRUE,
    FALSE,
    DATE '2026-04-01',
    NULL,
    '110001',
    NULL,
    NULL,
    'HotelOps Demo Hotel Private Limited',
    NULL,
    NULL,
    NULL,
    1,
    NULL,
    CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 6. Organization logo (optional)
-- ---------------------------------------------------------------------------

-- INSERT INTO organization_master_logo
-- (
--     organizationid,
--     logotype,
--     logoname,
--     isactive,
--     isdeleted,
--     createdby,
--     createddatetime
-- )
-- VALUES
-- (
--     1,
--     'Primary',
--     'hotel-logo.png',
--     TRUE,
--     FALSE,
--     NULL,
--     CURRENT_TIMESTAMP
-- );

-- ---------------------------------------------------------------------------
-- 7. Departments
-- ---------------------------------------------------------------------------

INSERT INTO department_master
(
    departmentid,
    departmentname,
    departmentshortname,
    organizationid,
    divisionid,
    products,
    isactive,
    isdeleted,
    createdby,
    createddatetime
)
VALUES
    (1, 'Information Technology', 'IT', 1, 1, '[1]'::JSONB, TRUE, FALSE, NULL, CURRENT_TIMESTAMP),
    (2, 'Front Office', 'FO', 1, 1, '[1]'::JSONB, TRUE, FALSE, NULL, CURRENT_TIMESTAMP),
    (3, 'Housekeeping', 'HK', 1, 1, '[1]'::JSONB, TRUE, FALSE, NULL, CURRENT_TIMESTAMP),
    (4, 'Food and Beverage', 'FNB', 1, 1, '[1]'::JSONB, TRUE, FALSE, NULL, CURRENT_TIMESTAMP),
    (5, 'Finance', 'FIN', 1, 1, '[1]'::JSONB, TRUE, FALSE, NULL, CURRENT_TIMESTAMP),
    (6, 'Human Resources', 'HR', 1, 1, '[1]'::JSONB, TRUE, FALSE, NULL, CURRENT_TIMESTAMP),
    (7, 'Engineering', 'ENG', 1, 1, '[1]'::JSONB, TRUE, FALSE, NULL, CURRENT_TIMESTAMP),
    (8, 'Security', 'SEC', 1, 1, '[1]'::JSONB, TRUE, FALSE, NULL, CURRENT_TIMESTAMP);

-- ---------------------------------------------------------------------------
-- 8. Administrator user
-- PasswordHash must be a bcrypt hash, not a plain-text password.
-- Replace the placeholder before executing this insert.
-- ---------------------------------------------------------------------------

INSERT INTO user_master
(
    userid,
    employeecode,
    username,
    passwordhash,
    fullname,
    designation,
    departmentid,
    divisionid,
    logintype,
    usertype,
    email,
    phonenumber,
    gender,
    profilephoto,
    lastpasswordchangeddate,
    passwordexpirydate,
    islocked,
    isactive,
    isdeleted,
    dateofjoining,
    allorganizationaccess,
    createdby,
    createddate
)
VALUES
(
    1,
    'EMP-001',
    'admin',
    '$2b$12$REPLACE_WITH_A_REAL_BCRYPT_PASSWORD_HASH',
    'HotelOps Administrator',
    'System Administrator',
    1,
    1,
    'Password',
    'Admin',
    'admin@example.com',
    '9999999999',
    NULL,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP + INTERVAL '90 days',
    FALSE,
    TRUE,
    FALSE,
    CURRENT_DATE,
    TRUE,
    NULL,
    CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 9. User access mappings
-- ---------------------------------------------------------------------------

INSERT INTO user_brand_mapping
(
    userbrandmapid,
    userid,
    brandid,
    username,
    isactive,
    isdeleted,
    createdby,
    createddate
)
VALUES
(
    1,
    1,
    1,
    'admin',
    TRUE,
    FALSE,
    1,
    CURRENT_TIMESTAMP
);

INSERT INTO user_org_mapping
(
    userorgmapid,
    userid,
    userbrandmapid,
    organizationid,
    isactive,
    isdeleted,
    createdby,
    createddate
)
VALUES
(
    1,
    1,
    1,
    1,
    TRUE,
    FALSE,
    1,
    CURRENT_TIMESTAMP
);

INSERT INTO user_product_mapping
(
    userproductmapid,
    userid,
    productid,
    isactive,
    isdeleted,
    createdby,
    createddate
)
VALUES
(
    1,
    1,
    1,
    TRUE,
    FALSE,
    1,
    CURRENT_TIMESTAMP
);

-- Keep automatically generated IDs above the manually inserted seed IDs.
SELECT setval(pg_get_serial_sequence('brand_master', 'brandid'),
              GREATEST(COALESCE((SELECT MAX(brandid) FROM brand_master), 1), 1), TRUE);
SELECT setval(pg_get_serial_sequence('product_category_master', 'productcategoryid'),
              GREATEST(COALESCE((SELECT MAX(productcategoryid) FROM product_category_master), 1), 1), TRUE);
SELECT setval(pg_get_serial_sequence('product_master', 'productid'),
              GREATEST(COALESCE((SELECT MAX(productid) FROM product_master), 1), 1), TRUE);
SELECT setval(pg_get_serial_sequence('organization_master_logo', 'logoid'),
              GREATEST(COALESCE((SELECT MAX(logoid) FROM organization_master_logo), 1), 1), TRUE);
SELECT setval(pg_get_serial_sequence('department_master', 'departmentid'),
              GREATEST(COALESCE((SELECT MAX(departmentid) FROM department_master), 1), 1), TRUE);
SELECT setval(pg_get_serial_sequence('user_brand_mapping', 'userbrandmapid'),
              GREATEST(COALESCE((SELECT MAX(userbrandmapid) FROM user_brand_mapping), 1), 1), TRUE);
SELECT setval(pg_get_serial_sequence('user_org_mapping', 'userorgmapid'),
              GREATEST(COALESCE((SELECT MAX(userorgmapid) FROM user_org_mapping), 1), 1), TRUE);
SELECT setval(pg_get_serial_sequence('user_product_mapping', 'userproductmapid'),
              GREATEST(COALESCE((SELECT MAX(userproductmapid) FROM user_product_mapping), 1), 1), TRUE);

COMMIT;

-- ---------------------------------------------------------------------------
-- CLEANUP COMMANDS
-- Neeche ki commands seeded IT Admin data ko dependency-safe reverse order
-- mein delete karti hain. Use karne se pehle poora block uncomment karein.
-- WARNING: IDs change kiye hain to WHERE conditions bhi update karein.
-- ---------------------------------------------------------------------------

-- BEGIN;

-- DELETE FROM user_product_mapping
-- WHERE userproductmapid = 1 AND userid = 1 AND productid = 1;

-- DELETE FROM user_org_mapping
-- WHERE userorgmapid = 1 AND userid = 1 AND organizationid = 1;

-- DELETE FROM user_brand_mapping
-- WHERE userbrandmapid = 1 AND userid = 1 AND brandid = 1;

-- DELETE FROM auth_token_blacklist
-- WHERE userid = 1;

-- DELETE FROM user_device
-- WHERE userid = 1;

-- DELETE FROM user_master
-- WHERE userid = 1;

-- DELETE FROM department_master
-- WHERE departmentid IN (1, 2, 3, 4, 5, 6, 7, 8)
--   AND organizationid = 1;

-- DELETE FROM organization_master_logo
-- WHERE organizationid = 1;

-- DELETE FROM organization_master
-- WHERE organizationid = 1;

-- DELETE FROM product_master
-- WHERE productid = 1;

-- DELETE FROM product_category_master
-- WHERE productcategoryid = 1;

-- DELETE FROM division_master
-- WHERE divisionid = 1;

-- DELETE FROM brand_master
-- WHERE brandid = 1;

-- COMMIT;

-- ---------------------------------------------------------------------------
-- OPTIONAL: Fresh local database mein ALL HotelOps application data clear karein
-- WARNING: Is command se listed tables ka poora data permanently delete hoga.
-- RESTART IDENTITY sequences ko initial value par reset karta hai.
-- ---------------------------------------------------------------------------

-- TRUNCATE TABLE
--     guest_glitch_flow_config_detail,
--     guest_glitch_flow_config,
--     guest_glitch_option_master,
--     guest_glitch_entry_master,
--     incident_report_entry_master,
--     hlpreport_entry_details,
--     hlpreport_entry_master,
--     hlpreport_master_list,
--     guestmeet_daily_entry_details,
--     guestmeet_daily_entry_master,
--     capex_documents,
--     capex_approval,
--     capex_approval_config,
--     capex_master,
--     capex_organization_sequence,
--     opex_documents,
--     opex_approval,
--     opex_approval_config,
--     opex_master,
--     opex_organization_sequence,
--     auth_token_blacklist,
--     user_device,
--     user_product_mapping,
--     user_org_mapping,
--     user_brand_mapping,
--     user_master,
--     department_master,
--     organization_master_logo,
--     organization_master,
--     product_master,
--     product_category_master,
--     division_master,
--     brand_master
-- RESTART IDENTITY CASCADE;
