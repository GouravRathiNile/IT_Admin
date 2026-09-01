const { pool } = require("../../db");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");
const generateDocumentUrl = require("../../AzurConfigration/Opex/AzureGetData");
const { formatDate } = require("../../utils/dateFormatter");
const PdfPrinter = require("pdfmake");
const path = require("path");

// ==============================================================Default roles
const DEFAULT_APPROVALS = Object.freeze([
  { LevelNo: 1, ApprovalRole: "HOD" },
  { LevelNo: 2, ApprovalRole: "FC" },
  { LevelNo: 3, ApprovalRole: "GM" },
  { LevelNo: 4, ApprovalRole: "RD-FC" },
  { LevelNo: 5, ApprovalRole: "CEO" },
]);
const APPROVAL_ROLES = new Set(["HOD", "FC", "GM", "RD-FC", "CEO"]);

// ============================================================ Shared Response Helpers(Create Helpers)
const fail = (message, statusCode = 400) => ({
  success: false,
  statusCode,
  message,
});
// Merge organization overrides with the HOD -> FC -> GM -> RD-FC -> CEO defaults.
const mergeApprovalConfiguration = (configuredRows) => {
  const approvals = new Map(
    DEFAULT_APPROVALS.map((approval) => [approval.LevelNo, approval]),
  );

  for (const row of configuredRows) {
    const levelNo = Number(row.levelno);
    const approvalRole = String(row.approvalrole || "").trim();

    if (Number.isSafeInteger(levelNo) && levelNo > 0 && approvalRole) {
      approvals.set(levelNo, {
        LevelNo: levelNo,
        ApprovalRole: approvalRole,
      });
    }
  }

  return [...approvals.values()].sort(
    (left, right) => left.LevelNo - right.LevelNo,
  );
};
// Opex currently supports HOD, FC, GM, RD-FC and CEO approval roles.
const approvalConfigurationIsValid = (approvals) =>
  approvals.length > 0 &&
  approvals.every((approval) =>
    APPROVAL_ROLES.has(
      String(approval.ApprovalRole || "")
        .trim()
        .toUpperCase(),
    ),
  );
