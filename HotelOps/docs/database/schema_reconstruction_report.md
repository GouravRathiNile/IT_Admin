# HotelOps schema reconstruction report

## Scope and method

This reconstruction was performed entirely offline. No Neon connection, `pg_dump`, `psql`, `.env` value, or remote query was used. The inventory was built from SQL embedded in the backend, DTO/validator field definitions, tests, and the existing SQL files under `docs/`.

The generated schema contains **33 application tables** and **1 explicit application sequence**. Seven tables are classified as confidently reconstructed because their definitions are either present in existing migrations or their complete field contract is tightly specified in repository/service code. The remaining 26 tables are usable compatibility reconstructions, but at least one original datatype, nullability rule, default, key, or index could not be proven from source alone.

## Object inventory and evidence

| # | Table | Confidence | Primary evidence |
|---:|---|---|---|
| 1 | `brand_master` | Partial | `services/ITAdminService/BrandMaster.js` |
| 2 | `division_master` | Partial | `services/ITAdminService/DivisionService.js` |
| 3 | `product_category_master` | Partial | `services/ITAdminService/ProductCategoryService.js`; `docs/product-active-uniqueness-migration.sql` |
| 4 | `product_master` | Partial | `services/ITAdminService/ProductService.js`; `docs/product-active-uniqueness-migration.sql` |
| 5 | `organization_master` | Partial | `services/ITAdminService/OrganizationService.js` and joins throughout the backend |
| 6 | `organization_master_logo` | Partial | `services/ITAdminService/OrganizationService.js`; `services/HLPReportService/HLPReportService.js` |
| 7 | `department_master` | Partial | `services/ITAdminService/DepartmentService.js`; Guest Glitch repository |
| 8 | `user_master` | Partial | `services/ITAdminService/UserService.js`; `HotelOpsLoginService.js`; authorization middleware |
| 9 | `user_brand_mapping` | Partial | `services/ITAdminService/UserService.js` |
| 10 | `user_org_mapping` | Partial | `services/ITAdminService/UserService.js`; all organization-scoped modules |
| 11 | `user_product_mapping` | Partial | `services/ITAdminService/UserService.js` |
| 12 | `user_device` | Partial | `services/ITAdminService/HotelOpsLoginService.js` |
| 13 | `auth_token_blacklist` | Partial | `services/ITAdminService/HotelOpsLoginService.js`; `middleware/authMiddleware.js` |
| 14 | `guest_glitch_option_master` | Confident | `docs/guest-glitch-database.sql`; Guest Glitch repository |
| 15 | `guest_glitch_flow_config` | Confident | `docs/guest-glitch-workflow-migration.sql` |
| 16 | `guest_glitch_flow_config_detail` | Confident | `docs/guest-glitch-workflow-migration.sql` |
| 17 | `guest_glitch_entry_master` | Partial | Guest Glitch repository, service, DTO, validator, constants, tests, and existing migrations |
| 18 | `incident_report_entry_master` | Confident | Incident repository, constants, DTO, validator, tests; `docs/incident-report-id-sequence.sql` |
| 19 | `hlpreport_master_list` | Confident | `services/HLPReportService/HLPReportService.js`; HLP tests |
| 20 | `hlpreport_entry_master` | Confident | `services/HLPReportService/HLPReportService.js`; HLP tests |
| 21 | `hlpreport_entry_details` | Confident | `services/HLPReportService/HLPReportService.js`; HLP tests |
| 22 | `guestmeet_daily_entry_master` | Partial | `services/GuestMeetService/GuestMeetService.js` |
| 23 | `guestmeet_daily_entry_details` | Partial | `services/GuestMeetService/GuestMeetService.js` |
| 24 | `capex_organization_sequence` | Partial | `services/CapexService/CapexService.js` |
| 25 | `capex_master` | Partial | `services/CapexService/CapexService.js`; CAPEX controller/consumer |
| 26 | `capex_documents` | Partial | `services/CapexService/CapexService.js` |
| 27 | `capex_approval_config` | Partial | `services/CapexService/CapexService.js` |
| 28 | `capex_approval` | Partial | `services/CapexService/CapexService.js`; `docs/Querys` |
| 29 | `opex_organization_sequence` | Partial | `services/OpexService/OpexService.js` |
| 30 | `opex_master` | Partial | `services/OpexService/OpexService.js`; OPEX controller/consumer |
| 31 | `opex_documents` | Partial | `services/OpexService/OpexService.js` |
| 32 | `opex_approval_config` | Partial | `services/OpexService/OpexService.js` |
| 33 | `opex_approval` | Partial | `services/OpexService/OpexService.js` |

`capex_data`, `opex_data`, `role_capex`, `visible_capex`, `FeedbackCounts`, `paged_organizations`, `ordered`, and `current_max` occur in SQL as CTE names, not persistent relations. PostgreSQL built-ins/catalog relations such as `pg_class`, `pg_index`, `unnest`, and `jsonb_array_elements_text` are likewise not application tables.

## Reconstructed relationships

The schema includes relationships directly supported by joins, validation queries, inserts, or existing migrations:

- Product to product category.
- Organization to brand and organization logo.
- Department to organization and division.
- User to department/division; user mappings to brand, organization, and product.
- Device and token blacklist records to user.
- Guest Glitch options, workflow configuration, and entries to organization; workflow details to workflow configuration.
- Incident, HLP entry, Guest Meet, CAPEX, and OPEX records to organization.
- HLP details to both the HLP entry and master-list item.
- Guest Meet details to the daily-entry master.
- CAPEX/OPEX documents and approvals to their respective master record.
- CAPEX/OPEX configuration and per-organization counters to organization.

Foreign keys were deliberately omitted for audit fields such as `CreatedBy`, `ModifiedBy`, and `DeletedBy`. Source code frequently stores strings or permits null values in those fields, and no original FK behavior can be proven.

## Identity and sequence behavior

- `incident_report_id_seq` is explicit and is used through `nextval('incident_report_id_seq')`. It is owned by `incident_report_entry_master.id` in the reconstruction.
- `BIGSERIAL` is used where inserts omit the primary key and expect a generated result.
- CAPEX code usually reserves numeric IDs with `MAX(id) + 1`, while OPEX mixes omitted IDs and reserved IDs. `GENERATED BY DEFAULT AS IDENTITY` supports both explicit and generated values.
- HLP and several mapping/master services calculate IDs in application code. Their IDs are therefore plain `BIGINT` unless code clearly relies on database generation.
- `capex_organization_sequence` and `opex_organization_sequence` are counter tables, not PostgreSQL sequence objects. Their organization IDs must be unique because the application uses `ON CONFLICT (OrganizationID)`.

## Inferred details and assumptions

The following are compatibility choices, not claims about the inaccessible original database:

- Numeric identifiers are `BIGINT`, based on widespread `$n::bigint`, `ANY(...::bigint[])`, and `COUNT(*)::bigint` usage.
- Monetary and quantity fields use `NUMERIC(18,4)`. The exact original precision/scale is not recoverable.
- Free-form descriptions, remarks, investigation content, paths, and attachment values use `TEXT`; bounded names/codes use conservative `VARCHAR` sizes.
- Audit date columns use `TIMESTAMP` because code compares them with `CURRENT_TIMESTAMP`/`NOW()` and does not show a timezone contract.
- JSON selections and metadata use `JSONB`, directly supported by casts and JSONB operators in the code.
- Guest Glitch field-audit columns come from `FIELD_AUDIT_COLUMNS`. Their updater IDs are `BIGINT`; the original definition is unknown.
- HLP `YOD` and `LYOD` use `TEXT` because code accepts both numeric and nonnumeric values and computes totals only when all values parse as numbers.
- Unquoted lowercase identifiers are intentional. PostgreSQL folds the PascalCase identifiers used in application SQL to lowercase.
- Partial unique indexes for active product names and labels are included exactly as established by `docs/product-active-uniqueness-migration.sql`.

## Unresolved details requiring future verification

The original database is still needed to verify:

1. Exact `VARCHAR` lengths and numeric precision/scale.
2. Original nullability and default expressions for most legacy master, mapping, CAPEX, OPEX, Guest Meet, and Guest Glitch entry columns.
3. Original names and actions (`ON DELETE`/`ON UPDATE`) of foreign-key constraints.
4. Whether all audit user columns had foreign keys, and whether some were text rather than numeric.
5. Additional unique/check constraints not exercised or named in application code.
6. Original index set and index methods beyond the indexes documented in migrations or clearly useful for application filters.
7. Sequence start/current values and historical manually allocated IDs. A schema-only reconstruction intentionally cannot reproduce these values.
8. Triggers, stored functions/procedures, views/materialized views, extensions, grants, owners, comments, and row-level-security policies. None can be reliably reconstructed from the backend.
9. Whether CAPEX/OPEX `Status` is stored independently from approval `FinalStatus` and its exact default.
10. The precise original constraints for duplicate active user/brand/organization/product mappings.

## Validation performed

- Searched the complete repository for `SELECT`, `INSERT`, `UPDATE`, `DELETE`, joins, conflicts, sequences, DDL, references, and indexes.
- Compared the persistent relation inventory with every `CREATE TABLE` in `hotelops_schema.sql`.
- Checked dependency ordering: independent masters precede users/mappings and module child tables follow their parents.
- Included columns used in insert/update/return/filter/sort/join paths, including Guest Glitch field-audit columns and all CAPEX/OPEX approval-role columns.
- Preserved the exact `CreatedDateTime`/`ModifiedDateTime`/`DeletedDateTime` convention used by Brand, Division, Organization, Organization Logo, and Department, while retaining `CreatedDate` conventions used by other modules.
- Ran whitespace/error checks with `git diff --check`.
- Executed the complete schema with `psql -v ON_ERROR_STOP=1` against a fresh, temporary local PostgreSQL 16 Docker instance. All 33 tables, the sequence, constraints, and indexes were created and the transaction committed successfully; the container was automatically removed.
- Did not execute against Neon or any remote database.

The file is syntactically ready to run against a **new empty local PostgreSQL 16 database**. The partially reconstructed objects should still be treated as provisional until application integration tests pass or the original catalog becomes available.