// Roll back only when a transaction was successfully started.
const rollback = async (client, transactionStarted) => {
  if (!client || !transactionStarted) return;

  try {
    await client.query("ROLLBACK");
  } catch (error) {
    console.error("Opex Rollback Error:", error.message);
  }
};
// Roll back database work and return the requested failure response.
const cleanupAndFail = async (client, transactionStarted, response) => {
  await rollback(client, transactionStarted);
  return response;
};
// Reserve numeric IDs safely because the existing Opex ID columns have no defaults.
const reserveNumericIDs = async (client, tableName, columnName, count = 1) => {
  if (count < 1) return [];

  const allowedColumns = {
    Opex_Master: "OpexID",
    Opex_Documents: "OpexDocumentID",
    Opex_Approval: "OpexApprovalID",
    Opex_Approval_Config: "OpexApprovalConfigID",
  };

  if (allowedColumns[tableName] !== columnName) {
    throw new Error("Invalid Opex ID reservation target");
  }

  const lockKey = `${tableName}.${columnName}`;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1));", [lockKey]);

  const result = await client.query(
    `SELECT COALESCE(MAX(${columnName}), 0) + 1 AS NextID FROM ${tableName};`,
  );
  const firstID = Number(result.rows[0].nextid);

  return Array.from({ length: count }, (_value, index) => firstID + index);
};
// ============================================================ Create Opex
const createOpex = async (data) => {
  let client;
  let transactionStarted = false;

  const documents = Array.isArray(data.Documents) ? data.Documents : [];

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ========================================================
    // 1. Generate Organization-wise Opex Number
    // ========================================================
    const sequenceResult = await client.query(
      `
      INSERT INTO Opex_Organization_Sequence
      (
        OrganizationID,
        LastOpexNumber
      )
      VALUES ($1, 1)

      ON CONFLICT (OrganizationID)
      DO UPDATE SET
        LastOpexNumber =
          Opex_Organization_Sequence.LastOpexNumber + 1

      RETURNING LastOpexNumber;
      `,
      [data.OrganizationID],
    );

    const OpexNumber = Number(sequenceResult.rows[0].lastopexnumber);

    // ========================================================
    // 2. Create Opex Master
    // OpexID = AUTO INCREMENT
    // ========================================================
    const masterResult = await client.query(
      `
      INSERT INTO Opex_Master
      (
        OrganizationID,
        OpexNumber,
        Department,
        Item,
        Description,
        Make,
        Qty,
        Rate,
        Total,
        IsVoid,
        IsDeleted,
        CreatedBy,
        CreatedDate
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        FALSE,
        FALSE,
        $10,
        CURRENT_TIMESTAMP
      )
      RETURNING OpexID, Total;
      `,
      [
        data.OrganizationID,
        OpexNumber,
        data.Department,
        data.Item,
        data.Description,
        data.Make,
        data.Qty,
        data.Rate,
        data.Total,
        data.CreatedBy,
      ],
    );

    // DB generated OpexID
    const OpexID = masterResult.rows[0].opexid;

    const total = Number(masterResult.rows[0].total);

    // ========================================================
    // 3. Create Documents
    // OpexDocumentID = AUTO INCREMENT
    // ========================================================
    for (const document of documents) {
      await client.query(
        `
        INSERT INTO Opex_Documents
        (
          OpexID,
          OpexNumber,
          FileName,
          FilePath,
          FileType,
          FileSize,
          IsDeleted,
          CreatedBy,
          CreatedDate
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          FALSE,
          $7,
          CURRENT_TIMESTAMP
        );
        `,
        [
          OpexID,
          OpexNumber,
          document.FileName,
          document.FilePath,
          document.FileType,
          document.FileSize,
          data.CreatedBy,
        ],
      );
    }

    // ========================================================
    // 4. Approval Configuration
    // ========================================================
    const approvalConfigResult = await client.query(
      `
      SELECT
        ApprovalLevel AS LevelNo,
        ApprovalRole
      FROM Opex_Approval_Config
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
      ORDER BY
        ApprovalOrder ASC,
        ApprovalLevel ASC,
        OpexApprovalConfigID ASC;
      `,
      [data.OrganizationID],
    );

    const approvals = mergeApprovalConfiguration(approvalConfigResult.rows);

    // ========================================================
    // 5. Validate Approval Configuration
    // ========================================================
    if (!approvalConfigurationIsValid(approvals)) {
      return await cleanupAndFail(
        client,
        transactionStarted,
        fail(
          "Opex approval configuration contains an invalid approval role.",
          400,
        ),
      );
    }

    // ========================================================
    // 6. Create Approval
    // OpexApprovalID = AUTO INCREMENT
    // ========================================================
    await client.query(
      `
      INSERT INTO Opex_Approval
      (
        OpexID,
        HODStatus,
        FCStatus,
        GMStatus,
        RDFCStatus,
        CEOStatus,
        FinalStatus,
        IsDeleted,
        CreatedBy,
        CreatedDate
      )
      VALUES
      (
        $1,
        'Pending',
        'Pending',
        'Pending',
        'Pending',
        'Pending',
        'Pending',
        FALSE,
        $2,
        CURRENT_TIMESTAMP
      );
      `,
      [OpexID, data.CreatedBy],
    );

    // ========================================================
    // 7. Commit
    // ========================================================
    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "Opex created successfully.",
    };
  } catch (error) {
    await rollback(client, transactionStarted);

    console.error("Create Opex Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) return retryResponse;

    if (error.code === "23503") {
      return fail("Invalid Opex organization or related data.", 400);
    }

    if (error.code === "23505") {
      return fail("A Opex record with the same details already exists.", 409);
    }

    return fail("Unable to create Opex at this time.", 500);
  } finally {
    if (client) client.release();
  }
};
// ============================================================ Read Query and Mapping Helpers(Get Helpers)
// The lateral query derives the first non-approved stage for each Opex.
const Opex_SELECT = `
  SELECT 
    cm.OpexID, 
    cm.OrganizationID, 
    om.ShortName AS OrganizationShortName,
    cm.OpexNumber, 
    cm.Department, 
    cm.Item, 
    cm.Description, 
    cm.Make, 
    cm.Qty, 
    cm.Rate, 
    cm.Total, 
    cm.IsVoid, 
    cm.VoidRemarks, 
    cm.CreatedDate, 

    CASE 
      WHEN UPPER(COALESCE(approval_state.FinalStatus, 'PENDING'))
           IN ('APPROVED', 'REJECTED')
      THEN NULL
      ELSE current_stage.ApprovalRole
    END AS CurrentApprovalRole,

    CASE 
      WHEN UPPER(COALESCE(approval_state.FinalStatus, 'PENDING'))
           IN ('APPROVED', 'REJECTED')
      THEN approval_state.FinalStatus

      ELSE COALESCE(
        current_stage.Status,
        approval_state.FinalStatus,
        'Pending'
      )
    END AS CurrentStatus

  FROM Opex_Master cm

  INNER JOIN Organization_Master om
    ON om.OrganizationID = cm.OrganizationID
   AND om.IsActive = TRUE
   AND om.IsDeleted = FALSE
   AND om.ActivationStatus = TRUE

  LEFT JOIN Opex_Approval approval_state
    ON approval_state.OpexID = cm.OpexID
   AND approval_state.IsDeleted = FALSE

  LEFT JOIN LATERAL
  (
    SELECT 
      cfg.ApprovalRole,

      CASE UPPER(cfg.ApprovalRole)

        WHEN 'HOD'
          THEN COALESCE(approval_state.HODStatus, 'PENDING')

        WHEN 'FC'
          THEN COALESCE(approval_state.FCStatus, 'PENDING')

        WHEN 'GM'
          THEN COALESCE(approval_state.GMStatus, 'PENDING')

        WHEN 'RD-FC'
          THEN COALESCE(approval_state.RDFCStatus, 'PENDING')

        WHEN 'CEO'
          THEN COALESCE(approval_state.CEOStatus, 'PENDING')

      END AS Status,

      cfg.ApprovalLevel,
      cfg.ApprovalOrder

    FROM
    (
      SELECT configured.ApprovalLevel, configured.ApprovalRole, configured.ApprovalOrder
      FROM Opex_Approval_Config configured
      WHERE configured.OrganizationID = cm.OrganizationID
        AND configured.IsDeleted = FALSE

      UNION ALL

      SELECT defaults.ApprovalLevel, defaults.ApprovalRole, defaults.ApprovalOrder
      FROM
      (
        VALUES
          (1, 'HOD', 1),
          (2, 'FC', 2),
          (3, 'GM', 3),
          (4, 'RD-FC', 4),
          (5, 'CEO', 5)
      ) AS defaults(ApprovalLevel, ApprovalRole, ApprovalOrder)
      WHERE NOT EXISTS
      (
        SELECT 1
        FROM Opex_Approval_Config configured
        WHERE configured.OrganizationID = cm.OrganizationID
          AND configured.IsDeleted = FALSE
      )
    ) cfg

    WHERE TRUE

      AND UPPER(
        CASE UPPER(cfg.ApprovalRole)

          WHEN 'HOD'
            THEN COALESCE(approval_state.HODStatus, 'PENDING')

          WHEN 'FC'
            THEN COALESCE(approval_state.FCStatus, 'PENDING')

          WHEN 'GM'
            THEN COALESCE(approval_state.GMStatus, 'PENDING')

          WHEN 'RD-FC'
            THEN COALESCE(approval_state.RDFCStatus, 'PENDING')

          WHEN 'CEO'
            THEN COALESCE(approval_state.CEOStatus, 'PENDING')

        END
      ) NOT IN ('APPROVED', 'REJECTED')

    ORDER BY
      cfg.ApprovalOrder ASC,
      cfg.ApprovalLevel ASC

    LIMIT 1

  ) current_stage ON TRUE

  WHERE cm.IsDeleted = FALSE
`;
// Convert PostgreSQL lowercase row keys into the public Opex response shape.
const mapMaster = (row) => ({
  OpexID: Number(row.opexid),
  OrganizationID: Number(row.organizationid),
  OrganizationShortName: row.organizationshortname,
  OpexNumber: Number(row.opexnumber),
  Department: row.department,
  Item: row.item,
  Description: row.description,
  Make: row.make,
  Qty: Number(row.qty),
  Rate: Number(row.rate),
  Total: Number(row.total),
  IsVoid: row.isvoid,
  VoidRemarks: row.voidremarks,
  CreatedDate: formatDate(row.createddate),
  CurrentStatus: row.currentstatus,
  Documents: [],
  Approvals: [],
});
// Generate a short-lived read URL while preserving stored blob paths in the DB.
const mapDocument = (row) => ({
  OpexDocumentID: Number(row.opexdocumentid),
  FileName: row.filename,
  FilePath: row.filepath ? generateDocumentUrl(row.filepath) : null,
});
// Return approval fields without exposing soft-delete/audit internals.
const mapApproval = (row) => ({
  OpexApprovalID: Number(row.opexapprovalid),
  ApprovalRole: row.approvalrole,
  Status: row.status,
  Remarks: row.remarks,
});
// Fetch documents and approvals in batches to avoid N+1 database queries.
const attachRelatedData = async (OpexRows) => {
  if (OpexRows.length === 0) return [];

  const OpexIDs = OpexRows.map((row) => Number(row.opexid));

  const [documentsResult, approvalsResult] = await Promise.all([
    pool.query(
      `
        SELECT
          OpexDocumentID,
          OpexID,
          OpexNumber,
          FileName,
          FilePath,
          FileType,
          FileSize
        FROM Opex_Documents
        WHERE OpexID = ANY($1::bigint[])
          AND IsDeleted = FALSE
        ORDER BY OpexID ASC, OpexDocumentID ASC;
      `,
      [OpexIDs],
    ),

    pool.query(
      `
        SELECT
          ca.OpexApprovalID,
          ca.OpexID,

          cfg.ApprovalLevel AS LevelNo,
          cfg.ApprovalRole,

          CASE UPPER(cfg.ApprovalRole)
            WHEN 'HOD' THEN ca.HODStatus
            WHEN 'FC' THEN ca.FCStatus
            WHEN 'GM' THEN ca.GMStatus
            WHEN 'RD-FC' THEN ca.RDFCStatus
            WHEN 'CEO' THEN ca.CEOStatus
          END AS Status,

          CASE UPPER(cfg.ApprovalRole)
            WHEN 'HOD' THEN ca.HODStatusDateTime
            WHEN 'FC' THEN ca.FCStatusDateTime
            WHEN 'GM' THEN ca.GMStatusDateTime
            WHEN 'RD-FC' THEN ca.RDFCStatusDateTime
            WHEN 'CEO' THEN ca.CEOStatusDateTime
          END AS StatusDateTime,

          CASE UPPER(cfg.ApprovalRole)
            WHEN 'HOD' THEN ca.HODStatusApprovedBy
            WHEN 'FC' THEN ca.FCStatusApprovedBy
            WHEN 'GM' THEN ca.GMStatusApprovedBy
            WHEN 'RD-FC' THEN ca.RDFCStatusApprovedBy
            WHEN 'CEO' THEN ca.CEOStatusApprovedBy
          END AS StatusApprovedBy,

          CASE UPPER(cfg.ApprovalRole)
            WHEN 'HOD' THEN ca.HODRemarks
            WHEN 'FC' THEN ca.FCRemarks
            WHEN 'GM' THEN ca.GMRemarks
            WHEN 'RD-FC' THEN ca.RDFCRemarks
            WHEN 'CEO' THEN ca.CEORemarks
          END AS Remarks

        FROM Opex_Approval ca

        INNER JOIN Opex_Master master
          ON master.OpexID = ca.OpexID

        CROSS JOIN LATERAL
        (
          SELECT configured.ApprovalLevel, configured.ApprovalRole, configured.ApprovalOrder
          FROM Opex_Approval_Config configured
          WHERE configured.OrganizationID = master.OrganizationID
            AND configured.IsDeleted = FALSE

          UNION ALL

          SELECT defaults.ApprovalLevel, defaults.ApprovalRole, defaults.ApprovalOrder
          FROM
          (
            VALUES
              (1, 'HOD', 1),
              (2, 'FC', 2),
              (3, 'GM', 3),
              (4, 'RD-FC', 4),
              (5, 'CEO', 5)
          ) AS defaults(ApprovalLevel, ApprovalRole, ApprovalOrder)
          WHERE NOT EXISTS
          (
            SELECT 1
            FROM Opex_Approval_Config configured
            WHERE configured.OrganizationID = master.OrganizationID
              AND configured.IsDeleted = FALSE
          )
        ) cfg

        WHERE ca.OpexID = ANY($1::bigint[])
          AND ca.IsDeleted = FALSE

        ORDER BY
          ca.OpexID ASC,
          cfg.ApprovalOrder ASC,
          cfg.ApprovalLevel ASC,
          ca.OpexApprovalID ASC;
      `,
      [OpexIDs],
    ),
  ]);

  // ============================================================
  // Map Opex
  // ============================================================

  const byID = new Map(
    OpexRows.map((row) => {
      const Opex = mapMaster(row);

      // ✅ FIX
      return [Opex.OpexID, Opex];
    }),
  );

  // ============================================================
  // Attach Documents
  // ============================================================

  for (const row of documentsResult.rows) {
    byID.get(Number(row.opexid))?.Documents.push(mapDocument(row));
  }

  // ============================================================
  // Attach Approvals
  // ============================================================

  for (const row of approvalsResult.rows) {
    byID.get(Number(row.opexid))?.Approvals.push(mapApproval(row));
  }

  // ============================================================
  // Return
  // ============================================================

  return OpexRows.map((row) => byID.get(Number(row.opexid)));
};
// ============================================================ Get All Opex
const getAllOpex = async (data) => {
  try {
    // console.log("GET ALL Opex DATA:", JSON.stringify(data));

    // =====================================================
    // Pagination
    // =====================================================

    const page = Number(data.page) || 1;
    const PageSize = Number(data.PageSize) || 10;

    if (!Number.isInteger(page) || page < 1) {
      return {
        success: false,
        message: "Page must be a positive integer.",
      };
    }

    if (!Number.isInteger(PageSize) || PageSize < 1) {
      return {
        success: false,
        message: "PageSize must be a positive integer.",
      };
    }

    const offset = (page - 1) * PageSize;

    // =====================================================
    // User Type
    // =====================================================

    const userType = data.UserType ? String(data.UserType).toUpperCase() : null;

    // =====================================================
    // Status
    // =====================================================

    const approvalStatus = data.Status
      ? String(data.Status).toUpperCase()
      : null;

    const validStatuses = [
      "PENDING",
      "APPROVED",
      "REJECTED",
      "HOLD",
      "RETURNED",
    ];

    if (approvalStatus && !validStatuses.includes(approvalStatus)) {
      return {
        success: false,
        message:
          "Status must be Pending, Approved, Rejected, Hold, or Returned.",
      };
    }

    // =====================================================
    // MAIN QUERY
    // =====================================================

    let query = `
      ${Opex_SELECT}
    `;

    const params = [];

    // =====================================================
    // Organization Filter
    // =====================================================

    if (data.OrganizationID !== null && data.OrganizationID !== undefined) {
      params.push(data.OrganizationID);

      query += `
        AND cm.OrganizationID = $${params.length}
      `;
    }

    // =====================================================
    // STATUS FILTER
    // =====================================================

    const approverStatusColumns = {
      HOD: "approval_state.HODStatus",
      FC: "approval_state.FCStatus",
      GM: "approval_state.GMStatus",
      "RD-FC": "approval_state.RDFCStatus",
      CEO: "approval_state.CEOStatus",
    };
    const approverStatusColumn = approverStatusColumns[userType];

    if (approverStatusColumn) {
      // ---------------------------------------------------
      // GM
      // ---------------------------------------------------

      if (["HOD", "FC", "GM", "RD-FC", "CEO"].includes(userType)) {
        if (approvalStatus === "PENDING") {
          params.push(userType);

          query += `
            AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${params.length}
            AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
          `;
        } else if (approvalStatus) {
          params.push(approvalStatus);

          query += `
            AND UPPER(
              COALESCE(
                ${approverStatusColumn},
                'PENDING'
              )
            ) = $${params.length}
          `;
        } else {
          params.push(userType);

          query += `
            AND UPPER(
              COALESCE(
                current_stage.ApprovalRole,
                ''
              )
            ) = $${params.length}

            AND UPPER(
              COALESCE(
                current_stage.Status,
                'PENDING'
              )
            ) = 'PENDING'
          `;
        }
      }
    }

    // =====================================================
    // LIMIT + OFFSET
    // =====================================================

    const limitParameter = params.length + 1;
    const offsetParameter = params.length + 2;

    query += `
      ORDER BY
        cm.CreatedDate DESC,
        cm.OpexID DESC

      LIMIT $${limitParameter}
      OFFSET $${offsetParameter};
    `;

    params.push(PageSize);
    params.push(offset);

    // =====================================================
    // COUNT QUERY
    // =====================================================

    let countQuery = `
      SELECT COUNT(*) AS TotalCount
      FROM (
        ${Opex_SELECT}
    `;

    const countParams = [];

    // =====================================================
    // Organization Count Filter
    // =====================================================

    if (data.OrganizationID !== null && data.OrganizationID !== undefined) {
      countParams.push(data.OrganizationID);

      countQuery += `
        AND cm.OrganizationID = $${countParams.length}
      `;
    }

    // =====================================================
    // COUNT STATUS FILTER
    // =====================================================

    if (approverStatusColumn) {
      if (approvalStatus === "PENDING") {
        countParams.push(userType);

        countQuery += `
          AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${countParams.length}
          AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
        `;
      } else if (approvalStatus) {
        countParams.push(approvalStatus);

        countQuery += `
          AND UPPER(
            COALESCE(
              ${approverStatusColumn},
              'PENDING'
            )
          ) = $${countParams.length}
        `;
      } else {
        countParams.push(userType);

        // Use the same current-stage filter as the main list query.
        countQuery += `
          AND UPPER(
            COALESCE(
              current_stage.ApprovalRole,
              ''
            )
          ) = $${countParams.length}

          AND UPPER(
            COALESCE(
              current_stage.Status,
              'PENDING'
            )
          ) = 'PENDING'
        `;
      }
    }

    countQuery += `
      ) filtered_opex
    `;

    // =====================================================
    // Execute
    // =====================================================

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams),
    ]);

    // =====================================================
    // Attach Related Data
    // =====================================================

    const Opex = await attachRelatedData(result.rows);

    // =====================================================
    // Pagination Count
    // =====================================================

    const totalCount = Number(countResult.rows[0].totalcount);

    const totalPages = Math.ceil(totalCount / PageSize);

    // =====================================================
    // Response
    // =====================================================

    return {
      success: true,
      message: "Opex records fetched successfully.",

      TotalCount: totalCount,
      PageCount: Opex.length,
      CurrentPage: page,
      PageSize: PageSize,
      TotalPages: totalPages,

      data: Opex,
    };
  } catch (error) {
    console.error("Get All Opex Error:", error.message);

    return fail("Unable to fetch Opex records at this time.", 503);
  }
};
// ============================================================ Get Opex By ID
const getOpexById = async (data) => {
  try {
    const result = await pool.query(
      `
      ${Opex_SELECT}
      AND cm.OpexID = $1
      LIMIT 1;
      `,
      [data.OpexID],
    );

    if (result.rows.length === 0) {
      return fail("Opex record not found.", 404);
    }

    const [Opex] = await attachRelatedData(result.rows);

    return {
      success: true,
      message: "Opex record fetched successfully.",
      data: Opex,
    };
  } catch (error) {
    console.error("Get Opex By ID Error:", error.message);
    return fail("Unable to fetch Opex record at this time.", 503);
  }
};

// ============================================================ Mutation Helpers (Update ,Delete,Approval Helpers)
// Read the effective approval configuration for one organization.
const getMergedApprovals = async (client, organizationID) => {
  const result = await client.query(
    `
    SELECT 
      OpexApprovalConfigID,
      ApprovalLevel,
      ApprovalRole,
      ApprovalOrder,
      IsMandatory
    FROM Opex_Approval_Config
    WHERE OrganizationID = $1
      AND IsDeleted = FALSE
    ORDER BY 
      ApprovalOrder ASC,
      ApprovalLevel ASC,
      OpexApprovalConfigID ASC;
    `,
    [organizationID],
  );

  // Organization-specific configuration exists
  if (result.rows.length > 0) {
    return result.rows.map((row) => ({
      LevelNo: Number(row.approvallevel),
      ApprovalRole: String(row.approvalrole || "")
        .trim()
        .toUpperCase(),
      ApprovalOrder: Number(row.approvalorder),
      IsMandatory: row.ismandatory,
    }));
  }

  // No organization-specific configuration
  // Use default GM -> CEO -> OWNER
  return DEFAULT_APPROVALS.map((approval, index) => ({
    LevelNo: approval.LevelNo,
    ApprovalRole: approval.ApprovalRole,
    ApprovalOrder: index + 1,
    IsMandatory: true,
  }));
};
// Distinguish not-found records from authorization failures.
const OpexExists = async (client, OpexID) => {
  const result = await client.query(
    `SELECT 1 FROM Opex_Master WHERE OpexID = $1 AND IsDeleted = FALSE LIMIT 1;`,
    [OpexID],
  );
  return result.rows.length > 0;
};
// ============================================================ Partial Update Opex
const updateOpex = async (data) => {
  let client;
  let transactionStarted = false;

  const documents = Array.isArray(data.Documents) ? data.Documents : [];

  const deleteDocumentIDs = Array.isArray(data.DeleteDocumentIDs)
    ? data.DeleteDocumentIDs
    : [];

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ============================================================
    // Changes
    // ============================================================

    const changes = data.Changes || {};

    const assignments = [];
    const values = [];

    const addValue = (column, value) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    // ============================================================
    // Opex Fields
    // OrganizationID and OpexNumber are NOT updated
    // ============================================================

    if (changes.Department !== undefined) {
      addValue("Department", changes.Department);
    }

    if (changes.Item !== undefined) {
      addValue("Item", changes.Item);
    }

    if (changes.Description !== undefined) {
      addValue("Description", changes.Description);
    }

    if (changes.Make !== undefined) {
      addValue("Make", changes.Make);
    }

    if (changes.Qty !== undefined) {
      addValue("Qty", changes.Qty);
    }

    if (changes.Rate !== undefined) {
      addValue("Rate", changes.Rate);
    }

    // ============================================================
    // Total comes directly from Frontend
    // ============================================================

    if (changes.Total !== undefined) {
      addValue("Total", changes.Total);
    }

    if (changes.IsVoid !== undefined) {
      addValue("IsVoid", changes.IsVoid);
    }

    if (changes.VoidRemarks !== undefined) {
      addValue("VoidRemarks", changes.VoidRemarks);
    }

    // ============================================================
    // Modified Information
    // ============================================================

    addValue("ModifiedBy", data.UserID);

    assignments.push("ModifiedDate = CURRENT_TIMESTAMP");

    // ============================================================
    // Update Opex
    // ============================================================

    values.push(data.OpexID);

    const OpexIDParameter = values.length;

    const updateResult = await client.query(
      `
      UPDATE Opex_Master
      SET ${assignments.join(", ")}
      WHERE OpexID = $${OpexIDParameter}
        AND IsDeleted = FALSE
      RETURNING
        OpexID,
        OrganizationID,
        OpexNumber,
        Department,
        Item,
        Description,
        Make,
        Qty,
        Rate,
        Total,
        IsVoid,
        VoidRemarks,
        ModifiedBy,
        ModifiedDate;
      `,
      values,
    );

    // ============================================================
    // Opex Not Found
    // ============================================================

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return fail("Opex record not found.", 404);
    }

    // ============================================================
    // DOCUMENTS
    //
    // If new documents are provided:
    //   1. Old documents are soft deleted
    //   2. New documents are inserted
    //
    // If no documents are provided:
    //   Old documents remain unchanged
    // ============================================================

    if (documents.length > 0) {
      // ----------------------------------------------------------
      // Get existing Opex number
      // ----------------------------------------------------------

      const OpexInfo = updateResult.rows[0];

      const OpexNumber = Number(OpexInfo.opexnumber);

      // ----------------------------------------------------------
      // Soft delete old documents
      // ----------------------------------------------------------

      await client.query(
        `
        UPDATE Opex_Documents
        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE OpexID = $2
          AND IsDeleted = FALSE;
        `,
        [data.UserID, data.OpexID],
      );

      // ----------------------------------------------------------
      // Generate IDs for new documents
      // ----------------------------------------------------------

      const newDocumentIDs = await reserveNumericIDs(
        client,
        "Opex_Documents",
        "OpexDocumentID",
        documents.length,
      );

      // ----------------------------------------------------------
      // Insert new documents
      // ----------------------------------------------------------

      for (const [index, document] of documents.entries()) {
        await client.query(
          `
          INSERT INTO Opex_Documents
          (
            OpexDocumentID,
            OpexID,
            OpexNumber,
            FileName,
            FilePath,
            FileType,
            FileSize,
            IsDeleted,
            CreatedBy,
            CreatedDate
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            FALSE,
            $8,
            CURRENT_TIMESTAMP
          );
          `,
          [
            newDocumentIDs[index],
            data.OpexID,
            OpexNumber,
            document.FileName,
            document.FilePath,
            document.FileType,
            document.FileSize,
            data.UserID,
          ],
        );
      }
    }

    // ============================================================
    // Specific old documents delete
    //
    // Only execute when DeleteDocumentIDs are provided
    // ============================================================

    if (deleteDocumentIDs.length > 0) {
      const ownedDocuments = await client.query(
        `
        SELECT OpexDocumentID
        FROM Opex_Documents
        WHERE OpexID = $1
          AND OpexDocumentID = ANY($2::bigint[])
          AND IsDeleted = FALSE;
        `,
        [data.OpexID, deleteDocumentIDs],
      );

      if (ownedDocuments.rows.length !== deleteDocumentIDs.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return fail("One or more selected Opex documents are invalid.", 400);
      }

      await client.query(
        `
        UPDATE Opex_Documents
        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE OpexID = $2
          AND OpexDocumentID = ANY($3::bigint[])
          AND IsDeleted = FALSE;
        `,
        [data.UserID, data.OpexID, deleteDocumentIDs],
      );
    }

    // ============================================================
    // COMMIT
    // ============================================================

    await client.query("COMMIT");
    transactionStarted = false;

    const updated = updateResult.rows[0];

    return {
      success: true,
      message: "Opex updated successfully.",

      // data: {
      //   OpexID: Number(updated.Opexid),
      //   OrganizationID: Number(updated.organizationid),
      //   OpexNumber: Number(updated.Opexnumber),
      //   Department: updated.department,
      //   Item: updated.item,
      //   Description: updated.description,
      //   Make: updated.make,
      //   Qty: Number(updated.qty),
      //   Rate: Number(updated.rate),
      //   Total: Number(updated.total),
      //   IsVoid: updated.isvoid,
      //   VoidRemarks: updated.voidremarks,
      //   DocumentsUpdated: documents.length,
      //   DocumentsDeleted: deleteDocumentIDs.length,
      // },
    };
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error("Update Opex Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    if (error.code === "23503") {
      return fail("Invalid Opex related data.", 400);
    }

    if (error.code === "23505") {
      return fail("Opex organization number already exists.", 409);
    }

    return fail("Unable to update Opex at this time.", 500);
  } finally {
    if (client) {
      client.release();
    }
  }
};
// ============================================================ Soft Delete Opex
const deleteOpex = async (data) => {
  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ============================================================
    // SOFT DELETE Opex
    // ============================================================

    const OpexResult = await client.query(
      `
      UPDATE Opex_Master
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE OpexID = $2
        AND IsDeleted = FALSE
      RETURNING OpexID;
      `,
      [data.UserID, data.OpexID],
    );

    // ============================================================
    // Opex NOT FOUND / ALREADY DELETED
    // ============================================================

    if (OpexResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return fail("Opex record not found or already deleted.", 404);
    }

    // ============================================================
    // SOFT DELETE DOCUMENTS
    // ============================================================

    await client.query(
      `
      UPDATE Opex_Documents
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE OpexID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, data.OpexID],
    );

    // ============================================================
    // SOFT DELETE APPROVALS
    // ============================================================

    await client.query(
      `
      UPDATE Opex_Approval
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE OpexID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, data.OpexID],
    );

    // ============================================================
    // COMMIT
    // ============================================================

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "Opex deleted successfully.",
    };
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error("Delete Opex Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return fail("Unable to delete Opex at this time.", 500);
  } finally {
    if (client) {
      client.release();
    }
  }
};
// ============================================================ Approval Workflow
const processOpexApproval = async (data) => {
  let client;
  let transactionStarted = false;

  // console.log("PROCESS Opex APPROVAL DATA:", JSON.stringify(data));

  try {
    // ============================================================
    // 1. NORMALIZE INPUT
    // ============================================================

    const approverRole = String(data.UserType || "")
      .trim()
      .toUpperCase();

    const action = String(data.Action || "")
      .trim()
      .toUpperCase();

    const remarks = String(data.Remarks || "").trim();

    // ============================================================
    // 2. VALIDATE ACTION
    // ============================================================

    if (!["APPROVE", "REJECT", "RETURN", "HOLD"].includes(action)) {
      return fail("Invalid Opex approval action.", 400);
    }

    // ============================================================
    // 3. REMARKS REQUIRED
    // ============================================================

    if (["REJECT", "RETURN", "HOLD"].includes(action) && !remarks) {
      return fail(`Remarks are required when the action is ${action}.`, 400);
    }

    // ============================================================
    // 4. VALIDATE ROLE
    // ============================================================

    if (!APPROVAL_ROLES.has(approverRole)) {
      return fail("Your role is not authorized for Opex approval.", 403);
    }

    // ============================================================
    // 5. DB CONNECTION
    // ============================================================

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ============================================================
    // 6. GET Opex MASTER
    // ============================================================

    const masterResult = await client.query(
      `
      SELECT
        cm.OpexID,
        cm.OpexNumber,
        cm.OrganizationID,
        cm.IsVoid,
        cm.ModifiedDate
      FROM Opex_Master cm
      WHERE cm.OpexID = $1
        AND cm.IsDeleted = FALSE
      LIMIT 1
      FOR UPDATE OF cm;
      `,
      [data.OpexID],
    );

    // ============================================================
    // 7. Opex NOT FOUND
    // ============================================================

    if (masterResult.rows.length === 0) {
      const exists = await OpexExists(client, data.OpexID);

      await rollback(client, transactionStarted);

      transactionStarted = false;

      return exists
        ? fail("Opex record is not available for approval.", 400)
        : fail("Opex record not found.", 404);
    }

    const Opex = masterResult.rows[0];

    if (Opex.isvoid === true) {
      await rollback(client, transactionStarted);
      transactionStarted = false;
      return fail("Void Opex cannot be processed for approval.", 400);
    }

    // ============================================================
    // 8. GET APPROVAL CONFIGURATION
    //
    // getMergedApprovals():
    // 1. Organization-specific configuration
    // 2. If organization config not found -> DEFAULT
    // ============================================================

    const configuredStages = await getMergedApprovals(
      client,
      Opex.organizationid,
    );

    if (!configuredStages || configuredStages.length === 0) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail("Opex approval configuration not found.", 400);
    }

    if (!approvalConfigurationIsValid(configuredStages)) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail(
        "Opex approval configuration contains an invalid approval role.",
        400,
      );
    }

    // ============================================================
    // 9. GET Opex APPROVAL
    // ============================================================

    const approvalResult = await client.query(
      `
      SELECT
        OpexApprovalID,

       HODStatus,
HODApprovedQuantity,
HODStatusDateTime,
HODStatusApprovedBy,
HODRemarks,

FCStatus,
FCApprovedQuantity,
FCStatusDateTime,
FCStatusApprovedBy,
FCRemarks,

GMStatus,
GMApprovedQuantity,
GMStatusDateTime,
GMStatusApprovedBy,
GMRemarks,

RDFCStatus,
RDFCApprovedQuantity,
RDFCStatusDateTime,
RDFCStatusApprovedBy,
RDFCRemarks,

CEOStatus,
CEOApprovedQuantity,
CEOStatusDateTime,
CEOStatusApprovedBy,
CEORemarks,

        FinalStatus,
        FinalStatusDateTime

      FROM Opex_Approval

      WHERE OpexID = $1
        AND IsDeleted = FALSE

      LIMIT 1

      FOR UPDATE;
      `,
      [data.OpexID],
    );

    // ============================================================
    // 10. APPROVAL ROW NOT FOUND
    // ============================================================

    if (approvalResult.rows.length === 0) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail("Opex approval record not found.", 404);
    }

    const approval = approvalResult.rows[0];

    // ============================================================
    // 11. ROLE DATA HELPER
    // ============================================================

    const getRoleData = (role) => {
      switch (String(role).trim().toUpperCase()) {
        case "HOD":
          return {
            status: approval.hodstatus,
            approvedQuantity: approval.hodapprovedquantity,
            statusDateTime: approval.hodstatusdatetime,
            approvedBy: approval.hodstatusapprovedby,
            remarks: approval.hodremarks,
          };

        case "FC":
          return {
            status: approval.fcstatus,
            approvedQuantity: approval.fcapprovedquantity,
            statusDateTime: approval.fcstatusdatetime,
            approvedBy: approval.fcstatusapprovedby,
            remarks: approval.fcremarks,
          };

        case "GM":
          return {
            status: approval.gmstatus,
            approvedQuantity: approval.gmapprovedquantity,
            statusDateTime: approval.gmstatusdatetime,
            approvedBy: approval.gmstatusapprovedby,
            remarks: approval.gmremarks,
          };

        case "RD-FC":
          return {
            status: approval.rdfcstatus,
            approvedQuantity: approval.rdfcapprovedquantity,
            statusDateTime: approval.rdfcstatusdatetime,
            approvedBy: approval.rdfcstatusapprovedby,
            remarks: approval.rdfcremarks,
          };

        case "CEO":
          return {
            status: approval.ceostatus,
            approvedQuantity: approval.ceoapprovedquantity,
            statusDateTime: approval.ceostatusdatetime,
            approvedBy: approval.ceostatusapprovedby,
            remarks: approval.ceoremarks,
          };

        default:
          return null;
      }
    };

    // ============================================================
    // 12. BUILD APPROVAL STAGES
    // ============================================================

    const stages = configuredStages.map((stage) => {
      const role = String(stage.ApprovalRole).trim().toUpperCase();

      const roleData = getRoleData(role);

      return {
        configured: stage,
        role,
        approval: roleData,

        status: String(roleData?.status || "Pending")
          .trim()
          .toUpperCase(),
      };
    });

    // console.log("Opex APPROVAL STAGES:", JSON.stringify(stages));

    // ============================================================
    // 13. FIND CURRENT STAGE
    //
    // IMPORTANT:
    //
    // APPROVED  -> skip
    // PENDING   -> current
    // RETURNED  -> current
    // HOLD      -> current
    // REJECTED  -> current
    //
    // This means:
    //
    // GM REJECTED
    // CEO PENDING
    //
    // GM is current again and can APPROVE.
    // ============================================================

    const currentIndex = stages.findIndex(
      (stage) => stage.status !== "APPROVED",
    );

    // ============================================================
    // 14. ALL APPROVED
    // ============================================================

    if (currentIndex === -1) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail("This Opex record is already finally approved.", 400);
    }

    const currentStage = stages[currentIndex];

    const currentRole = currentStage.role;

    const currentStatus = currentStage.status;

    // ============================================================
    // 15. FIND USER'S STAGE
    // ============================================================

    const userStageIndex = stages.findIndex(
      (stage) => stage.role === approverRole,
    );

    if (userStageIndex === -1) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail(
        `Approval stage not configured for role ${approverRole}.`,
        403,
      );
    }

    const userStage = stages[userStageIndex];

    const userStatus = userStage.status;

    // ============================================================
    // 16. CHECK PERMISSION
    //
    // RULES
    //
    // ------------------------------------------------------------
    // CASE 1:
    // Current role can APPROVE / REJECT / RETURN
    //
    // Pending:
    // GM -> APPROVE
    // GM -> REJECT
    // GM -> RETURN
    //
    // ------------------------------------------------------------
    // CASE 2:
    // Rejected current role can APPROVE again
    //
    // GM REJECTED
    // ->
    // GM APPROVE
    //
    // ------------------------------------------------------------
    // CASE 3:
    // Previous APPROVED role can REJECT / RETURN
    // while next role is PENDING.
    //
    // GM APPROVED
    // CEO PENDING
    //
    // GM:
    // APPROVE  -> NO
    // REJECT   -> YES
    // RETURN   -> YES
    //
    // CEO:
    // APPROVE  -> YES
    // REJECT   -> YES
    // RETURN   -> YES
    // ============================================================

    let canPerformAction = false;

    // ------------------------------------------------------------
    // CASE 1:
    // USER IS CURRENT STAGE
    //
    // PENDING / RETURNED / REJECTED / HOLD
    // ------------------------------------------------------------

    if (
      userStageIndex === currentIndex &&
      ["PENDING", "RETURNED", "REJECTED", "HOLD"].includes(userStatus)
    ) {
      canPerformAction = true;
    }

    // ------------------------------------------------------------
    // CASE 2:
    // PREVIOUS APPROVED STAGE
    //
    // Can only REJECT / RETURN
    // while next stage is pending.
    // ------------------------------------------------------------

    const nextStage = stages[userStageIndex + 1];

    if (
      userStageIndex < currentIndex &&
      userStatus === "APPROVED" &&
      nextStage &&
      nextStage.status === "PENDING" &&
      ["REJECT", "RETURN"].includes(action)
    ) {
      canPerformAction = true;
    }

    // ============================================================
    // 17. PERMISSION DENIED
    // ============================================================

    if (!canPerformAction) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      if (userStageIndex !== currentIndex) {
        return fail(
          `OPEX is ${currentStatus.toLowerCase()} from ${currentRole}.`,
          403,
        );
      }

      return fail(
        `The ${currentRole} approval stage is currently ${currentStatus.toLowerCase()} and cannot perform ${action.toLowerCase()} again.`,
        403,
      );
    }

    // ============================================================
    // 18. UPDATE ROLE APPROVAL HELPER
    // ============================================================

    const updateRoleApproval = async (
      role,
      status,
      userId,
      roleRemarks,
      approvedQuantity = null,
    ) => {
      let query = "";

      const params = [
        status,
        userId,
        roleRemarks || null,
        approvedQuantity !== undefined &&
        approvedQuantity !== null &&
        approvedQuantity !== ""
          ? Number(approvedQuantity)
          : null,
        approval.opexapprovalid,
      ];
      switch (role) {
        case "HOD":
          query = `
    UPDATE Opex_Approval
    SET
      HODStatus = $1,
      HODStatusDateTime = CURRENT_TIMESTAMP,
      HODStatusApprovedBy = $2,
      HODRemarks = $3,
      HODApprovedQuantity = $4,
      ModifiedBy = $2,
      ModifiedDate = CURRENT_TIMESTAMP
    WHERE OpexApprovalID = $5
      AND IsDeleted = FALSE;
  `;
          break;

        case "FC":
          query = `
    UPDATE Opex_Approval
    SET
      FCStatus = $1,
      FCStatusDateTime = CURRENT_TIMESTAMP,
      FCStatusApprovedBy = $2,
      FCRemarks = $3,
      FCApprovedQuantity = $4,
      ModifiedBy = $2,
      ModifiedDate = CURRENT_TIMESTAMP
    WHERE OpexApprovalID = $5
      AND IsDeleted = FALSE;
  `;
          break;
        case "GM":
          query = `
    UPDATE Opex_Approval
    SET
      GMStatus = $1,
      GMStatusDateTime = CURRENT_TIMESTAMP,
      GMStatusApprovedBy = $2,
      GMRemarks = $3,
      GMApprovedQuantity = $4,
      ModifiedBy = $2,
      ModifiedDate = CURRENT_TIMESTAMP
    WHERE OpexApprovalID = $5
      AND IsDeleted = FALSE;
  `;
          break;

        case "RD-FC":
          query = `
    UPDATE Opex_Approval
    SET
      RDFCStatus = $1,
      RDFCStatusDateTime = CURRENT_TIMESTAMP,
      RDFCStatusApprovedBy = $2,
      RDFCRemarks = $3,
      RDFCApprovedQuantity = $4,
      ModifiedBy = $2,
      ModifiedDate = CURRENT_TIMESTAMP
    WHERE OpexApprovalID = $5
      AND IsDeleted = FALSE;
  `;
          break;

        case "CEO":
          query = `
    UPDATE Opex_Approval
    SET
      CEOStatus = $1,
      CEOStatusDateTime = CURRENT_TIMESTAMP,
      CEOStatusApprovedBy = $2,
      CEORemarks = $3,
      CEOApprovedQuantity = $4,
      ModifiedBy = $2,
      ModifiedDate = CURRENT_TIMESTAMP
    WHERE OpexApprovalID = $5
      AND IsDeleted = FALSE;
  `;
          break;

        default:
          throw new Error(`Unsupported approval role: ${role}`);
      }

      await client.query(query, params);
    };

    // ============================================================
    // 19. APPROVE
    //
    // APPROVE ONLY CURRENT STAGE
    // ============================================================

    if (action === "APPROVE") {
      if (userStageIndex !== currentIndex) {
        await rollback(client, transactionStarted);

        transactionStarted = false;

        return fail(
          `Only the current ${currentRole} approval stage can approve this Opex.`,
          403,
        );
      }

      // ----------------------------------------------------------
      // Update current role
      // ----------------------------------------------------------

      await updateRoleApproval(approverRole, "Approved", data.UserID, remarks,data.Quantity ?? null,);

      // ----------------------------------------------------------
      // Find next stage
      // ----------------------------------------------------------

      const followingStage = stages[currentIndex + 1];

      // ----------------------------------------------------------
      // NEXT APPROVAL EXISTS
      // ----------------------------------------------------------

      if (followingStage) {
        await client.query(
          `
          UPDATE Opex_Approval
          SET
            FinalStatus = NULL,
            FinalStatusDateTime = NULL,
            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP
          WHERE OpexApprovalID = $2
            AND IsDeleted = FALSE;
          `,
          [data.UserID, approval.opexapprovalid],
        );

        await client.query("COMMIT");

        transactionStarted = false;

        return {
          success: true,

          message: "Opex approved successfully.",

          // data: {
          //   OpexID: Number(Opex.Opexid),

          //   OpexNumber: Number(Opex.Opexnumber),

          //   CurrentStatus: "Pending",

          //   CurrentApprovalRole: followingStage.role,

          //   Action: "APPROVE",
          // },
        };
      }

      // ----------------------------------------------------------
      // FINAL APPROVAL
      // ----------------------------------------------------------

      await client.query(
        `
        UPDATE Opex_Approval
        SET
          FinalStatus = 'Approved',
          FinalStatusDateTime = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE OpexApprovalID = $2
          AND IsDeleted = FALSE;
        `,
        [data.UserID, approval.opexapprovalid],
      );

      await client.query("COMMIT");

      transactionStarted = false;

      return {
        success: true,

        message: "Opex approved successfully.",

        // data: {
        //   OpexID: Number(Opex.Opexid),

        //   OpexNumber: Number(Opex.Opexnumber),

        //   CurrentStatus: "Approved",

        //   CurrentApprovalRole: null,

        //   Action: "APPROVE",
        // },
      };
    }

    // ============================================================
    // 20. REJECT
    //
    // Current stage can reject.
    //
    // Previous approved stage can also reject
    // while next stage is pending.
    //
    // Example:
    //
    // GM APPROVED
    // CEO PENDING
    //
    // GM REJECT
    //
    // GM -> REJECTED
    // FinalStatus -> REJECTED
    //
    // Later GM can APPROVE again.
    // ============================================================

    if (action === "REJECT") {
      await updateRoleApproval(approverRole, "Rejected", data.UserID, remarks, data.Quantity ?? null,);

      await client.query(
        `
        UPDATE Opex_Approval
        SET
          FinalStatus = 'Rejected',
          FinalStatusDateTime = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE OpexApprovalID = $2
          AND IsDeleted = FALSE;
        `,
        [data.UserID, approval.opexapprovalid],
      );

      await client.query("COMMIT");

      transactionStarted = false;

      return {
        success: true,

        message: "Opex rejected successfully.",

        // data: {
        //   OpexID: Number(Opex.Opexid),

        //   OpexNumber: Number(Opex.Opexnumber),

        //   CurrentStatus: "Rejected",

        //   CurrentApprovalRole: approverRole,

        //   Action: "REJECT",
        // },
      };
    }

    // ============================================================
    // 21. RETURN
    // ============================================================

    if (action === "RETURN") {
      // ----------------------------------------------------------
      // If previous approved role returns
      //
      // Example:
      //
      // GM APPROVED
      // CEO PENDING
      //
      // GM RETURN
      //
      // GM becomes RETURNED
      // GM becomes current stage
      // ----------------------------------------------------------

      await updateRoleApproval(approverRole, "Returned", data.UserID, remarks,data.Quantity ?? null,);

      await client.query(
        `
        UPDATE Opex_Approval
        SET
          FinalStatus = 'Returned',
          FinalStatusDateTime = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE OpexApprovalID = $2
          AND IsDeleted = FALSE;
        `,
        [data.UserID, approval.opexapprovalid],
      );

      await client.query("COMMIT");

      transactionStarted = false;

      return {
        success: true,

        message: "Opex returned successfully.",

        // data: {
        //   OpexID: Number(Opex.Opexid),

        //   OpexNumber: Number(Opex.Opexnumber),

        //   CurrentStatus: "Returned",

        //   CurrentApprovalRole: approverRole,

        //   Action: "RETURN",
        // },
      };
    }

    // ============================================================
    // 22. HOLD
    // Keep the current stage actionable for the same approver.
    // ============================================================

    if (action === "HOLD") {
      if (userStageIndex !== currentIndex) {
        await rollback(client, transactionStarted);
        transactionStarted = false;

        return fail(
          `Only the current ${currentRole} approval stage can hold this Opex.`,
          403,
        );
      }

      await updateRoleApproval(approverRole, "Hold", data.UserID, remarks,data.Quantity ?? null,);

      await client.query(
        `
        UPDATE Opex_Approval
        SET
          FinalStatus = 'Hold',
          FinalStatusDateTime = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE OpexApprovalID = $2
          AND IsDeleted = FALSE;
        `,
        [data.UserID, approval.opexapprovalid],
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return {
        success: true,
        message: "Opex put on hold successfully.",
      };
    }

    // ============================================================
    // 23. FALLBACK
    // ============================================================

    await rollback(client, transactionStarted);

    transactionStarted = false;

    return fail("Unable to process Opex approval.", 400);
  } catch (error) {
    await rollback(client, transactionStarted);

    console.error("Opex Approval Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return fail("Unable to process Opex approval at this time.", 500);
  } finally {
    if (client) {
      client.release();
    }
  }
};

// ============================================================ Report SQL (Summary and other reports Helpers)
// PostgreSQL derives effective status and aggregates authorized Opex records.
const REPORT_DATA_CTE = `
  WITH Opex_data AS
  (
    SELECT
      cm.OpexID,
      cm.OrganizationID,
      cm.Department,
      COALESCE(cm.Total, 0)::numeric AS Total,

      CASE

        -- ====================================================
        -- 1. VOID
        -- ====================================================
        WHEN cm.IsVoid = TRUE
          THEN 'Void'

        -- ====================================================
        -- 2. REJECTED
        -- ====================================================
        WHEN
          UPPER(COALESCE(ca.HODStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.FCStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.GMStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.RDFCStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.CEOStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.FinalStatus, '')) = 'REJECTED'
        THEN 'Rejected'

        -- ====================================================
        -- 3. RETURNED
        -- ====================================================
        WHEN
          UPPER(COALESCE(ca.HODStatus, '')) = 'RETURNED'
          OR UPPER(COALESCE(ca.FCStatus, '')) = 'RETURNED'
          OR UPPER(COALESCE(ca.GMStatus, '')) = 'RETURNED'
          OR UPPER(COALESCE(ca.RDFCStatus, '')) = 'RETURNED'
          OR UPPER(COALESCE(ca.CEOStatus, '')) = 'RETURNED'
          OR UPPER(COALESCE(ca.FinalStatus, '')) = 'RETURNED'
        THEN 'Returned'

        -- ====================================================
        -- 4. FINALLY APPROVED
        -- ====================================================
        WHEN UPPER(COALESCE(ca.FinalStatus, '')) = 'APPROVED'
        THEN 'Approved'

        -- ====================================================
        -- 5. OTHERWISE PENDING
        -- ====================================================
        ELSE 'Pending'

      END AS Status

    FROM Opex_Master cm

    LEFT JOIN Opex_Approval ca
      ON ca.OpexID = cm.OpexID
      AND ca.IsDeleted = FALSE

    WHERE cm.IsDeleted = FALSE

      -- ====================================================
      -- OPTIONAL ORGANIZATION FILTER
      --
      -- $1 = NULL
      --     => ALL organizations
      --
      -- $1 = 10
      --     => ONLY organization 10
      -- ====================================================
      AND (
        $1::bigint IS NULL
        OR cm.OrganizationID = $1::bigint
      )
  )
`;
// Keep parameter positions identical for every report query.
const reportParameters = (data) => {
  const filters = data.Filters || {};

  return [filters.OrganizationID ?? null];
};
// Read/report failures return synchronously; they are not background-retried.
const reportFailure = (error, reportName) => {
  console.error(`${reportName} Error:`, error.message);

  return fail(`Unable to generate ${reportName} at this time.`, 503);
};
// Keep role-scoped and organization-wide summaries on the same response shape.
const opexSummaryData = (row) => ({
  TotalOpex: Number(row.totalopex),
  TotalAmount: Number(row.totalamount),
  PendingCount: Number(row.pendingcount),
  PendingAmount: Number(row.pendingamount),
  ApprovedCount: Number(row.approvedcount),
  ApprovedAmount: Number(row.approvedamount),
  RejectedCount: Number(row.rejectedcount),
  RejectedAmount: Number(row.rejectedamount),
  HoldCount: Number(row.holdcount),
  HoldAmount: Number(row.holdamount),
  ReturnedCount: Number(row.returnedcount),
  ReturnedAmount: Number(row.returnedamount),
  VoidCount: Number(row.voidcount),
  VoidAmount: Number(row.voidamount),
});
// ============================================================ Summary Report
const getOpexSummaryReport = async (data) => {
  try {
    const OrganizationID = Number(data?.Filters?.OrganizationID);
    const UserType = String(data?.UserType || "").trim().toUpperCase();

    if (!Number.isSafeInteger(OrganizationID) || OrganizationID < 1) {
      return fail("OrganizationID is required.", 400);
    }

    if (!APPROVAL_ROLES.has(UserType)) {
      const result = await pool.query(
        `
        WITH organization_opex AS
        (
          SELECT
            COALESCE(cm.Total, 0)::numeric AS Total,
            CASE
              WHEN cm.IsVoid = TRUE THEN 'Void'
              WHEN UPPER(COALESCE(ca.FinalStatus, 'PENDING')) = 'APPROVED' THEN 'Approved'
              WHEN UPPER(COALESCE(ca.FinalStatus, 'PENDING')) = 'REJECTED' THEN 'Rejected'
              WHEN UPPER(COALESCE(ca.FinalStatus, 'PENDING')) = 'HOLD' THEN 'Hold'
              WHEN UPPER(COALESCE(ca.FinalStatus, 'PENDING')) = 'RETURNED' THEN 'Returned'
              ELSE 'Pending'
            END AS Status
          FROM Opex_Master cm
          LEFT JOIN Opex_Approval ca
            ON ca.OpexID = cm.OpexID
           AND ca.IsDeleted = FALSE
          WHERE cm.OrganizationID = $1
            AND cm.IsDeleted = FALSE
        )
        SELECT
          COUNT(*)::bigint AS TotalOpex,
          COALESCE(SUM(Total), 0) AS TotalAmount,
          COUNT(*) FILTER (WHERE Status = 'Pending')::bigint AS PendingCount,
          COALESCE(SUM(Total) FILTER (WHERE Status = 'Pending'), 0) AS PendingAmount,
          COUNT(*) FILTER (WHERE Status = 'Approved')::bigint AS ApprovedCount,
          COALESCE(SUM(Total) FILTER (WHERE Status = 'Approved'), 0) AS ApprovedAmount,
          COUNT(*) FILTER (WHERE Status = 'Rejected')::bigint AS RejectedCount,
          COALESCE(SUM(Total) FILTER (WHERE Status = 'Rejected'), 0) AS RejectedAmount,
          COUNT(*) FILTER (WHERE Status = 'Hold')::bigint AS HoldCount,
          COALESCE(SUM(Total) FILTER (WHERE Status = 'Hold'), 0) AS HoldAmount,
          COUNT(*) FILTER (WHERE Status = 'Returned')::bigint AS ReturnedCount,
          COALESCE(SUM(Total) FILTER (WHERE Status = 'Returned'), 0) AS ReturnedAmount,
          COUNT(*) FILTER (WHERE Status = 'Void')::bigint AS VoidCount,
          COALESCE(SUM(Total) FILTER (WHERE Status = 'Void'), 0) AS VoidAmount
        FROM organization_opex;
        `,
        [OrganizationID],
      );

      return {
        success: true,
        message: "Opex summary report fetched successfully.",
        data: opexSummaryData(result.rows[0]),
      };
    }

    const result = await pool.query(
      `
      WITH role_opex AS
      (
        SELECT
          cm.OpexID,
          COALESCE(cm.Total, 0)::numeric AS Total,
          cm.IsVoid,
          UPPER(COALESCE(ca.FinalStatus, 'PENDING')) AS FinalStatus,

          UPPER(COALESCE(
            CASE $2::text
              WHEN 'HOD' THEN ca.HODStatus
              WHEN 'FC' THEN ca.FCStatus
              WHEN 'GM' THEN ca.GMStatus
              WHEN 'RD-FC' THEN ca.RDFCStatus
              WHEN 'CEO' THEN ca.CEOStatus
            END,
            'PENDING'
          )) AS RoleStatus,

          UPPER(COALESCE(current_stage.ApprovalRole, '')) AS CurrentApprovalRole,
          UPPER(COALESCE(current_stage.Status, 'PENDING')) AS CurrentStageStatus

        FROM Opex_Master cm

        LEFT JOIN Opex_Approval ca
          ON ca.OpexID = cm.OpexID
         AND ca.IsDeleted = FALSE

        LEFT JOIN LATERAL
        (
          SELECT
            cfg.ApprovalRole,
            CASE UPPER(cfg.ApprovalRole)
              WHEN 'HOD' THEN COALESCE(ca.HODStatus, 'Pending')
              WHEN 'FC' THEN COALESCE(ca.FCStatus, 'Pending')
              WHEN 'GM' THEN COALESCE(ca.GMStatus, 'Pending')
              WHEN 'RD-FC' THEN COALESCE(ca.RDFCStatus, 'Pending')
              WHEN 'CEO' THEN COALESCE(ca.CEOStatus, 'Pending')
            END AS Status,
            cfg.ApprovalLevel,
            cfg.ApprovalOrder
          FROM
          (
            SELECT
              configured.ApprovalLevel,
              configured.ApprovalRole,
              configured.ApprovalOrder
            FROM Opex_Approval_Config configured
            WHERE configured.OrganizationID = cm.OrganizationID
              AND configured.IsDeleted = FALSE

            UNION ALL

            SELECT
              defaults.ApprovalLevel,
              defaults.ApprovalRole,
              defaults.ApprovalOrder
            FROM
            (
              VALUES
                (1, 'HOD', 1),
                (2, 'FC', 2),
                (3, 'GM', 3),
                (4, 'RD-FC', 4),
                (5, 'CEO', 5)
            ) defaults(ApprovalLevel, ApprovalRole, ApprovalOrder)
            WHERE NOT EXISTS
            (
              SELECT 1
              FROM Opex_Approval_Config configured
              WHERE configured.OrganizationID = cm.OrganizationID
                AND configured.IsDeleted = FALSE
            )
          ) cfg
          WHERE UPPER(
            CASE UPPER(cfg.ApprovalRole)
              WHEN 'HOD' THEN COALESCE(ca.HODStatus, 'Pending')
              WHEN 'FC' THEN COALESCE(ca.FCStatus, 'Pending')
              WHEN 'GM' THEN COALESCE(ca.GMStatus, 'Pending')
              WHEN 'RD-FC' THEN COALESCE(ca.RDFCStatus, 'Pending')
              WHEN 'CEO' THEN COALESCE(ca.CEOStatus, 'Pending')
            END
          ) NOT IN ('APPROVED', 'REJECTED')
          ORDER BY cfg.ApprovalOrder ASC, cfg.ApprovalLevel ASC
          LIMIT 1
        ) current_stage ON TRUE

        WHERE cm.OrganizationID = $1
          AND cm.IsDeleted = FALSE
      ),

      visible_opex AS
      (
        SELECT
          OpexID,
          Total,
          CASE
            WHEN IsVoid = TRUE THEN 'Void'
            WHEN RoleStatus = 'PENDING'
              AND CurrentApprovalRole = $2
              AND CurrentStageStatus = 'PENDING'
              AND FinalStatus = 'PENDING'
            THEN 'Pending'
            WHEN RoleStatus = 'APPROVED' THEN 'Approved'
            WHEN RoleStatus = 'REJECTED' THEN 'Rejected'
            WHEN RoleStatus = 'HOLD' THEN 'Hold'
            WHEN RoleStatus = 'RETURNED' THEN 'Returned'
            ELSE NULL
          END AS Status
        FROM role_opex
        WHERE RoleStatus IN ('APPROVED', 'REJECTED', 'HOLD', 'RETURNED')
           OR (
             RoleStatus = 'PENDING'
             AND CurrentApprovalRole = $2
             AND CurrentStageStatus = 'PENDING'
             AND FinalStatus = 'PENDING'
           )
      )

      SELECT

        -- ====================================================
        -- TOTAL
        -- ====================================================

        COUNT(*)::bigint AS TotalOpex,

        COALESCE(
          SUM(Total),
          0
        ) AS TotalAmount,


        -- ====================================================
        -- PENDING
        -- ====================================================

        COUNT(*) FILTER (
          WHERE Status = 'Pending'
        )::bigint AS PendingCount,

        COALESCE(
          SUM(Total) FILTER (
            WHERE Status = 'Pending'
          ),
          0
        ) AS PendingAmount,


        -- ====================================================
        -- APPROVED
        -- ====================================================

        COUNT(*) FILTER (
          WHERE Status = 'Approved'
        )::bigint AS ApprovedCount,

        COALESCE(
          SUM(Total) FILTER (
            WHERE Status = 'Approved'
          ),
          0
        ) AS ApprovedAmount,


        -- ====================================================
        -- REJECTED
        -- ====================================================

        COUNT(*) FILTER (
          WHERE Status = 'Rejected'
        )::bigint AS RejectedCount,

        COALESCE(
          SUM(Total) FILTER (
            WHERE Status = 'Rejected'
          ),
          0
        ) AS RejectedAmount,


        -- ====================================================
        -- HOLD
        -- ====================================================

        COUNT(*) FILTER (
          WHERE Status = 'Hold'
        )::bigint AS HoldCount,

        COALESCE(
          SUM(Total) FILTER (
            WHERE Status = 'Hold'
          ),
          0
        ) AS HoldAmount,


        -- ====================================================
        -- RETURNED
        -- ====================================================

        COUNT(*) FILTER (
          WHERE Status = 'Returned'
        )::bigint AS ReturnedCount,

        COALESCE(
          SUM(Total) FILTER (
            WHERE Status = 'Returned'
          ),
          0
        ) AS ReturnedAmount,


        -- ====================================================
        -- VOID
        -- ====================================================

        COUNT(*) FILTER (
          WHERE Status = 'Void'
        )::bigint AS VoidCount,

        COALESCE(
          SUM(Total) FILTER (
            WHERE Status = 'Void'
          ),
          0
        ) AS VoidAmount

      FROM visible_opex
      WHERE Status IS NOT NULL;
      `,
      [OrganizationID, UserType],
    );

    const row = result.rows[0];

    return {
      success: true,

      message: "Opex summary report fetched successfully.",

      data: opexSummaryData(row),
    };
  } catch (error) {
    return reportFailure(error, "Opex summary report");
  }
};
// ===========================================================================(Department and Organization Reports Helpers)
// Normalize grouped PostgreSQL results into the public API response shape.
const groupedReportRows = (rows, groupField) =>
  rows.map((row) => ({
    [groupField]:
      groupField === "OrganizationID"
        ? Number(row.organizationid)
        : row.department,
    Count: Number(row.count),
    TotalAmount: Number(row.totalamount),
    ApprovedCount: Number(row.approvedcount),
    PendingCount: Number(row.pendingcount),
    RejectedCount: Number(row.rejectedcount),
    ReturnedCount: Number(row.returnedcount),
  }));
// ============================================================ Department Report
const getOpexDepartmentReport = async (data) => {
  try {
    const result = await pool.query(
      `${REPORT_DATA_CTE}
       SELECT
         COALESCE(Department, 'Unspecified') AS Department,
         COUNT(*)::bigint AS Count,
         COALESCE(SUM(Total), 0) AS TotalAmount,
         COUNT(*) FILTER (WHERE Status = 'Approved')::bigint AS ApprovedCount,
         COUNT(*) FILTER (WHERE Status = 'Pending')::bigint AS PendingCount,
         COUNT(*) FILTER (WHERE Status = 'Rejected')::bigint AS RejectedCount,
         COUNT(*) FILTER (WHERE Status = 'Returned')::bigint AS ReturnedCount
       FROM Opex_data
       GROUP BY COALESCE(Department, 'Unspecified')
       ORDER BY COALESCE(Department, 'Unspecified') ASC;`,
      reportParameters(data),
    );

    return {
      success: true,
      message: "Opex department report fetched successfully.",
      data: groupedReportRows(result.rows, "Department"),
    };
  } catch (error) {
    return reportFailure(error, "Opex department report");
  }
};
// ============================================================ Organization Report
const getOpexOrganizationReport = async (data) => {
  try {
    const result = await pool.query(
      `${REPORT_DATA_CTE}
       SELECT
         cm.OrganizationID,
         COALESCE(om.ShortName, 'Unspecified') AS ShortName,

         COUNT(*)::bigint AS Count,

         COALESCE(SUM(cm.Total), 0) AS TotalAmount,

         COUNT(*) FILTER (
           WHERE cm.Status = 'Approved'
         )::bigint AS ApprovedCount,

         COUNT(*) FILTER (
           WHERE cm.Status = 'Pending'
         )::bigint AS PendingCount,

         COUNT(*) FILTER (
           WHERE cm.Status = 'Rejected'
         )::bigint AS RejectedCount,

         COUNT(*) FILTER (
           WHERE cm.Status = 'Returned'
         )::bigint AS ReturnedCount

       FROM Opex_data cm

       LEFT JOIN Organization_Master om
         ON om.OrganizationID = cm.OrganizationID
         AND om.IsDeleted = FALSE

       GROUP BY
         cm.OrganizationID,
         om.ShortName

       ORDER BY
         cm.OrganizationID ASC;`,
      reportParameters(data),
    );

    return {
      success: true,
      message: "Opex organization report fetched successfully.",
      data: result.rows.map((row) => ({
        OrganizationID: Number(row.organizationid),
        ShortName: row.shortname,
        Count: Number(row.count),
        TotalAmount: Number(row.totalamount),
        ApprovedCount: Number(row.approvedcount),
        PendingCount: Number(row.pendingcount),
        RejectedCount: Number(row.rejectedcount),
        ReturnedCount: Number(row.returnedcount),
      })),
    };
  } catch (error) {
    return reportFailure(error, "Opex organization report");
  }
};

// ============================================================ Get Approval Config
const getApprovalConfig = async (data) => {
  try {
    const { OrganizationID } = data;

    let query = `
      SELECT
        OpexApprovalConfigID,
        OrganizationID,
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
        IsMandatory,
        CreatedBy,
        CreatedDate,
        ModifiedBy,
        ModifiedDate
      FROM Opex_Approval_Config
      WHERE IsDeleted = FALSE
    `;

    const params = [];

    if (OrganizationID !== null && OrganizationID !== undefined) {
      params.push(OrganizationID);

      query += `
        AND OrganizationID = $${params.length}
      `;
    }

    query += `
      ORDER BY
        OrganizationID ASC,
        ApprovalOrder ASC,
        ApprovalLevel ASC,
        OpexApprovalConfigID ASC;
    `;

    const result = await pool.query(query, params);

    return {
      success: true,
      message: "Opex approval configuration fetched successfully.",
      data: result.rows.map((row) => ({
        OpexApprovalConfigID: Number(row.opexapprovalconfigid),
        OrganizationID: Number(row.organizationid),
        ApprovalLevel: Number(row.approvallevel),
        ApprovalRole: row.approvalrole,
        ApprovalOrder: Number(row.approvalorder),
        IsMandatory: row.ismandatory,

        CreatedDate: formatDate(row.createddate),
      })),
    };
  } catch (error) {
    console.error("Get Opex Approval Config Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return fail(
      "Unable to fetch Opex approval configuration at this time.",
      500,
    );
  }
};
// ============================================================Create Approval Config
const createApprovalConfig = async (data) => {
  let client;
  let transactionStarted = false;

  try {
    console.log("SAVE Opex DATA =>", JSON.stringify(data, null, 2));

    const OrganizationID = Number(data.OrganizationID);

    const approvals = Array.isArray(data.Approvals) ? data.Approvals : [];

    if (!Number.isInteger(OrganizationID) || OrganizationID <= 0) {
      return fail("OrganizationID is required.", 400);
    }

    if (approvals.length === 0) {
      return fail("At least one approval configuration is required.", 400);
    }

    // ============================================================
    // NORMALIZE + VALIDATE
    // ============================================================

    const normalizedApprovals = approvals.map((approval) => ({
      ApprovalLevel: Number(approval.ApprovalLevel),

      ApprovalRole: String(approval.ApprovalRole || "")
        .trim()
        .toUpperCase(),

      ApprovalOrder: Number(approval.ApprovalOrder),

      IsMandatory:
        approval.IsMandatory === undefined
          ? true
          : Boolean(approval.IsMandatory),
    }));

    const levels = new Set();
    const roles = new Set();

    for (const approval of normalizedApprovals) {
      const { ApprovalLevel, ApprovalRole, ApprovalOrder } = approval;

      if (!Number.isInteger(ApprovalLevel) || ApprovalLevel < 1) {
        return fail("ApprovalLevel must be a positive integer.", 400);
      }

      if (!Number.isInteger(ApprovalOrder) || ApprovalOrder < 1) {
        return fail("ApprovalOrder must be a positive integer.", 400);
      }

      if (!APPROVAL_ROLES.has(ApprovalRole)) {
        return fail("ApprovalRole must be HOD, FC, GM, RD-FC, or CEO.", 400);
      }

      if (levels.has(ApprovalLevel)) {
        return fail(
          `Approval level ${ApprovalLevel} is duplicated in request.`,
          409,
        );
      }

      if (roles.has(ApprovalRole)) {
        return fail(
          `${ApprovalRole} approval stage is duplicated in request.`,
          409,
        );
      }

      levels.add(ApprovalLevel);
      roles.add(ApprovalRole);
    }

    // ============================================================
    // TRANSACTION
    // ============================================================

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ============================================================
    // GET ALL EXISTING CONFIGS
    // Active + Deleted
    // ============================================================

    const existingResult = await client.query(
      `
      SELECT
        OpexApprovalConfigID AS "OpexApprovalConfigID",
        OrganizationID AS "OrganizationID",
        ApprovalLevel AS "ApprovalLevel",
        ApprovalRole AS "ApprovalRole",
        ApprovalOrder AS "ApprovalOrder",
        IsMandatory AS "IsMandatory",
        IsDeleted AS "IsDeleted"
      FROM Opex_Approval_Config
      WHERE OrganizationID = $1
      ORDER BY ApprovalLevel ASC, OpexApprovalConfigID ASC
      FOR UPDATE;
      `,
      [OrganizationID],
    );

    const existingConfigs = existingResult.rows;

    console.log(
      "EXISTING Opex CONFIGS =>",
      JSON.stringify(existingConfigs, null, 2),
    );

    // ============================================================
    // MAP BY LEVEL
    // ============================================================

    const existingByLevel = new Map();

    for (const row of existingConfigs) {
      existingByLevel.set(Number(row.ApprovalLevel), row);
    }

    const processedLevels = new Set();

    const inserted = [];
    const updated = [];
    const restored = [];
    const deleted = [];

    // ============================================================
    // INSERT / UPDATE / RESTORE
    // ============================================================

    for (const approval of normalizedApprovals) {
      const { ApprovalLevel, ApprovalRole, ApprovalOrder, IsMandatory } =
        approval;

      const existing = existingByLevel.get(ApprovalLevel);

      // ==========================================================
      // EXISTING RECORD
      // ==========================================================

      if (existing) {
        const ConfigID = Number(existing.OpexApprovalConfigID);

        if (!Number.isInteger(ConfigID)) {
          throw new Error(
            `Invalid OpexApprovalConfigID: ${existing.OpexApprovalConfigID}`,
          );
        }

        // --------------------------------------------------------
        // RESTORE SOFT DELETED RECORD
        // --------------------------------------------------------

        if (existing.IsDeleted === true) {
          await client.query(
            `
            UPDATE Opex_Approval_Config
            SET
              ApprovalRole = $1,
              ApprovalOrder = $2,
              IsMandatory = $3,
              IsDeleted = FALSE,
              ModifiedBy = $4,
              ModifiedDate = CURRENT_TIMESTAMP
            WHERE OpexApprovalConfigID = $5
              AND OrganizationID = $6;
            `,
            [
              ApprovalRole,
              ApprovalOrder,
              IsMandatory,
              data.UserID,
              ConfigID,
              OrganizationID,
            ],
          );

          restored.push(ConfigID);
        }

        // --------------------------------------------------------
        // NORMAL UPDATE
        // --------------------------------------------------------
        else {
          await client.query(
            `
            UPDATE Opex_Approval_Config
            SET
              ApprovalRole = $1,
              ApprovalOrder = $2,
              IsMandatory = $3,
              ModifiedBy = $4,
              ModifiedDate = CURRENT_TIMESTAMP
            WHERE OpexApprovalConfigID = $5
              AND OrganizationID = $6
              AND IsDeleted = FALSE;
            `,
            [
              ApprovalRole,
              ApprovalOrder,
              IsMandatory,
              data.UserID,
              ConfigID,
              OrganizationID,
            ],
          );

          updated.push(ConfigID);
        }
      }

      // ==========================================================
      // NEW INSERT
      // ==========================================================
      else {
        const [ConfigID] = await reserveNumericIDs(
          client,
          "Opex_Approval_Config",
          "OpexApprovalConfigID",
        );

        const result = await client.query(
          `
          INSERT INTO Opex_Approval_Config
          (
            OpexApprovalConfigID,
            OrganizationID,
            ApprovalLevel,
            ApprovalRole,
            ApprovalOrder,
            IsMandatory,
            IsDeleted,
            CreatedBy,
            CreatedDate
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            FALSE,
            $7,
            CURRENT_TIMESTAMP
          )
          RETURNING OpexApprovalConfigID AS "OpexApprovalConfigID";
          `,
          [
            ConfigID,
            OrganizationID,
            ApprovalLevel,
            ApprovalRole,
            ApprovalOrder,
            IsMandatory,
            data.UserID,
          ],
        );

        const savedConfigID = Number(result.rows[0].OpexApprovalConfigID);

        inserted.push(savedConfigID);
      }

      processedLevels.add(ApprovalLevel);
    }

    // ============================================================
    // SOFT DELETE
    // DB ME HAI BUT REQUEST ME NAHI HAI
    // ============================================================

    for (const existing of existingConfigs) {
      const level = Number(existing.ApprovalLevel);

      if (existing.IsDeleted === false && !processedLevels.has(level)) {
        const ConfigID = Number(existing.OpexApprovalConfigID);

        if (!Number.isInteger(ConfigID)) {
          throw new Error(
            `Invalid OpexApprovalConfigID: ${existing.OpexApprovalConfigID}`,
          );
        }

        await client.query(
          `
          UPDATE Opex_Approval_Config
          SET
            IsDeleted = TRUE,
            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP
          WHERE OpexApprovalConfigID = $2
            AND OrganizationID = $3
            AND IsDeleted = FALSE;
          `,
          [data.UserID, ConfigID, OrganizationID],
        );

        deleted.push(ConfigID);
      }
    }

    // ============================================================
    // COMMIT
    // ============================================================

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "Opex approval configuration saved successfully.",
    };
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error("Save Opex Approval Config Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) return retryResponse;

    if (error.code === "23505") {
      return fail("Opex approval configuration already exists.", 409);
    }

    if (error.code === "23503") {
      return fail("Invalid organization or user.", 400);
    }

    return fail(
      "Unable to save Opex approval configuration at this time.",
      500,
    );
  } finally {
    if (client) {
      client.release();
    }
  }
};
// ============================================================Delete Approval Config
const deleteApprovalConfig = async (data) => {
  let client;
  let transactionStarted = false;

  try {
    const ConfigID = Number(data.OpexApprovalConfigID);

    if (!ConfigID) {
      return fail("OpexApprovalConfigID is required.", 400);
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const result = await client.query(
      `
      UPDATE Opex_Approval_Config
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE OpexApprovalConfigID = $2
        AND IsDeleted = FALSE
      RETURNING
        OpexApprovalConfigID,
        OrganizationID;
      `,
      [data.UserID, ConfigID],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return fail("Opex approval configuration not found.", 404);
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "Opex approval configuration deleted successfully.",
    };
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error("Delete Opex Approval Config Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return fail(
      "Unable to delete Opex approval configuration at this time.",
      500,
    );
  } finally {
    if (client) client.release();
  }
};
// ===================================================================Pdf Apis
// ============================================================Generate Opex List PDF
const generateOpexListPdf = async (Opex) => {
  const fonts = {
    Roboto: {
      normal: path.join(process.cwd(), "fonts/Roboto-Regular.ttf"),
      bold: path.join(process.cwd(), "fonts/Roboto-Medium.ttf"),
      italics: path.join(process.cwd(), "fonts/Roboto-SemiBold.ttf"),
      bolditalics: path.join(process.cwd(), "fonts/Roboto-Bold.ttf"),
    },
  };

  const printer = new PdfPrinter(fonts);

  // ============================================================
  // Opex DETAILS
  // ============================================================

  const OpexDetails = [
    [
      { text: "Opex Number", style: "label" },
      { text: String(Opex.OpexNumber ?? "-"), style: "value" },
      { text: "Opex ID", style: "label" },
      { text: String(Opex.OpexID ?? "-"), style: "value" },
    ],
    [
      { text: "Department", style: "label" },
      { text: Opex.Department || "-", style: "value" },
      { text: "Item", style: "label" },
      { text: Opex.Item || "-", style: "value" },
    ],
    [
      { text: "Description", style: "label" },
      {
        text: Opex.Description || "-",
        style: "value",
        colSpan: 3,
      },
      {},
      {},
    ],
    [
      { text: "Make", style: "label" },
      { text: Opex.Make || "-", style: "value" },
      { text: "Quantity", style: "label" },
      { text: String(Opex.Qty ?? "-"), style: "value" },
    ],
    [
      { text: "Rate", style: "label" },
      {
        text:
          Opex.Rate != null
            ? `₹ ${Number(Opex.Rate).toLocaleString("en-IN")}`
            : "-",
        style: "value",
      },
      { text: "Total", style: "label" },
      {
        text:
          Opex.Total != null
            ? `₹ ${Number(Opex.Total).toLocaleString("en-IN")}`
            : "-",
        style: "value",
      },
    ],
    [
      { text: "Status", style: "label" },
      { text: Opex.CurrentStatus || "-", style: "value" },
      { text: "Current Role", style: "label" },
      { text: Opex.CurrentApprovalRole || "-", style: "value" },
    ],
    [
      { text: "Created Date", style: "label" },
      {
        text: Opex.CreatedDate ? formatDate(Opex.CreatedDate) : "-",
        style: "value",
      },
      { text: "Created By", style: "label" },
      {
        text: Opex.CreatedBy != null ? String(Opex.CreatedBy) : "-",
        style: "value",
      },
    ],
    [
      { text: "Modified Date", style: "label" },
      {
        text: Opex.ModifiedDate ? formatDate(Opex.ModifiedDate) : "-",
        style: "value",
      },
      { text: "Modified By", style: "label" },
      {
        text: Opex.ModifiedBy != null ? String(Opex.ModifiedBy) : "-",
        style: "value",
      },
    ],
  ];

  // ============================================================
  // APPROVALS
  // ============================================================

  const approvalRows = [
    [
      { text: "Level", style: "tableHeader" },
      { text: "Role", style: "tableHeader" },
      { text: "Status", style: "tableHeader" },
      { text: "Date", style: "tableHeader" },
      { text: "Approved By", style: "tableHeader" },
      { text: "Remarks", style: "tableHeader" },
    ],
  ];

  if (Opex.Approvals?.length) {
    Opex.Approvals.forEach((approval) => {
      approvalRows.push([
        {
          text: String(approval.LevelNo ?? "-"),
          style: "tableCell",
        },
        {
          text: approval.ApprovalRole || "-",
          style: "tableCell",
        },
        {
          text: approval.Status || "-",
          style: "tableCell",
        },
        {
          text: approval.StatusDateTime
            ? formatDate(approval.StatusDateTime)
            : "-",
          style: "tableCell",
        },
        {
          text:
            approval.StatusApprovedBy != null
              ? String(approval.StatusApprovedBy)
              : "-",
          style: "tableCell",
        },
        {
          text: approval.Remarks || "-",
          style: "tableCell",
        },
      ]);
    });
  } else {
    approvalRows.push([
      {
        text: "No approval records found.",
        colSpan: 6,
        alignment: "center",
        style: "tableCell",
      },
      {},
      {},
      {},
      {},
      {},
    ]);
  }

  // ============================================================
  // DOCUMENTS
  // ============================================================

  const documentRows = [
    [
      { text: "Document ID", style: "tableHeader" },
      { text: "File Name", style: "tableHeader" },
      { text: "File Type", style: "tableHeader" },
      { text: "File Size", style: "tableHeader" },
    ],
  ];

  if (Opex.Documents?.length) {
    Opex.Documents.forEach((document) => {
      documentRows.push([
        {
          text: String(document.OpexDocumentID ?? "-"),
          style: "tableCell",
        },
        {
          text: document.FileName || "-",
          style: "tableCell",
        },
        {
          text: document.FileType || "-",
          style: "tableCell",
        },
        {
          text:
            document.FileSize != null
              ? `${Number(document.FileSize).toLocaleString("en-IN")} bytes`
              : "-",
          style: "tableCell",
        },
      ]);
    });
  } else {
    documentRows.push([
      {
        text: "No documents found.",
        colSpan: 4,
        alignment: "center",
        style: "tableCell",
      },
      {},
      {},
      {},
    ]);
  }

  // ============================================================
  // PDF
  // ============================================================

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [30, 30, 30, 35],

    defaultStyle: {
      font: "Roboto",
      fontSize: 9,
    },

    content: [
      {
        table: {
          widths: ["*", "auto"],
          body: [
            [
              {
                text: "Opex DETAILS",
                style: "title",
                border: [false, false, false, false],
              },
              {
                text: Opex.CurrentStatus || "Pending",
                style: "status",
                border: [false, false, false, false],
              },
            ],
          ],
        },
        layout: "noBorders",
        marginBottom: 15,
      },

      {
        text: "Opex INFORMATION",
        style: "sectionTitle",
        marginBottom: 6,
      },

      {
        table: {
          widths: [85, "*", 85, "*"],
          body: OpexDetails,
        },
        layout: {
          fillColor: (rowIndex) => (rowIndex % 2 === 0 ? "#F5F7FA" : "#FFFFFF"),
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => "#D0D7DE",
          vLineColor: () => "#D0D7DE",
          paddingLeft: () => 7,
          paddingRight: () => 7,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        marginBottom: 18,
      },

      {
        text: "APPROVAL DETAILS",
        style: "sectionTitle",
        marginBottom: 6,
      },

      {
        table: {
          headerRows: 1,
          widths: [35, 60, 65, 85, 65, "*"],
          body: approvalRows,
        },
        layout: {
          fillColor: (rowIndex) =>
            rowIndex === 0
              ? "#4472C4"
              : rowIndex % 2 === 0
                ? "#F2F5FA"
                : "#FFFFFF",

          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => "#C5D0E0",
          vLineColor: () => "#C5D0E0",
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
        marginBottom: 18,
      },

      {
        text: "DOCUMENTS",
        style: "sectionTitle",
        marginBottom: 6,
      },

      {
        table: {
          headerRows: 1,
          widths: [65, "*", 100, 100],
          body: documentRows,
        },
        layout: {
          fillColor: (rowIndex) =>
            rowIndex === 0
              ? "#4472C4"
              : rowIndex % 2 === 0
                ? "#F2F5FA"
                : "#FFFFFF",

          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => "#C5D0E0",
          vLineColor: () => "#C5D0E0",
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
      },
    ],

    footer: (currentPage, pageCount) => ({
      columns: [
        {
          text: "Opex Management",
          alignment: "left",
          fontSize: 8,
          color: "#666666",
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: "right",
          fontSize: 8,
          color: "#666666",
        },
      ],
      margin: [30, 5, 30, 0],
    }),

    styles: {
      title: {
        fontSize: 18,
        bold: true,
        color: "#1F2937",
      },

      status: {
        fontSize: 10,
        bold: true,
        color: "#4472C4",
        alignment: "right",
      },

      sectionTitle: {
        fontSize: 11,
        bold: true,
        color: "#4472C4",
      },

      label: {
        fontSize: 8,
        bold: true,
        color: "#555555",
      },

      value: {
        fontSize: 9,
        color: "#222222",
      },

      tableHeader: {
        fontSize: 8,
        bold: true,
        color: "#FFFFFF",
      },

      tableCell: {
        fontSize: 8,
        color: "#222222",
      },
    },
  };

  // ============================================================
  // PDF -> Buffer
  // ============================================================

  return new Promise((resolve, reject) => {
    try {
      const pdfDoc = printer.createPdfKitDocument(docDefinition);

      const chunks = [];

      pdfDoc.on("data", (chunk) => {
        chunks.push(chunk);
      });

      pdfDoc.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      pdfDoc.on("error", reject);

      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// ============================================================ Exports
module.exports = {
  createOpex,
  getAllOpex,
  getOpexById,
  updateOpex,
  deleteOpex,
  processOpexApproval,
  getOpexSummaryReport,
  getOpexDepartmentReport,
  getOpexOrganizationReport,
  getApprovalConfig,
  createApprovalConfig,
  deleteApprovalConfig,
  generateOpexListPdf,
};
