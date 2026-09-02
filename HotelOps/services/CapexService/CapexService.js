const { pool } = require("../../db");
const {retryableDatabaseResponse,} = require("../../utils/retryableDatabaseError");
const generateDocumentUrl = require("../../AzurConfigration/Capex/AzureGetData");
const { formatDate } = require("../../utils/dateFormatter");
const { generatePdf } = require("../../utils/pdfHelper");
// ==============================================================Default roles
const DEFAULT_APPROVALS = Object.freeze([
  { LevelNo: 1, ApprovalRole: "GM" },
  { LevelNo: 2, ApprovalRole: "CEO" },
  { LevelNo: 3, ApprovalRole: "OWNER" },
]);
const APPROVAL_ROLES = new Set(["GM", "CEO", "OWNER"]);

// ============================================================ Shared Response Helpers(Create Helpers)
const fail = (message, statusCode = 400) => ({
  success: false,
  statusCode,
  message,
});
// Merge organization overrides with the GM -> CEO -> OWNER defaults.
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
// CAPEX currently supports only these three business approval roles.
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
    console.error("CAPEX Rollback Error:", error.message);
  }
};
// Roll back database work and return the requested failure response.
const cleanupAndFail = async (client, transactionStarted, response) => {
  await rollback(client, transactionStarted);
  return response;
};
// Reserve numeric IDs safely because the existing CAPEX ID columns have no defaults.
const reserveNumericIDs = async (client, tableName, columnName, count = 1) => {
  if (count < 1) return [];

  const allowedColumns = {
    Capex_Master: "CapexID",
    Capex_Documents: "CapexDocumentID",
    Capex_Approval: "CapexApprovalID",
  };

  if (allowedColumns[tableName] !== columnName) {
    throw new Error("Invalid CAPEX ID reservation target");
  }

  const lockKey = `${tableName}.${columnName}`;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1));", [lockKey]);

  const result = await client.query(
    `SELECT COALESCE(MAX(${columnName}), 0) + 1 AS NextID FROM ${tableName};`,
  );
  const firstID = Number(result.rows[0].nextid);

  return Array.from({ length: count }, (_value, index) => firstID + index);
};
// ============================================================ Create CAPEX
const createCapex = async (data) => {
  let client;
  let transactionStarted = false;
  const documents = Array.isArray(data.Documents) ? data.Documents : [];

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const sequenceResult = await client.query(
      `
      INSERT INTO Capex_Organization_Sequence
      (
        OrganizationID,
        LastCapexNumber
      )
      VALUES ($1, 1)
      ON CONFLICT (OrganizationID)
      DO UPDATE SET
        LastCapexNumber = Capex_Organization_Sequence.LastCapexNumber + 1
      RETURNING LastCapexNumber;
      `,
      [data.OrganizationID],
    );

    const capexNumber = Number(sequenceResult.rows[0].lastcapexnumber);
    const [capexID] = await reserveNumericIDs(
      client,
      "Capex_Master",
      "CapexID",
    );

    const masterResult = await client.query(
      `
      INSERT INTO Capex_Master
      (
        CapexID,
        OrganizationID,
        CapexNumber,
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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        FALSE, FALSE, $11, CURRENT_TIMESTAMP
      )
      RETURNING CapexID, Total;
      `,
      [
        capexID,
        data.OrganizationID,
        capexNumber,
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

    const total = Number(masterResult.rows[0].total);

    const documentIDs = await reserveNumericIDs(
      client,
      "Capex_Documents",
      "CapexDocumentID",
      documents.length,
    );
    for (const [index, document] of documents.entries()) {
      await client.query(
        `
        INSERT INTO Capex_Documents
        (
          CapexDocumentID,
          CapexID,
          CapexNumber,
          FileName,
          FilePath,
          FileType,
          FileSize,
          IsDeleted,
          CreatedBy,
          CreatedDate
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, CURRENT_TIMESTAMP);
        `,
        [
          documentIDs[index],
          capexID,
          capexNumber,
          document.FileName,
          document.FilePath,
          document.FileType,
          document.FileSize,
          data.CreatedBy,
        ],
      );
    }

    const approvalConfigResult = await client.query(
      `
      SELECT ApprovalLevel AS LevelNo, ApprovalRole
      FROM Capex_Approval_Config
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
      ORDER BY ApprovalOrder ASC, ApprovalLevel ASC, CapexApprovalConfigID ASC;
      `,
      [data.OrganizationID],
    );

    const approvals = mergeApprovalConfiguration(approvalConfigResult.rows);

    if (!approvalConfigurationIsValid(approvals)) {
      return await cleanupAndFail(
        client,
        transactionStarted,
        fail(
          "CAPEX approval configuration contains an invalid approval role.",
          400,
        ),
      );
    }

    const [approvalID] = await reserveNumericIDs(
      client,
      "Capex_Approval",
      "CapexApprovalID",
    );
    await client.query(
      `
      INSERT INTO Capex_Approval
      (
        CapexApprovalID,
        CapexID,
        GMStatus,
        CEOStatus,
        OwnerStatus,
        FinalStatus,
        IsDeleted,
        CreatedBy,
        CreatedDate
      )
      VALUES ($1, $2, 'Pending', 'Pending', 'Pending', 'Pending', FALSE, $3, CURRENT_TIMESTAMP);
      `,
      [approvalID, capexID, data.CreatedBy],
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "CAPEX created successfully.",
      // data: {
      //   CapexID: capexID,
      //   CapexNumber: capexNumber,
      //   Total: total,
      //   DocumentCount: documents.length,
      //   Approvals: approvals.map((approval) => ({
      //     ...approval,
      //     Status: "Pending",
      //   })),
      // },
    };
  } catch (error) {
    await rollback(client, transactionStarted);

    console.error("Create CAPEX Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    if (error.code === "23503") {
      return fail("Invalid CAPEX organization or related data.", 400);
    }

    if (error.code === "23505") {
      return fail("A CAPEX record with the same details already exists.", 409);
    }

    return fail("Unable to create CAPEX at this time.", 500);
  } finally {
    if (client) client.release();
  }
};

// ============================================================ Read Query and Mapping Helpers(Get Helpers)
// The lateral query derives the first non-approved stage for each CAPEX.
const CAPEX_SELECT = `
  SELECT
    cm.CapexID,
    cm.OrganizationID,
    om.ShortName AS OrganizationShortName,
    cm.CapexNumber,
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

  FROM Capex_Master cm

  INNER JOIN Organization_Master om
    ON om.OrganizationID = cm.OrganizationID
   AND om.IsActive = TRUE
   AND om.IsDeleted = FALSE
   AND om.ActivationStatus = TRUE

  LEFT JOIN Capex_Approval approval_state
    ON approval_state.CapexID = cm.CapexID
   AND approval_state.IsDeleted = FALSE

  LEFT JOIN LATERAL
  (
    SELECT
      cfg.ApprovalRole,

      CASE UPPER(cfg.ApprovalRole)
        WHEN 'GM'
          THEN COALESCE(approval_state.GMStatus, 'PENDING')

        WHEN 'CEO'
          THEN COALESCE(approval_state.CEOStatus, 'PENDING')

        WHEN 'OWNER'
          THEN COALESCE(approval_state.OwnerStatus, 'PENDING')
      END AS Status,

      cfg.ApprovalLevel,
      cfg.ApprovalOrder

    FROM Capex_Approval_Config cfg

    WHERE cfg.OrganizationID = cm.OrganizationID
      AND cfg.IsDeleted = FALSE

      AND UPPER(
        CASE UPPER(cfg.ApprovalRole)
          WHEN 'GM'
            THEN COALESCE(approval_state.GMStatus, 'PENDING')

          WHEN 'CEO'
            THEN COALESCE(approval_state.CEOStatus, 'PENDING')

          WHEN 'OWNER'
            THEN COALESCE(approval_state.OwnerStatus, 'PENDING')
        END
      ) NOT IN ('APPROVED', 'REJECTED')

    ORDER BY
      cfg.ApprovalOrder ASC,
      cfg.ApprovalLevel ASC

    LIMIT 1

  ) current_stage ON TRUE

  WHERE cm.IsDeleted = FALSE
`;
// Convert PostgreSQL lowercase row keys into the public CAPEX response shape.
const mapMaster = (row) => ({
  CapexID: Number(row.capexid),
  OrganizationID: Number(row.organizationid),
  OrganizationShortName: row.organizationshortname,
  CapexNumber: Number(row.capexnumber),
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
  CapexDocumentID: Number(row.capexdocumentid),
  FileName: row.filename,
  FilePath: row.filepath ? generateDocumentUrl(row.filepath) : null,
});
// Return approval fields without exposing soft-delete/audit internals.
const mapApproval = (row) => ({
  CapexApprovalID: Number(row.capexapprovalid),
  ApprovalRole: row.approvalrole,
  Status: row.status,
  ApprovedQuantity:
    row.approvedquantity === null || row.approvedquantity === undefined
      ? null
      : Number(row.approvedquantity),
  Remarks: row.remarks,
});
// Fetch documents and approvals in batches to avoid N+1 database queries.
const attachRelatedData = async (capexRows) => {
  if (capexRows.length === 0) return [];

  const capexIDs = capexRows.map((row) => Number(row.capexid));
  const [documentsResult, approvalsResult] = await Promise.all([
    pool.query(
      `
      SELECT
        CapexDocumentID,
        CapexID,
        CapexNumber,
        FileName,
        FilePath,
        FileType,
        FileSize
      FROM Capex_Documents
      WHERE CapexID = ANY($1::bigint[])
        AND IsDeleted = FALSE
      ORDER BY CapexID ASC, CapexDocumentID ASC;
    `,
      [capexIDs],
    ),

    pool.query(
      `
      SELECT
        ca.CapexApprovalID,
        ca.CapexID,
        cfg.ApprovalLevel AS LevelNo,
        cfg.ApprovalRole,

        CASE cfg.ApprovalRole
          WHEN 'GM' THEN ca.GMStatus
          WHEN 'CEO' THEN ca.CEOStatus
          WHEN 'OWNER' THEN ca.OwnerStatus
        END AS Status,

        CASE cfg.ApprovalRole
          WHEN 'GM' THEN ca.GMStatusDateTime
          WHEN 'CEO' THEN ca.CEOStatusDateTime
          WHEN 'OWNER' THEN ca.OwnerStatusDateTime
        END AS StatusDateTime,

        CASE cfg.ApprovalRole
          WHEN 'GM' THEN ca.GMStatusApprovedBy
          WHEN 'CEO' THEN ca.CEOStatusApprovedBy
          WHEN 'OWNER' THEN ca.OwnerStatusApprovedBy
        END AS StatusApprovedBy,

        CASE cfg.ApprovalRole
          WHEN 'GM' THEN ca.GMApprovedQuantity
          WHEN 'CEO' THEN ca.CEOApprovedQuantity
          WHEN 'OWNER' THEN ca.OwnerApprovedQuantity
        END AS ApprovedQuantity,

        CASE cfg.ApprovalRole
          WHEN 'GM' THEN ca.GMRemarks
          WHEN 'CEO' THEN ca.CEORemarks
          WHEN 'OWNER' THEN ca.OwnerRemarks
        END AS Remarks

      FROM Capex_Approval ca

      INNER JOIN Capex_Approval_Config cfg
        ON cfg.OrganizationID = (
          SELECT OrganizationID
          FROM Capex_Master
          WHERE CapexID = ca.CapexID
        )

       AND cfg.IsDeleted = FALSE

      WHERE ca.CapexID = ANY($1::bigint[])
        AND ca.IsDeleted = FALSE

      ORDER BY
        ca.CapexID ASC,
        cfg.ApprovalLevel ASC,
        ca.CapexApprovalID ASC;
    `,
      [capexIDs],
    ),
  ]);

  const byID = new Map(
    capexRows.map((row) => {
      const capex = mapMaster(row);
      return [capex.CapexID, capex];
    }),
  );

  for (const row of documentsResult.rows) {
    byID.get(Number(row.capexid))?.Documents.push(mapDocument(row));
  }

  for (const row of approvalsResult.rows) {
    byID.get(Number(row.capexid))?.Approvals.push(mapApproval(row));
  }

  return capexRows.map((row) => byID.get(Number(row.capexid)));
};
// ============================================================ Get All CAPEX
const getAllCapex = async (data) => {
  try {
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

    const approvalStatus =
      data.Status !== undefined &&
      data.Status !== null &&
      String(data.Status).trim() !== ""
        ? String(data.Status).trim().toUpperCase()
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
      ${CAPEX_SELECT}
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
    // Department Filter
    // =====================================================

    if (data.Department) {
      params.push(String(data.Department).trim());

      query += `
        AND LOWER(TRIM(cm.Department)) = LOWER($${params.length})
      `;
    }

    if (data.FromDate) {
      params.push(data.FromDate);
      query += ` AND cm.CreatedDate >= $${params.length}::date `;
    }

    if (data.ToDate) {
      params.push(data.ToDate);
      query += ` AND cm.CreatedDate < ($${params.length}::date + INTERVAL '1 day') `;
    }

    // =====================================================
    // STATUS FILTER
    // =====================================================

    if (["GM", "CEO", "OWNER"].includes(userType)) {
      // A later approver must never see a CAPEX that is paused or sent back
      // at an earlier stage. This gate also applies to the default/all-status
      // list, where approvalStatus is null.
      if (userType === "CEO") {
        query += `
          AND UPPER(COALESCE(approval_state.GMStatus, 'PENDING')) = 'APPROVED'
        `;
      } else if (userType === "OWNER") {
        query += `
          AND UPPER(COALESCE(approval_state.GMStatus, 'PENDING')) = 'APPROVED'
          AND UPPER(COALESCE(approval_state.CEOStatus, 'PENDING')) = 'APPROVED'
        `;
      }

      // ---------------------------------------------------
      // GM
      // ---------------------------------------------------

      if (userType === "GM") {
        if (approvalStatus === "PENDING") {
          params.push("GM");

          query += `
            AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${params.length}
            AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
            AND UPPER(COALESCE(approval_state.FinalStatus, 'PENDING')) = 'PENDING'
          `;
        } else if (approvalStatus) {
          params.push(approvalStatus);

          query += `
            AND UPPER(
              COALESCE(
                approval_state.GMStatus,
                'PENDING'
              )
            ) = $${params.length}
          `;
        }
        
      }

      // ---------------------------------------------------
      // CEO
      // ---------------------------------------------------
      else if (userType === "CEO") {
        if (approvalStatus === "PENDING") {
          params.push("CEO");

          query += `
            AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${params.length}
            AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
            AND UPPER(COALESCE(approval_state.FinalStatus, 'PENDING')) = 'PENDING'
          `;
        } else if (approvalStatus) {
          params.push(approvalStatus);

          query += `
            AND UPPER(
              COALESCE(
                approval_state.CEOStatus,
                'PENDING'
              )
            ) = $${params.length}
          `;
        } 
       
      }

      // ---------------------------------------------------
      // OWNER
      // ---------------------------------------------------
      else if (userType === "OWNER") {
        if (approvalStatus === "PENDING") {
          params.push("OWNER");

          query += `
            AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${params.length}
            AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
            AND UPPER(COALESCE(approval_state.FinalStatus, 'PENDING')) = 'PENDING'
          `;
        } else if (approvalStatus) {
          params.push(approvalStatus);

          query += `
            AND UPPER(
              COALESCE(
                approval_state.OwnerStatus,
                'PENDING'
              )
            ) = $${params.length}
          `;
        } 
       
      }
    }

    // =====================================================
    // HOD
    // =====================================================
    else if (userType === "HOD") {
      if (["REJECTED", "HOLD", "RETURNED"].includes(approvalStatus)) {
        // Match the selected non-pending status at any approval stage.
        params.push(approvalStatus);

        query += `
          AND (
            UPPER(
              COALESCE(
                approval_state.GMStatus,
                ''
              )
            ) = $${params.length}

            OR

            UPPER(
              COALESCE(
                approval_state.CEOStatus,
                ''
              )
            ) = $${params.length}

            OR

            UPPER(
              COALESCE(
                approval_state.OwnerStatus,
                ''
              )
            ) = $${params.length}

            OR

            UPPER(
              COALESCE(
                approval_state.FinalStatus,
                ''
              )
            ) = $${params.length}
          )
        `;
      } else if (approvalStatus === "APPROVED") {
        // FinalStatus already represents completion of the configured flow.
        // Do not require roles (such as OWNER) that may not be configured.
        query += `
          AND UPPER(
            COALESCE(
              approval_state.FinalStatus,
              'PENDING'
            )
          ) = 'APPROVED'
        `;
      } else if (approvalStatus === "PENDING") {
        // Pending excludes terminal and paused/returned approval states.
        query += `
          AND NOT (
            UPPER(
              COALESCE(
                approval_state.GMStatus,
                ''
              )
            ) IN ('REJECTED', 'HOLD', 'RETURNED')

            OR

            UPPER(
              COALESCE(
                approval_state.CEOStatus,
                ''
              )
            ) IN ('REJECTED', 'HOLD', 'RETURNED')

            OR

            UPPER(
              COALESCE(
                approval_state.OwnerStatus,
                ''
              )
            ) IN ('REJECTED', 'HOLD', 'RETURNED')

            OR

            UPPER(
              COALESCE(
                approval_state.FinalStatus,
                ''
              )
            ) IN ('REJECTED', 'HOLD', 'RETURNED', 'APPROVED')
          )

          AND (
            UPPER(
              COALESCE(
                approval_state.GMStatus,
                'PENDING'
              )
            ) <> 'APPROVED'

            OR

            UPPER(
              COALESCE(
                approval_state.CEOStatus,
                'PENDING'
              )
            ) <> 'APPROVED'

            OR

            UPPER(
              COALESCE(
                approval_state.OwnerStatus,
                'PENDING'
              )
            ) <> 'APPROVED'
          )
        `;
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
        cm.CapexID DESC

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
        ${CAPEX_SELECT}
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

    if (data.Department) {
      countParams.push(String(data.Department).trim());

      countQuery += `
        AND LOWER(TRIM(cm.Department)) = LOWER($${countParams.length})
      `;
    }

    if (data.FromDate) {
      countParams.push(data.FromDate);
      countQuery += ` AND cm.CreatedDate >= $${countParams.length}::date `;
    }

    if (data.ToDate) {
      countParams.push(data.ToDate);
      countQuery += ` AND cm.CreatedDate < ($${countParams.length}::date + INTERVAL '1 day') `;
    }

    // =====================================================
    // COUNT STATUS FILTER
    // =====================================================

    if (["GM", "CEO", "OWNER"].includes(userType)) {
      // Keep pagination totals under the same predecessor-stage visibility
      // rules as the main list.
      if (userType === "CEO") {
        countQuery += `
          AND UPPER(COALESCE(approval_state.GMStatus, 'PENDING')) = 'APPROVED'
        `;
      } else if (userType === "OWNER") {
        countQuery += `
          AND UPPER(COALESCE(approval_state.GMStatus, 'PENDING')) = 'APPROVED'
          AND UPPER(COALESCE(approval_state.CEOStatus, 'PENDING')) = 'APPROVED'
        `;
      }

      let statusColumn = null;

      if (userType === "GM") {
        statusColumn = "approval_state.GMStatus";
      } else if (userType === "CEO") {
        statusColumn = "approval_state.CEOStatus";
      } else if (userType === "OWNER") {
        statusColumn = "approval_state.OwnerStatus";
      }

      if (approvalStatus === "PENDING" ) {
        countParams.push(userType);

        countQuery += `
          AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${countParams.length}
          AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
          AND UPPER(COALESCE(approval_state.FinalStatus, 'PENDING')) = 'PENDING'
        `;
      } else if (approvalStatus) {
        countParams.push(approvalStatus);

        countQuery += `
          AND UPPER(
            COALESCE(
              ${statusColumn},
              'PENDING'
            )
          ) = $${countParams.length}
        `;
      }
    }

    // =====================================================
    // HOD COUNT
    // =====================================================
    else if (userType === "HOD") {
      if (approvalStatus === "REJECTED") {
        countQuery += `
          AND (
            UPPER(
              COALESCE(
                approval_state.GMStatus,
                ''
              )
            ) = 'REJECTED'

            OR

            UPPER(
              COALESCE(
                approval_state.CEOStatus,
                ''
              )
            ) = 'REJECTED'

            OR

            UPPER(
              COALESCE(
                approval_state.OwnerStatus,
                ''
              )
            ) = 'REJECTED'
          )
        `;
      } else if (approvalStatus === "APPROVED") {
        countQuery += `
          AND UPPER(
            COALESCE(
              approval_state.FinalStatus,
              'PENDING'
            )
          ) = 'APPROVED'
        `;
      } else if (approvalStatus === "PENDING") {
        countQuery += `
          AND NOT (
            UPPER(
              COALESCE(
                approval_state.GMStatus,
                ''
              )
            ) = 'REJECTED'

            OR

            UPPER(
              COALESCE(
                approval_state.CEOStatus,
                ''
              )
            ) = 'REJECTED'

            OR

            UPPER(
              COALESCE(
                approval_state.OwnerStatus,
                ''
              )
            ) = 'REJECTED'
          )

          AND (
            UPPER(
              COALESCE(
                approval_state.GMStatus,
                'PENDING'
              )
            ) <> 'APPROVED'

            OR

            UPPER(
              COALESCE(
                approval_state.CEOStatus,
                'PENDING'
              )
            ) <> 'APPROVED'

            OR

            UPPER(
              COALESCE(
                approval_state.OwnerStatus,
                'PENDING'
              )
            ) <> 'APPROVED'
          )
        `;
      }
    }

    countQuery += `
      ) filtered_capex
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

    const capex = await attachRelatedData(result.rows);

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
      message: "CAPEX records fetched successfully.",

      TotalCount: totalCount,
      PageCount: capex.length,
      CurrentPage: page,
      PageSize: PageSize,
      TotalPages: totalPages,

      data: capex,
    };
  } catch (error) {
    console.error("Get All CAPEX Error:", error.message);

    return fail("Unable to fetch CAPEX records at this time.", 503);
  }
};
// ============================================================ Get CAPEX By ID
const getCapexById = async (data) => {
  try {
    const result = await pool.query(
      `
      ${CAPEX_SELECT}
      AND cm.CapexID = $1
      LIMIT 1;
      `,
      [data.CapexID],
    );

    if (result.rows.length === 0) {
      return fail("CAPEX record not found.", 404);
    }

    const [capex] = await attachRelatedData(result.rows);

    return {
      success: true,
      message: "CAPEX record fetched successfully.",
      data: capex,
    };
  } catch (error) {
    console.error("Get CAPEX By ID Error:", error.message);
    return fail("Unable to fetch CAPEX record at this time.", 503);
  }
};

// ============================================================ Mutation Helpers (Update ,Delete,Approval Helpers)
// Read the effective approval configuration for one organization.
const getMergedApprovals = async (client, organizationID) => {
  const result = await client.query(
    `
    SELECT 
      CapexApprovalConfigID,
      ApprovalLevel,
      ApprovalRole,
      ApprovalOrder,
      IsMandatory
    FROM Capex_Approval_Config
    WHERE OrganizationID = $1
      AND IsDeleted = FALSE
    ORDER BY 
      ApprovalOrder ASC,
      ApprovalLevel ASC,
      CapexApprovalConfigID ASC;
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
const capexExists = async (client, capexID) => {
  const result = await client.query(
    `SELECT 1 FROM Capex_Master WHERE CapexID = $1 AND IsDeleted = FALSE LIMIT 1;`,
    [capexID],
  );
  return result.rows.length > 0;
};
// ============================================================ Partial Update CAPEX
// const updateCapex = async (data) => {
//   let client;
//   let transactionStarted = false;

//   const documents = Array.isArray(data.Documents) ? data.Documents : [];

//   const deleteDocumentIDs = Array.isArray(data.DeleteDocumentIDs)
//     ? data.DeleteDocumentIDs
//     : [];

//   try {
//     client = await pool.connect();

//     await client.query("BEGIN");
//     transactionStarted = true;

//     // ============================================================
//     // Changes
//     // ============================================================

//     const changes = data.Changes || {};

//     const assignments = [];
//     const values = [];

//     const addValue = (column, value) => {
//       values.push(value);
//       assignments.push(`${column} = $${values.length}`);
//     };

//     // ============================================================
//     // CAPEX Fields
//     // OrganizationID and CapexNumber are NOT updated
//     // ============================================================

//     if (changes.Department !== undefined) {
//       addValue("Department", changes.Department);
//     }

//     if (changes.Item !== undefined) {
//       addValue("Item", changes.Item);
//     }

//     if (changes.Description !== undefined) {
//       addValue("Description", changes.Description);
//     }

//     if (changes.Make !== undefined) {
//       addValue("Make", changes.Make);
//     }

//     if (changes.Qty !== undefined) {
//       addValue("Qty", changes.Qty);
//     }

//     if (changes.Rate !== undefined) {
//       addValue("Rate", changes.Rate);
//     }

//     // ============================================================
//     // Total comes directly from Frontend
//     // ============================================================

//     if (changes.Total !== undefined) {
//       addValue("Total", changes.Total);
//     }

//     if (changes.IsVoid !== undefined) {
//       addValue("IsVoid", changes.IsVoid);
//     }

//     if (changes.VoidRemarks !== undefined) {
//       addValue("VoidRemarks", changes.VoidRemarks);
//     }

//     // ============================================================
//     // Modified Information
//     // ============================================================

//     addValue("ModifiedBy", data.UserID);

//     assignments.push("ModifiedDate = CURRENT_TIMESTAMP");

//     // ============================================================
//     // Update CAPEX
//     // ============================================================

//     values.push(data.CapexID);

//     const capexIDParameter = values.length;

//     const updateResult = await client.query(
//       `
//       UPDATE Capex_Master
//       SET ${assignments.join(", ")}
//       WHERE CapexID = $${capexIDParameter}
//         AND IsDeleted = FALSE
//       RETURNING
//         CapexID,
//         OrganizationID,
//         CapexNumber,
//         Department,
//         Item,
//         Description,
//         Make,
//         Qty,
//         Rate,
//         Total,
//         IsVoid,
//         VoidRemarks,
//         ModifiedBy,
//         ModifiedDate;
//       `,
//       values,
//     );

//     // ============================================================
//     // CAPEX Not Found
//     // ============================================================

//     if (updateResult.rows.length === 0) {
//       await client.query("ROLLBACK");
//       transactionStarted = false;

//       return fail("CAPEX record not found.", 404);
//     }

//     // ============================================================
//     // DOCUMENTS
//     //
//     // If new documents are provided:
//     //   1. Old documents are soft deleted
//     //   2. New documents are inserted
//     //
//     // If no documents are provided:
//     //   Old documents remain unchanged
//     // ============================================================

//     if (documents.length > 0) {
//       // ----------------------------------------------------------
//       // Get existing CAPEX number
//       // ----------------------------------------------------------

//       const capexInfo = updateResult.rows[0];

//       const capexNumber = Number(capexInfo.capexnumber);

//       // ----------------------------------------------------------
//       // Soft delete old documents
//       // ----------------------------------------------------------

//       await client.query(
//         `
//         UPDATE Capex_Documents
//         SET
//           IsDeleted = TRUE,
//           DeletedBy = $1,
//           DeletedDate = CURRENT_TIMESTAMP,
//           ModifiedBy = $1,
//           ModifiedDate = CURRENT_TIMESTAMP
//         WHERE CapexID = $2
//           AND IsDeleted = FALSE;
//         `,
//         [data.UserID, data.CapexID],
//       );

//       // ----------------------------------------------------------
//       // Generate IDs for new documents
//       // ----------------------------------------------------------

//       const newDocumentIDs = await reserveNumericIDs(
//         client,
//         "Capex_Documents",
//         "CapexDocumentID",
//         documents.length,
//       );

//       // ----------------------------------------------------------
//       // Insert new documents
//       // ----------------------------------------------------------

//       for (const [index, document] of documents.entries()) {
//         await client.query(
//           `
//           INSERT INTO Capex_Documents
//           (
//             CapexDocumentID,
//             CapexID,
//             CapexNumber,
//             FileName,
//             FilePath,
//             FileType,
//             FileSize,
//             IsDeleted,
//             CreatedBy,
//             CreatedDate
//           )
//           VALUES
//           (
//             $1,
//             $2,
//             $3,
//             $4,
//             $5,
//             $6,
//             $7,
//             FALSE,
//             $8,
//             CURRENT_TIMESTAMP
//           );
//           `,
//           [
//             newDocumentIDs[index],
//             data.CapexID,
//             capexNumber,
//             document.FileName,
//             document.FilePath,
//             document.FileType,
//             document.FileSize,
//             data.UserID,
//           ],
//         );
//       }
//     }

//     // ============================================================
//     // Specific old documents delete
//     //
//     // Only execute when DeleteDocumentIDs are provided
//     // ============================================================

//     if (deleteDocumentIDs.length > 0) {
//       const ownedDocuments = await client.query(
//         `
//         SELECT CapexDocumentID
//         FROM Capex_Documents
//         WHERE CapexID = $1
//           AND CapexDocumentID = ANY($2::bigint[])
//           AND IsDeleted = FALSE;
//         `,
//         [data.CapexID, deleteDocumentIDs],
//       );

//       if (ownedDocuments.rows.length !== deleteDocumentIDs.length) {
//         await client.query("ROLLBACK");
//         transactionStarted = false;

//         return fail("One or more selected CAPEX documents are invalid.", 400);
//       }

//       await client.query(
//         `
//         UPDATE Capex_Documents
//         SET
//           IsDeleted = TRUE,
//           DeletedBy = $1,
//           DeletedDate = CURRENT_TIMESTAMP,
//           ModifiedBy = $1,
//           ModifiedDate = CURRENT_TIMESTAMP
//         WHERE CapexID = $2
//           AND CapexDocumentID = ANY($3::bigint[])
//           AND IsDeleted = FALSE;
//         `,
//         [data.UserID, data.CapexID, deleteDocumentIDs],
//       );
//     }

//     // ============================================================
//     // COMMIT
//     // ============================================================

//     await client.query("COMMIT");
//     transactionStarted = false;

//     const updated = updateResult.rows[0];

//     return {
//       success: true,
//       message: "CAPEX updated successfully.",

//       // data: {
//       //   CapexID: Number(updated.capexid),
//       //   OrganizationID: Number(updated.organizationid),
//       //   CapexNumber: Number(updated.capexnumber),
//       //   Department: updated.department,
//       //   Item: updated.item,
//       //   Description: updated.description,
//       //   Make: updated.make,
//       //   Qty: Number(updated.qty),
//       //   Rate: Number(updated.rate),
//       //   Total: Number(updated.total),
//       //   IsVoid: updated.isvoid,
//       //   VoidRemarks: updated.voidremarks,
//       //   DocumentsUpdated: documents.length,
//       //   DocumentsDeleted: deleteDocumentIDs.length,
//       // },
//     };
//   } catch (error) {
//     if (client && transactionStarted) {
//       await client.query("ROLLBACK");
//     }

//     console.error("Update CAPEX Error:", error.message);

//     const retryResponse = retryableDatabaseResponse(error);

//     if (retryResponse) {
//       return retryResponse;
//     }

//     if (error.code === "23503") {
//       return fail("Invalid CAPEX related data.", 400);
//     }

//     if (error.code === "23505") {
//       return fail("CAPEX organization number already exists.", 409);
//     }

//     return fail("Unable to update CAPEX at this time.", 500);
//   } finally {
//     if (client) {
//       client.release();
//     }
//   }
// };
const updateCapex = async (data) => {
  let client;
  let transactionStarted = false;

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
    // CAPEX Fields
    // OrganizationID and CapexNumber are not updated
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
    // Update CAPEX
    // ============================================================

    values.push(data.CapexID);
    const capexIDParameter = values.length;

    const updateResult = await client.query(
      `
      UPDATE Capex_Master
      SET ${assignments.join(", ")}
      WHERE CapexID = $${capexIDParameter}
        AND IsDeleted = FALSE
      RETURNING
        CapexID,
        OrganizationID,
        CapexNumber,
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
    // CAPEX Not Found
    // ============================================================

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return fail("CAPEX record not found.", 404);
    }

    // ============================================================
    // DOCUMENT UPDATE RULES
    //
    // Documents === undefined:
    //   Documents unchanged
    //
    // Documents === null:
    //   All existing documents soft deleted
    //
    // Documents === []:
    //   All existing documents soft deleted
    //
    // Existing document containing CapexDocumentID:
    //   Remains unchanged and is not inserted again
    //
    // New document without CapexDocumentID:
    //   Inserted as a new document
    //
    // Existing document missing from received Documents array:
    //   Soft deleted
    // ============================================================

    if (data.Documents !== undefined) {
      if (data.Documents !== null && !Array.isArray(data.Documents)) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return fail("Documents must be an array or null.", 400);
      }

      const incomingDocuments = Array.isArray(data.Documents)
        ? data.Documents
        : [];

      const capexInfo = updateResult.rows[0];
      const capexNumber = Number(capexInfo.capexnumber);

      // ==========================================================
      // Get Current Active Documents
      // ==========================================================

      const existingDocumentsResult = await client.query(
        `
        SELECT
          CapexDocumentID,
          FileName,
          FilePath,
          FileType,
          FileSize
        FROM Capex_Documents
        WHERE CapexID = $1
          AND IsDeleted = FALSE
        FOR UPDATE;
        `,
        [data.CapexID],
      );

      const existingDocuments = existingDocumentsResult.rows;

      const existingDocumentIDs = new Set(
        existingDocuments.map((document) => String(document.capexdocumentid)),
      );

      // ==========================================================
      // Separate Existing and New Documents
      // ==========================================================

      const receivedExistingDocuments = [];
      const newDocuments = [];

      for (const document of incomingDocuments) {
        if (!document || typeof document !== "object") {
          await client.query("ROLLBACK");
          transactionStarted = false;

          return fail("Invalid CAPEX document data.", 400);
        }

        const hasDocumentID =
          document.CapexDocumentID !== undefined &&
          document.CapexDocumentID !== null &&
          String(document.CapexDocumentID).trim() !== "";

        if (hasDocumentID) {
          receivedExistingDocuments.push(document);
        } else {
          newDocuments.push(document);
        }
      }

      // ==========================================================
      // Validate Existing Document IDs
      // ==========================================================

      const receivedExistingDocumentIDs = [
        ...new Set(
          receivedExistingDocuments.map((document) =>
            String(document.CapexDocumentID),
          ),
        ),
      ];

      const invalidDocumentID = receivedExistingDocumentIDs.find(
        (documentID) => !existingDocumentIDs.has(documentID),
      );

      if (invalidDocumentID) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return fail("One or more existing CAPEX documents are invalid.", 400);
      }

      // ==========================================================
      // Soft Delete Missing Existing Documents
      //
      // Documents null or []:
      // receivedExistingDocumentIDs will be empty, therefore every
      // existing document will be soft deleted.
      // ==========================================================

      const receivedDocumentIDSet = new Set(receivedExistingDocumentIDs);

      const documentIDsToDelete = existingDocuments
        .filter(
          (document) =>
            !receivedDocumentIDSet.has(String(document.capexdocumentid)),
        )
        .map((document) => document.capexdocumentid);

      if (documentIDsToDelete.length > 0) {
        await client.query(
          `
          UPDATE Capex_Documents
          SET
            IsDeleted = TRUE,
            DeletedBy = $1,
            DeletedDate = CURRENT_TIMESTAMP,
            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP
          WHERE CapexID = $2
            AND CapexDocumentID = ANY($3::bigint[])
            AND IsDeleted = FALSE;
          `,
          [data.UserID, data.CapexID, documentIDsToDelete],
        );
      }

      // ==========================================================
      // Create Set of FilePaths That Will Remain Active
      // Used to prevent duplicate documents
      // ==========================================================

      const activeFilePaths = new Set(
        existingDocuments
          .filter((document) =>
            receivedDocumentIDSet.has(String(document.capexdocumentid)),
          )
          .map((document) => document.filepath)
          .filter(Boolean),
      );

      // ==========================================================
      // Validate and Remove Duplicate New Documents
      // ==========================================================

      const uniqueNewDocuments = [];

      for (const document of newDocuments) {
        if (
          document.FileName === undefined ||
          document.FileName === null ||
          String(document.FileName).trim() === ""
        ) {
          await client.query("ROLLBACK");
          transactionStarted = false;

          return fail("FileName is required for new CAPEX documents.", 400);
        }

        if (
          document.FilePath === undefined ||
          document.FilePath === null ||
          String(document.FilePath).trim() === ""
        ) {
          await client.query("ROLLBACK");
          transactionStarted = false;

          return fail("FilePath is required for new CAPEX documents.", 400);
        }

        const filePath = String(document.FilePath).trim();

        // Existing or incoming duplicate FilePath is not inserted again
        if (activeFilePaths.has(filePath)) {
          continue;
        }

        activeFilePaths.add(filePath);
        uniqueNewDocuments.push({
          ...document,
          FileName: String(document.FileName).trim(),
          FilePath: filePath,
        });
      }

      // ==========================================================
      // Insert Only New Unique Documents
      // ==========================================================

      if (uniqueNewDocuments.length > 0) {
        const newDocumentIDs = await reserveNumericIDs(
          client,
          "Capex_Documents",
          "CapexDocumentID",
          uniqueNewDocuments.length,
        );

        for (let index = 0; index < uniqueNewDocuments.length; index += 1) {
          const document = uniqueNewDocuments[index];

          await client.query(
            `
            INSERT INTO Capex_Documents
            (
              CapexDocumentID,
              CapexID,
              CapexNumber,
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
              data.CapexID,
              capexNumber,
              document.FileName,
              document.FilePath,
              document.FileType || null,
              document.FileSize ?? null,
              data.UserID,
            ],
          );
        }
      }
    }

    // ============================================================
    // COMMIT
    // ============================================================

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "CAPEX updated successfully.",
    };
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
      transactionStarted = false;
    }

    console.error("Update CAPEX Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    if (error.code === "23503") {
      return fail("Invalid CAPEX related data.", 400);
    }

    if (error.code === "23505") {
      return fail("CAPEX organization number or document already exists.", 409);
    }

    if (error.code === "22P02") {
      return fail("Invalid CAPEX or document ID.", 400);
    }

    return fail("Unable to update CAPEX at this time.", 500);
  } finally {
    if (client) {
      client.release();
    }
  }
};
// ============================================================ Soft Delete CAPEX
const deleteCapex = async (data) => {
  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ============================================================
    // SOFT DELETE CAPEX
    // ============================================================

    const capexResult = await client.query(
      `
      UPDATE Capex_Master
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CapexID = $2
        AND IsDeleted = FALSE
      RETURNING CapexID;
      `,
      [data.UserID, data.CapexID],
    );

    // ============================================================
    // CAPEX NOT FOUND / ALREADY DELETED
    // ============================================================

    if (capexResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return fail("Capex record not found or already deleted.", 404);
    }

    // ============================================================
    // SOFT DELETE DOCUMENTS
    // ============================================================

    await client.query(
      `
      UPDATE Capex_Documents
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CapexID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, data.CapexID],
    );

    // ============================================================
    // SOFT DELETE APPROVALS
    // ============================================================

    await client.query(
      `
      UPDATE Capex_Approval
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CapexID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, data.CapexID],
    );

    // ============================================================
    // COMMIT
    // ============================================================

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "Capex deleted successfully.",
    };
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error("Delete CAPEX Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return fail("Unable to delete CAPEX at this time.", 500);
  } finally {
    if (client) {
      client.release();
    }
  }
};
// ============================================================ Approval Workflow
const processCapexApproval = async (data) => {
  let client;
  let transactionStarted = false;

  console.log("PROCESS CAPEX APPROVAL DATA:", JSON.stringify(data));

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
    const approvedQuantity =
      data.Quantity === undefined || data.Quantity === null
        ? null
        : Number(data.Quantity);

    // ============================================================
    // 2. VALIDATE ACTION
    // ============================================================

    if (!["APPROVE", "REJECT", "RETURN", "HOLD"].includes(action)) {
      return fail("Invalid CAPEX approval action.", 400);
    }

    // ============================================================
    // 3. REMARKS REQUIRED
    // ============================================================

    if (["REJECT", "RETURN", "HOLD"].includes(action) && !remarks) {
      return fail(`Remarks are required when the action is ${action}.`, 400);
    }

    if (
      approvedQuantity !== null &&
      (!Number.isFinite(approvedQuantity) || approvedQuantity <= 0)
    ) {
      return fail("Quantity must be a number greater than zero.", 400);
    }

    // ============================================================
    // 4. VALIDATE ROLE
    // ============================================================

    if (!APPROVAL_ROLES.has(approverRole)) {
      return fail("Your role is not authorized for CAPEX approval.", 403);
    }

    // ============================================================
    // 5. DB CONNECTION
    // ============================================================

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ============================================================
    // 6. GET CAPEX MASTER
    // ============================================================

    const masterResult = await client.query(
      `
      SELECT
        cm.CapexID,
        cm.CapexNumber,
        cm.OrganizationID,
        cm.IsVoid,
        cm.ModifiedDate
      FROM Capex_Master cm
      WHERE cm.CapexID = $1
        AND cm.IsDeleted = FALSE
      LIMIT 1
      FOR UPDATE OF cm;
      `,
      [data.CapexID],
    );

    // ============================================================
    // 7. CAPEX NOT FOUND
    // ============================================================

    if (masterResult.rows.length === 0) {
      const exists = await capexExists(client, data.CapexID);

      await rollback(client, transactionStarted);

      transactionStarted = false;

      return exists
        ? fail("CAPEX record is not available for approval.", 400)
        : fail("CAPEX record not found.", 404);
    }

    const capex = masterResult.rows[0];

    if (capex.isvoid === true) {
      await rollback(client, transactionStarted);
      transactionStarted = false;
      return fail("Void CAPEX cannot be processed for approval.", 400);
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
      capex.organizationid,
    );

    if (!configuredStages || configuredStages.length === 0) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail("CAPEX approval configuration not found.", 400);
    }

    if (!approvalConfigurationIsValid(configuredStages)) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail(
        "CAPEX approval configuration contains an invalid approval role.",
        400,
      );
    }

    // ============================================================
    // 9. GET CAPEX APPROVAL
    // ============================================================

    const approvalResult = await client.query(
      `
      SELECT
        CapexApprovalID,

       GMStatus,
       GMApprovedQuantity,
       GMStatusDateTime,
       GMStatusApprovedBy,
       GMRemarks,

       CEOStatus,
       CEOApprovedQuantity,
       CEOStatusDateTime,
       CEOStatusApprovedBy,
       CEORemarks,

       OwnerStatus,
       OwnerApprovedQuantity,
       OwnerStatusDateTime,
       OwnerStatusApprovedBy,
       OwnerRemarks,

        FinalStatus,
        FinalStatusDateTime

      FROM Capex_Approval

      WHERE CapexID = $1
        AND IsDeleted = FALSE

      LIMIT 1

      FOR UPDATE;
      `,
      [data.CapexID],
    );

    // ============================================================
    // 10. APPROVAL ROW NOT FOUND
    // ============================================================

    if (approvalResult.rows.length === 0) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail("CAPEX approval record not found.", 404);
    }

    const approval = approvalResult.rows[0];

    // ============================================================
    // 11. ROLE DATA HELPER
    // ============================================================

    const getRoleData = (role) => {
      switch (String(role).trim().toUpperCase()) {
        case "GM":
          return {
            status: approval.gmstatus,
            approvedQuantity: approval.gmapprovedquantity,
            statusDateTime: approval.gmstatusdatetime,
            approvedBy: approval.gmstatusapprovedby,
            remarks: approval.gmremarks,
          };

        case "CEO":
          return {
            status: approval.ceostatus,
            approvedQuantity: approval.ceoapprovedquantity,
            statusDateTime: approval.ceostatusdatetime,
            approvedBy: approval.ceostatusapprovedby,
            remarks: approval.ceoremarks,
          };

        case "OWNER":
          return {
            status: approval.ownerstatus,
            approvedQuantity: approval.ownerapprovedquantity,
            statusDateTime: approval.ownerstatusdatetime,
            approvedBy: approval.ownerstatusapprovedby,
            remarks: approval.ownerremarks,
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

    // console.log("CAPEX APPROVAL STAGES:", JSON.stringify(stages));

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

      return fail("This CAPEX record is already finally approved.", 400);
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

      return fail(`You cannot perform ${action} action at this stage.`, 403);
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
        approvedQuantity !== undefined && approvedQuantity !== null
          ? Number(approvedQuantity)
          : null,
        approval.capexapprovalid,
      ];

      switch (role) {
        case "GM":
          query = `
        UPDATE Capex_Approval
        SET
          GMStatus = $1,
          GMStatusDateTime = CURRENT_TIMESTAMP,
          GMStatusApprovedBy = $2,
          GMRemarks = $3,
          GMApprovedQuantity = $4,
          ModifiedBy = $2,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE CapexApprovalID = $5
          AND IsDeleted = FALSE;
      `;
          break;

        case "CEO":
          query = `
        UPDATE Capex_Approval
        SET
          CEOStatus = $1,
          CEOStatusDateTime = CURRENT_TIMESTAMP,
          CEOStatusApprovedBy = $2,
          CEORemarks = $3,
          CEOApprovedQuantity = $4,
          ModifiedBy = $2,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE CapexApprovalID = $5
          AND IsDeleted = FALSE;
      `;
          break;

        case "OWNER":
          query = `
        UPDATE Capex_Approval
        SET
          OwnerStatus = $1,
          OwnerStatusDateTime = CURRENT_TIMESTAMP,
          OwnerStatusApprovedBy = $2,
          OwnerRemarks = $3,
          OwnerApprovedQuantity = $4,
          ModifiedBy = $2,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE CapexApprovalID = $5
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
          `Only the current ${currentRole} approval stage can approve this CAPEX.`,
          403,
        );
      }

      // ----------------------------------------------------------
      // Update current role
      // ----------------------------------------------------------

      await updateRoleApproval(
        approverRole,
        "Approved",
        data.UserID,
        remarks,
        approvedQuantity,
      );

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
          UPDATE Capex_Approval
          SET
            FinalStatus = NULL,
            FinalStatusDateTime = NULL,
            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP
          WHERE CapexApprovalID = $2
            AND IsDeleted = FALSE;
          `,
          [data.UserID, approval.capexapprovalid],
        );

        await client.query("COMMIT");

        transactionStarted = false;

        return {
          success: true,

          message: "CAPEX approved successfully.",

          // data: {
          //   CapexID: Number(capex.capexid),

          //   CapexNumber: Number(capex.capexnumber),

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
        UPDATE Capex_Approval
        SET
          FinalStatus = 'Approved',
          FinalStatusDateTime = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE CapexApprovalID = $2
          AND IsDeleted = FALSE;
        `,
        [data.UserID, approval.capexapprovalid],
      );

      await client.query("COMMIT");

      transactionStarted = false;

      return {
        success: true,

        message: "CAPEX finally approved successfully.",

        // data: {
        //   CapexID: Number(capex.capexid),

        //   CapexNumber: Number(capex.capexnumber),

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
      await updateRoleApproval(
        approverRole,
        "Rejected",
        data.UserID,
        remarks,
        approvedQuantity,
      );

      await client.query(
        `
        UPDATE Capex_Approval
        SET
          FinalStatus = 'Rejected',
          FinalStatusDateTime = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE CapexApprovalID = $2
          AND IsDeleted = FALSE;
        `,
        [data.UserID, approval.capexapprovalid],
      );

      await client.query("COMMIT");

      transactionStarted = false;

      return {
        success: true,

        message: "CAPEX rejected successfully.",

        // data: {
        //   CapexID: Number(capex.capexid),

        //   CapexNumber: Number(capex.capexnumber),

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

      await updateRoleApproval(
        approverRole,
        "Returned",
        data.UserID,
        remarks,
        approvedQuantity,
      );

      await client.query(
        `
        UPDATE Capex_Approval
        SET
          FinalStatus = 'Returned',
          FinalStatusDateTime = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE CapexApprovalID = $2
          AND IsDeleted = FALSE;
        `,
        [data.UserID, approval.capexapprovalid],
      );

      await client.query("COMMIT");

      transactionStarted = false;

      return {
        success: true,

        message: "CAPEX returned successfully.",

        // data: {
        //   CapexID: Number(capex.capexid),

        //   CapexNumber: Number(capex.capexnumber),

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
          `Only the current ${currentRole} approval stage can hold this CAPEX.`,
          403,
        );
      }

      await updateRoleApproval(
        approverRole,
        "Hold",
        data.UserID,
        remarks,
        approvedQuantity,
      );

      await client.query(
        `
        UPDATE Capex_Approval
        SET
          FinalStatus = 'Hold',
          FinalStatusDateTime = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE CapexApprovalID = $2
          AND IsDeleted = FALSE;
        `,
        [data.UserID, approval.capexapprovalid],
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return {
        success: true,
        message: "CAPEX put on hold successfully.",
      };
    }

    // ============================================================
    // 23. FALLBACK
    // ============================================================

    await rollback(client, transactionStarted);

    transactionStarted = false;

    return fail("Unable to process CAPEX approval.", 400);
  } catch (error) {
    await rollback(client, transactionStarted);

    console.error("CAPEX Approval Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return fail("Unable to process CAPEX approval at this time.", 500);
  } finally {
    if (client) {
      client.release();
    }
  }
};

// ============================================================ Report SQL (Summary and other reports Helpers)
// PostgreSQL derives effective status and aggregates authorized CAPEX records.
const REPORT_DATA_CTE = `
  WITH capex_data AS
  (
    SELECT
      cm.CapexID,
      cm.OrganizationID,
      cm.Department,
      cm.CreatedDate,
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
          UPPER(COALESCE(ca.GMStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.CEOStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.OwnerStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.FinalStatus, '')) = 'REJECTED'
        THEN 'Rejected'

        -- ====================================================
        -- 3. RETURNED
        -- ====================================================
        WHEN
          UPPER(COALESCE(ca.GMStatus, '')) = 'RETURNED'
          OR UPPER(COALESCE(ca.CEOStatus, '')) = 'RETURNED'
          OR UPPER(COALESCE(ca.OwnerStatus, '')) = 'RETURNED'
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

    FROM Capex_Master cm

    LEFT JOIN Capex_Approval ca
      ON ca.CapexID = cm.CapexID
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

const departmentReportParameters = (data) => {
  const filters = data.Filters || {};

  return [
    filters.OrganizationID ?? null,
    filters.Department || null,
    filters.FromDate || null,
    filters.ToDate || null,
  ];
};

const organizationReportParameters = (data) => {
  const filters = data.Filters || {};

  return [
    filters.OrganizationID ?? null,
    filters.FromDate || null,
    filters.ToDate || null,
  ];
};
// Read/report failures return synchronously; they are not background-retried.
const reportFailure = (error, reportName) => {
  console.error(`${reportName} Error:`, error.message);

  return fail(`Unable to generate ${reportName} at this time.`, 503);
};
// Keep both role-scoped and organization-wide summaries on the same API shape.
const capexSummaryData = (row) => ({
  TotalCapex: Number(row.totalcapex),
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
const getCapexSummaryReport = async (data) => {
  try {
    const OrganizationID = Number(data?.Filters?.OrganizationID);
    const UserType = String(data.UserType || "")
      .trim()
      .toUpperCase();

    if (!Number.isSafeInteger(OrganizationID) || OrganizationID < 1) {
      return fail("OrganizationID is required.", 400);
    }

    if (!APPROVAL_ROLES.has(UserType)) {
      const result = await pool.query(
        `
        WITH organization_capex AS
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
          FROM Capex_Master cm
          LEFT JOIN Capex_Approval ca
            ON ca.CapexID = cm.CapexID
           AND ca.IsDeleted = FALSE
          WHERE cm.OrganizationID = $1
            AND cm.IsDeleted = FALSE
        )
        SELECT
          COUNT(*)::bigint AS TotalCapex,
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
        FROM organization_capex;
        `,
        [OrganizationID],
      );

      return {
        success: true,
        message: "CAPEX summary report fetched successfully.",
        data: capexSummaryData(result.rows[0]),
      };
    }

    const result = await pool.query(
      `
      WITH role_capex AS
      (
        SELECT
          cm.CapexID,
          COALESCE(cm.Total, 0)::numeric AS Total,
          cm.IsVoid,
          UPPER(COALESCE(ca.FinalStatus, 'PENDING')) AS FinalStatus,

          UPPER(COALESCE(
            CASE $2::text
              WHEN 'GM' THEN ca.GMStatus
              WHEN 'CEO' THEN ca.CEOStatus
              WHEN 'OWNER' THEN ca.OwnerStatus
            END,
            'PENDING'
          )) AS RoleStatus,

          UPPER(COALESCE(current_stage.ApprovalRole, '')) AS CurrentApprovalRole,
          UPPER(COALESCE(current_stage.Status, 'PENDING')) AS CurrentStageStatus

        FROM Capex_Master cm

        LEFT JOIN Capex_Approval ca
          ON ca.CapexID = cm.CapexID
         AND ca.IsDeleted = FALSE

        LEFT JOIN LATERAL
        (
          SELECT
            cfg.ApprovalRole,
            CASE UPPER(cfg.ApprovalRole)
              WHEN 'GM' THEN COALESCE(ca.GMStatus, 'Pending')
              WHEN 'CEO' THEN COALESCE(ca.CEOStatus, 'Pending')
              WHEN 'OWNER' THEN COALESCE(ca.OwnerStatus, 'Pending')
            END AS Status,
            cfg.ApprovalLevel,
            cfg.ApprovalOrder
          FROM
          (
            SELECT
              configured.ApprovalLevel,
              configured.ApprovalRole,
              configured.ApprovalOrder
            FROM Capex_Approval_Config configured
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
                (1, 'GM', 1),
                (2, 'CEO', 2),
                (3, 'OWNER', 3)
            ) defaults(ApprovalLevel, ApprovalRole, ApprovalOrder)
            WHERE NOT EXISTS
            (
              SELECT 1
              FROM Capex_Approval_Config configured
              WHERE configured.OrganizationID = cm.OrganizationID
                AND configured.IsDeleted = FALSE
            )
          ) cfg
          WHERE UPPER(
            CASE UPPER(cfg.ApprovalRole)
              WHEN 'GM' THEN COALESCE(ca.GMStatus, 'Pending')
              WHEN 'CEO' THEN COALESCE(ca.CEOStatus, 'Pending')
              WHEN 'OWNER' THEN COALESCE(ca.OwnerStatus, 'Pending')
            END
          ) NOT IN ('APPROVED', 'REJECTED')
          ORDER BY cfg.ApprovalOrder ASC, cfg.ApprovalLevel ASC
          LIMIT 1
        ) current_stage ON TRUE

        WHERE cm.OrganizationID = $1
          AND cm.IsDeleted = FALSE
      ),

      visible_capex AS
      (
        SELECT
          CapexID,
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
        FROM role_capex
        WHERE RoleStatus IN ('APPROVED', 'REJECTED', 'HOLD', 'RETURNED')
           OR (
             RoleStatus = 'PENDING'
             AND CurrentApprovalRole = $2
             AND CurrentStageStatus = 'PENDING'
             AND FinalStatus = 'PENDING'
           )
      )

      SELECT
        COUNT(*)::bigint AS TotalCapex,
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
      FROM visible_capex
      WHERE Status IS NOT NULL;
      `,
      [OrganizationID, UserType],
    );

    const row = result.rows[0];

    return {
      success: true,

      message: "CAPEX summary report fetched successfully.",

      data: capexSummaryData(row),
    };
  } catch (error) {
    return reportFailure(error, "CAPEX summary report");
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
const getCapexDepartmentReport = async (data) => {
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
       FROM capex_data
       WHERE ($2::text IS NULL OR LOWER(TRIM(COALESCE(Department, 'Unspecified'))) = LOWER(TRIM($2::text)))
         AND ($3::date IS NULL OR CreatedDate >= $3::date)
         AND ($4::date IS NULL OR CreatedDate < ($4::date + INTERVAL '1 day'))
       GROUP BY COALESCE(Department, 'Unspecified')
       ORDER BY COALESCE(Department, 'Unspecified') ASC;`,
      departmentReportParameters(data),
    );

    return {
      success: true,
      message: "CAPEX department report fetched successfully.",
      data: groupedReportRows(result.rows, "Department"),
    };
  } catch (error) {
    return reportFailure(error, "CAPEX department report");
  }
};
// ============================================================ Organization Report
const getCapexOrganizationReport = async (data) => {
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

       FROM capex_data cm

       LEFT JOIN Organization_Master om
         ON om.OrganizationID = cm.OrganizationID
         AND om.IsDeleted = FALSE

       WHERE ($2::date IS NULL OR cm.CreatedDate >= $2::date)
         AND ($3::date IS NULL OR cm.CreatedDate < ($3::date + INTERVAL '1 day'))

       GROUP BY
         cm.OrganizationID,
         om.ShortName

       ORDER BY
         cm.OrganizationID ASC;`,
      organizationReportParameters(data),
    );

    return {
      success: true,
      message: "CAPEX organization report fetched successfully.",
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
    return reportFailure(error, "CAPEX organization report");
  }
};

// ============================================================ Get Approval Config
const getApprovalConfig = async (data) => {
  try {
    const { OrganizationID } = data;

    let query = `
      SELECT
        CapexApprovalConfigID,
        OrganizationID,
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
        IsMandatory,
        CreatedBy,
        CreatedDate,
        ModifiedBy,
        ModifiedDate
      FROM Capex_Approval_Config
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
        CapexApprovalConfigID ASC;
    `;

    const result = await pool.query(query, params);

    return {
      success: true,
      message: "CAPEX approval configuration fetched successfully.",
      data: result.rows.map((row) => ({
        CapexApprovalConfigID: Number(row.capexapprovalconfigid),
        OrganizationID: Number(row.organizationid),
        ApprovalLevel: Number(row.approvallevel),
        ApprovalRole: row.approvalrole,
        ApprovalOrder: Number(row.approvalorder),
        IsMandatory: row.ismandatory,

        CreatedDate: formatDate(row.createddate),
      })),
    };
  } catch (error) {
    console.error("Get CAPEX Approval Config Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return fail(
      "Unable to fetch CAPEX approval configuration at this time.",
      500,
    );
  }
};
// ============================================================Create Approval Config
const createApprovalConfig = async (data) => {
  let client;
  let transactionStarted = false;

  try {
    console.log("SAVE CAPEX DATA =>", JSON.stringify(data, null, 2));

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
        return fail("ApprovalRole must be GM, CEO, or OWNER.", 400);
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
        CapexApprovalConfigID AS "CapexApprovalConfigID",
        OrganizationID AS "OrganizationID",
        ApprovalLevel AS "ApprovalLevel",
        ApprovalRole AS "ApprovalRole",
        ApprovalOrder AS "ApprovalOrder",
        IsMandatory AS "IsMandatory",
        IsDeleted AS "IsDeleted"
      FROM Capex_Approval_Config
      WHERE OrganizationID = $1
      ORDER BY ApprovalLevel ASC, CapexApprovalConfigID ASC
      FOR UPDATE;
      `,
      [OrganizationID],
    );

    const existingConfigs = existingResult.rows;

    console.log(
      "EXISTING CAPEX CONFIGS =>",
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
        const ConfigID = Number(existing.CapexApprovalConfigID);

        if (!Number.isInteger(ConfigID)) {
          throw new Error(
            `Invalid CapexApprovalConfigID: ${existing.CapexApprovalConfigID}`,
          );
        }

        // --------------------------------------------------------
        // RESTORE SOFT DELETED RECORD
        // --------------------------------------------------------

        if (existing.IsDeleted === true) {
          await client.query(
            `
            UPDATE Capex_Approval_Config
            SET
              ApprovalRole = $1,
              ApprovalOrder = $2,
              IsMandatory = $3,
              IsDeleted = FALSE,
              ModifiedBy = $4,
              ModifiedDate = CURRENT_TIMESTAMP
            WHERE CapexApprovalConfigID = $5
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
            UPDATE Capex_Approval_Config
            SET
              ApprovalRole = $1,
              ApprovalOrder = $2,
              IsMandatory = $3,
              ModifiedBy = $4,
              ModifiedDate = CURRENT_TIMESTAMP
            WHERE CapexApprovalConfigID = $5
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
        const result = await client.query(
          `
          INSERT INTO Capex_Approval_Config
          (
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
            FALSE,
            $6,
            CURRENT_TIMESTAMP
          )
          RETURNING CapexApprovalConfigID;
          `,
          [
            OrganizationID,
            ApprovalLevel,
            ApprovalRole,
            ApprovalOrder,
            IsMandatory,
            data.UserID,
          ],
        );

        const ConfigID = Number(result.rows[0].CapexApprovalConfigID);

        inserted.push(ConfigID);
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
        const ConfigID = Number(existing.CapexApprovalConfigID);

        if (!Number.isInteger(ConfigID)) {
          throw new Error(
            `Invalid CapexApprovalConfigID: ${existing.CapexApprovalConfigID}`,
          );
        }

        await client.query(
          `
          UPDATE Capex_Approval_Config
          SET
            IsDeleted = TRUE,
            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP
          WHERE CapexApprovalConfigID = $2
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
      message: "CAPEX approval configuration saved successfully.",
    };
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error("Save CAPEX Approval Config Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) return retryResponse;

    if (error.code === "23505") {
      return fail("CAPEX approval configuration already exists.", 409);
    }

    if (error.code === "23503") {
      return fail("Invalid organization or user.", 400);
    }

    return fail(
      "Unable to save CAPEX approval configuration at this time.",
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
    const ConfigID = Number(data.CapexApprovalConfigID);

    if (!ConfigID) {
      return fail("CapexApprovalConfigID is required.", 400);
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const result = await client.query(
      `
      UPDATE Capex_Approval_Config
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CapexApprovalConfigID = $2
        AND IsDeleted = FALSE
      RETURNING
        CapexApprovalConfigID,
        OrganizationID;
      `,
      [data.UserID, ConfigID],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return fail("CAPEX approval configuration not found.", 404);
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "CAPEX approval configuration deleted successfully.",
    };
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error("Delete CAPEX Approval Config Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return fail(
      "Unable to delete CAPEX approval configuration at this time.",
      500,
    );
  } finally {
    if (client) client.release();
  }
};
// ===================================================================Pdf Apis
// ============================================================Generate CAPEX List PDF
const generateCapexListPdfDocument = async (data) => {
  try {
    const userType = data.UserType ? String(data.UserType).toUpperCase() : null;

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
        statusCode: 400,
      };
    }

    // ============================================================
    // PDF QUERY
    // Same CAPEX_SELECT + same filters as getAllCapex
    // NO LIMIT / OFFSET
    // ============================================================

    let query = `
      ${CAPEX_SELECT}
    `;

    const params = [];

    // ============================================================
    // ORGANIZATION FILTER
    // ============================================================

    if (data.OrganizationID !== null && data.OrganizationID !== undefined) {
      params.push(data.OrganizationID);

      query += `
        AND cm.OrganizationID = $${params.length}
      `;
    }

    if (data.Department) {
      params.push(String(data.Department).trim());
      query += `
        AND LOWER(TRIM(cm.Department)) = LOWER($${params.length})
      `;
    }

    if (data.FromDate) {
      params.push(data.FromDate);
      query += ` AND cm.CreatedDate >= $${params.length}::date `;
    }

    if (data.ToDate) {
      params.push(data.ToDate);
      query += ` AND cm.CreatedDate < ($${params.length}::date + INTERVAL '1 day') `;
    }

    // ============================================================
    // STATUS FILTER
    // ============================================================

    if (["GM", "CEO", "OWNER"].includes(userType)) {
      // ----------------------------------------------------------
      // GM
      // ----------------------------------------------------------

      if (userType === "GM") {
        if (approvalStatus === "PENDING") {
          params.push("GM");

          query += `
            AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${params.length}
            AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
          `;
        } else if (approvalStatus) {
          params.push(approvalStatus);

          query += `
            AND UPPER(
              COALESCE(
                approval_state.GMStatus,
                'PENDING'
              )
            ) = $${params.length}
          `;
        } else {
          params.push("GM");

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

      // ----------------------------------------------------------
      // CEO
      // ----------------------------------------------------------
      else if (userType === "CEO") {
        if (approvalStatus === "PENDING") {
          params.push("CEO");

          query += `
            AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${params.length}
            AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
          `;
        } else if (approvalStatus) {
          params.push(approvalStatus);

          query += `
            AND UPPER(
              COALESCE(
                approval_state.CEOStatus,
                'PENDING'
              )
            ) = $${params.length}
          `;
        } else {
          params.push("CEO");

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

      // ----------------------------------------------------------
      // OWNER
      // ----------------------------------------------------------
      else if (userType === "OWNER") {
        if (approvalStatus === "PENDING") {
          params.push("OWNER");

          query += `
            AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${params.length}
            AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
          `;
        } else if (approvalStatus) {
          params.push(approvalStatus);

          query += `
            AND UPPER(
              COALESCE(
                approval_state.OwnerStatus,
                'PENDING'
              )
            ) = $${params.length}
          `;
        } else {
          params.push("OWNER");

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

    // ============================================================
    // HOD
    // ============================================================
    else if (userType === "HOD") {
      if (["REJECTED", "HOLD", "RETURNED"].includes(approvalStatus)) {
        params.push(approvalStatus);

        query += `
          AND (
            UPPER(COALESCE(approval_state.GMStatus, '')) = $${params.length}
            OR
            UPPER(COALESCE(approval_state.CEOStatus, '')) = $${params.length}
            OR
            UPPER(COALESCE(approval_state.OwnerStatus, '')) = $${params.length}
            OR
            UPPER(COALESCE(approval_state.FinalStatus, '')) = $${params.length}
          )
        `;
      } else if (approvalStatus === "APPROVED") {
        query += `
          AND UPPER(
            COALESCE(approval_state.GMStatus, 'PENDING')
          ) = 'APPROVED'

          AND UPPER(
            COALESCE(approval_state.CEOStatus, 'PENDING')
          ) = 'APPROVED'

          AND UPPER(
            COALESCE(approval_state.OwnerStatus, 'PENDING')
          ) = 'APPROVED'
        `;
      } else if (approvalStatus === "PENDING") {
        query += `
          AND NOT (
            UPPER(COALESCE(approval_state.GMStatus, ''))
              IN ('REJECTED', 'HOLD', 'RETURNED')

            OR

            UPPER(COALESCE(approval_state.CEOStatus, ''))
              IN ('REJECTED', 'HOLD', 'RETURNED')

            OR

            UPPER(COALESCE(approval_state.OwnerStatus, ''))
              IN ('REJECTED', 'HOLD', 'RETURNED')

            OR

            UPPER(COALESCE(approval_state.FinalStatus, ''))
              IN ('REJECTED', 'HOLD', 'RETURNED', 'APPROVED')
          )

          AND (
            UPPER(COALESCE(approval_state.GMStatus, 'PENDING'))
              <> 'APPROVED'

            OR

            UPPER(COALESCE(approval_state.CEOStatus, 'PENDING'))
              <> 'APPROVED'

            OR

            UPPER(COALESCE(approval_state.OwnerStatus, 'PENDING'))
              <> 'APPROVED'
          )
        `;
      }
    }

    // ============================================================
    // ORDER
    // ============================================================

    query += `
      ORDER BY
        cm.CreatedDate DESC,
        cm.CapexID DESC;
    `;

    // ============================================================
    // GET DATA
    // ============================================================

    let capexRows;

    if (Array.isArray(data.PreparedRows)) {
      capexRows = data.PreparedRows;
    } else {
      const result = await pool.query(query, params);

      // ============================================================
      // ATTACH DOCUMENTS / APPROVALS
      // ============================================================

      capexRows = await attachRelatedData(result.rows);
    }

    // ============================================================
    // ORGANIZATION
    // ============================================================

    const organizationId =
      data.OrganizationID || capexRows[0]?.OrganizationID || null;

    // ============================================================
    // PDF COLUMNS
    // ============================================================

    const approvalRoles = [];

    for (const row of capexRows) {
      for (const approval of row.Approvals || []) {
        const role = String(approval.ApprovalRole || "").trim().toUpperCase();
        if (role && !approvalRoles.includes(role)) approvalRoles.push(role);
      }
    }

    const pdfRows = capexRows.map((row, index) => ({
      ...row,
      ExportSerialNumber: index + 1,
    }));

    const approvalValue = (row, role) => {
      const approval = (row.Approvals || []).find(
        (item) =>
          String(item.ApprovalRole || "").trim().toUpperCase() === role,
      );

      if (!approval) return "-";

      const details = [approval.Status || "Pending"];
      details.push(
        `Qty - ${
          approval.ApprovedQuantity === null ||
          approval.ApprovedQuantity === undefined
            ? "-"
            : approval.ApprovedQuantity
        }`,
      );
      if (approval.Remarks) details.push(approval.Remarks);
      return details.join("\n");
    };

    const columns = [
      {
        header: "#",
        value: (row) => row.ExportSerialNumber,
        width: 24,
        align: "center",
      },
      {
        header: "HTL",
        value: (row) => row.OrganizationShortName,
        width: 48,
      },
      {
        header: "DEPT",
        value: (row) => row.Department,
        width: 65,
      },
      {
        header: "ITEM DETAILS",
        value: (row) =>
          [row.Item, row.Description].filter(Boolean).join("\n"),
        width: "*",
      },
      {
        header: "QTY",
        value: (row) => row.Qty,
        width: 42,
        align: "right",
      },
      {
        header: "RATE",
        value: (row) =>
          Number(row.Rate || 0).toLocaleString("en-IN", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }),
        width: 62,
        align: "right",
      },
      {
        header: "TOTAL",
        value: (row) =>
          Number(row.Total || 0).toLocaleString("en-IN", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }),
        width: 72,
        align: "right",
        bold: true,
      },
      ...approvalRoles.map((role) => ({
        header: role,
        value: (row) => approvalValue(row, role),
        width: 72,
        align: "left",
      })),
    ];

    // ============================================================
    // METADATA
    // ============================================================

    let organizationShortName =
      capexRows[0]?.OrganizationShortName || data.OrganizationShortName || null;

    if (!organizationShortName && organizationId) {
      const organizationResult = await pool.query(
        `SELECT ShortName
         FROM Organization_Master
         WHERE OrganizationID = $1
           AND IsDeleted = FALSE
         LIMIT 1`,
        [organizationId],
      );
      organizationShortName = organizationResult.rows[0]?.shortname || null;
    }

    organizationShortName ||= "All Organizations";

    const metadata = [
      { label: "Organization", value: organizationShortName },
      { label: "Department", value: data.Department || "All" },
      { label: "From Date", value: data.FromDate || "All" },
      { label: "To Date", value: data.ToDate || "All" },
      { label: "Status", value: approvalStatus || "All" },
      {
        label: "Total Records",
        value: capexRows.length,
      },
    ];

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer = await generatePdf({
      title: "CAPEX LIST REPORT",
      reportName: "CAPEX List Report",
      organizationId,
      logoUrl: data.logoUrl,
      orientation: "landscape",
      metadata,
      columns,
      rows: pdfRows,
      pageMargins: [20, 25, 20, 35],
    });

    return {
      success: true,
      message: "CAPEX list PDF generated successfully.",
      data: pdfBuffer,
      fileName: `CAPEX_List_Report_${Date.now()}.pdf`,
      contentType: "application/pdf",
    };
  } catch (error) {
    console.error("Get All CAPEX PDF Error:", error);

    return {
      success: false,
      message: "Unable to generate CAPEX list PDF.",
      statusCode: 503,
    };
  }
};

// Export the exact same records as getAllCapex. Keeping list visibility in one
// place prevents configured-flow differences (for example, a flow without
// OWNER) from making the screen and PDF disagree.
const generateCapexListPdf = async (data) => {
  try {
    const rows = [];
    const exportPageSize = 1000;
    let page = 1;
    let totalPages = 1;

    do {
      const response = await getAllCapex({
        ...data,
        page,
        PageSize: exportPageSize,
      });

      if (!response.success) return response;

      rows.push(...response.data);
      totalPages = response.TotalPages;
      page += 1;
    } while (page <= totalPages);

    return generateCapexListPdfDocument({
      ...data,
      PreparedRows: rows,
    });
  } catch (error) {
    console.error("Generate CAPEX List PDF Error:", error.message);
    return fail("Unable to generate CAPEX list PDF.", 503);
  }
};
// ===============================================================Department Report PDF
const getCapexDepartmentReportPdf = async (data) => {
  try {
    // Same report query as Department Report API
    const result = await pool.query(
      `${REPORT_DATA_CTE}
       SELECT
         COALESCE(Department, 'Unspecified') AS Department,
         COUNT(*)::bigint AS Count,
         COALESCE(SUM(Total), 0) AS TotalAmount,
         COUNT(*) FILTER (
           WHERE Status = 'Approved'
         )::bigint AS ApprovedCount,
         COUNT(*) FILTER (
           WHERE Status = 'Pending'
         )::bigint AS PendingCount,
         COUNT(*) FILTER (
           WHERE Status = 'Rejected'
         )::bigint AS RejectedCount,
         COUNT(*) FILTER (
           WHERE Status = 'Returned'
         )::bigint AS ReturnedCount
       FROM capex_data
       WHERE ($2::text IS NULL OR LOWER(TRIM(COALESCE(Department, 'Unspecified'))) = LOWER(TRIM($2::text)))
         AND ($3::date IS NULL OR CreatedDate >= $3::date)
         AND ($4::date IS NULL OR CreatedDate < ($4::date + INTERVAL '1 day'))
       GROUP BY COALESCE(Department, 'Unspecified')
       ORDER BY COALESCE(Department, 'Unspecified') ASC;`,
      departmentReportParameters(data),
    );

    const rows = result.rows;

    const pdfBuffer = await generatePdf({
      title: "CAPEX Department Report",
      reportName: "CAPEX Department Report",

      // Agar organization filter hai to yahan pass kar sakte ho
      organizationId: data?.Filters?.OrganizationID || null,

      orientation: "landscape",

      metadata: [
        {
          label: "Report",
          value: "CAPEX Department Report",
        },
        {
          label: "Generated Date",
          value: formatDate(new Date()),
        },
        {
          label: "Filters",
          value: `Department: ${data?.Filters?.Department || "All"} | From: ${
            data?.Filters?.FromDate || "All"
          } | To: ${data?.Filters?.ToDate || "All"}`,
        },
      ],

      columns: [
        {
          header: "Department",
          key: "department",
          width: "*",
        },
        {
          header: "Total Count",
          key: "count",
          width: 60,
          align: "center",
        },

        {
          header: "Approved",
          key: "approvedcount",
          width: 70,
          align: "center",
        },
        {
          header: "Pending",
          key: "pendingcount",
          width: 70,
          align: "center",
        },
        {
          header: "Rejected",
          key: "rejectedcount",
          width: 70,
          align: "center",
        },
        {
          header: "Returned",
          key: "returnedcount",
          width: 70,
          align: "center",
        },
      ],

      rows,
    });

    return {
      success: true,
      message: "CAPEX department report PDF generated successfully.",
      pdfBuffer,
      fileName: "CAPEX_Department_Report.pdf",
    };
  } catch (error) {
    console.error("CAPEX Department Report PDF Error:", error);

    return {
      success: false,
      message: "Unable to generate CAPEX department report PDF.",
      statusCode: 500,
    };
  }
};
// ============================================================ Organization Report PDF
const getCapexOrganizationReportPdf = async (data) => {
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

       FROM capex_data cm

       LEFT JOIN Organization_Master om
         ON om.OrganizationID = cm.OrganizationID
         AND om.IsDeleted = FALSE

       WHERE ($2::date IS NULL OR cm.CreatedDate >= $2::date)
         AND ($3::date IS NULL OR cm.CreatedDate < ($3::date + INTERVAL '1 day'))

       GROUP BY
         cm.OrganizationID,
         om.ShortName

       ORDER BY
         cm.OrganizationID ASC;`,
      organizationReportParameters(data),
    );

    const rows = result.rows;

    const pdfBuffer = await generatePdf({
      title: "CAPEX Organization Report",
      reportName: "CAPEX Organization Report",

      organizationId: data?.Filters?.OrganizationID || null,

      orientation: "landscape",

      metadata: [
        {
          label: "Filters",
          value: `From: ${data?.Filters?.FromDate || "All"} | To: ${
            data?.Filters?.ToDate || "All"
          }`,
        },
      ],

      columns: [
        {
          header: "Organization",
          key: "shortname",
          width: "*",
        },
        {
          header: "Total Count",
          key: "count",
          width: 60,
          align: "center",
        },

        {
          header: "Approved",
          key: "approvedcount",
          width: 75,
          align: "center",
        },
        {
          header: "Pending",
          key: "pendingcount",
          width: 75,
          align: "center",
        },
        {
          header: "Rejected",
          key: "rejectedcount",
          width: 75,
          align: "center",
        },
        {
          header: "Returned",
          key: "returnedcount",
          width: 75,
          align: "center",
        },
      ],

      rows,
    });

    return {
      success: true,
      message: "CAPEX organization report PDF generated successfully.",
      pdfBuffer,
      fileName: "CAPEX_Organization_Report.pdf",
    };
  } catch (error) {
    console.error("CAPEX Organization Report PDF Error:", error.message);

    return {
      success: false,
      message: "Unable to generate CAPEX organization report PDF.",
      statusCode: 500,
    };
  }
};
// ============================================================== Single Capex Report PDF
// ========================Helper
const formatCapexAmount = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "0.00";
  }

  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};
const formatCapexFileSize = (value) => {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-";
  }

  if (bytes < 1024) {
    return `${bytes} Bytes`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};
const capexPdfValue = (value) => {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return "-";
  }

  return String(value);
};
// ========================Api
const generateCapexByIdPdf = async (data) => {
  try {
    // ==========================================================
    // Validate CAPEX ID
    // ==========================================================

    const capexID = Number(data.CapexID);

    if (!Number.isInteger(capexID) || capexID <= 0) {
      return fail("Valid CAPEX ID is required.", 400);
    }

    // ==========================================================
    // Fetch CAPEX
    // ==========================================================

    const result = await pool.query(
      `
      ${CAPEX_SELECT}
      AND cm.CapexID = $1
      LIMIT 1;
      `,
      [capexID],
    );

    if (result.rows.length === 0) {
      return fail("CAPEX record not found.", 404);
    }

    // ==========================================================
    // Attach Related Data
    // Approvals API data will be received from this function
    // ==========================================================

    const [capex] = await attachRelatedData(result.rows);

    const approvals = Array.isArray(capex.Approvals)
      ? capex.Approvals
      : [];

    // ==========================================================
    // Dynamic Approval Items
    //
    // No static roles are defined.
    // Only roles available inside capex.Approvals will be shown.
    // ==========================================================

    const approvalItems = [];

    approvals.forEach((approval) => {
      if (
        approval.ApprovalRole === undefined ||
        approval.ApprovalRole === null ||
        String(approval.ApprovalRole).trim() === ""
      ) {
        return;
      }

      const approvalRole = String(
        approval.ApprovalRole,
      ).trim();

      const approvedQuantity =
        approval.ApprovedQuantity !== null &&
        approval.ApprovedQuantity !== undefined &&
        String(approval.ApprovedQuantity).trim() !== ""
          ? formatCapexAmount(
              approval.ApprovedQuantity,
            )
          : "-";

      approvalItems.push(
        {
          label: `${approvalRole} Status`,
          value: capexPdfValue(approval.Status),
        },
        {
          label: `${approvalRole} Approved Qty`,
          value: approvedQuantity,
        },
        {
          label: `${approvalRole} Remarks`,
          value: capexPdfValue(approval.Remarks),
        },
      );
    });

    if (approvalItems.length === 0) {
      approvalItems.push({
        label: "Approval",
        value: "No approval details available",
      });
    }

    // ==========================================================
    // Generate PDF
    // Existing pdfGenerator.js is used without any changes
    // ==========================================================

    const pdfBuffer = await generatePdf({
      title: "CAPEX Detail Report",

      reportName: `CAPEX #${capex.CapexNumber}`,

      organizationId: capex.OrganizationID,

      orientation: "portrait",

      pageMargins: [40, 30, 40, 38],

      // ========================================================
      // Main Information
      // ========================================================

      metadata: [
        {
          label: "Organization",
          value:
            capex.OrganizationShortName ||
            capex.OrganizationID,
        },
        {
          label: "CAPEX No.",
          value: capex.CapexNumber,
        },
        {
          label: "Created Date",
          value: capex.CreatedDate,
        },
        {
          label: "Department",
          value: capex.Department,
        },
        {
          label: "Status",
          value: capex.CurrentStatus,
        },
      ],

      // Main data table is not required
      columns: null,

      rows: [],

      // ========================================================
      // PDF Sections
      // ========================================================

      sections: [
        {
          title: "CAPEX Information",

          items: [
            {
              label: "Item",
              value: capex.Item,
            },
            {
              label: "Make",
              value: capex.Make,
            },
            {
              label: "Quantity",
              value: formatCapexAmount(capex.Qty),
            },
            {
              label: "Rate",
              value: `INR ${formatCapexAmount(
                capex.Rate,
              )}`,
            },
            {
              label: "Total",
              value: `INR ${formatCapexAmount(
                capex.Total,
              )}`,
            },
          ],
        },

        {
          title: "Description",

          items: [
            {
              label: "Description",
              value: capex.Description,
            },
          ],
        },

        {
          title: "Approval Workflow",

          // Dynamic approval details
          items: approvalItems,
        },
      ],

      // ========================================================
      // PDF Styles
      // ========================================================

      styles: {
        pdfTitle: {
          fontSize: 18,
          bold: true,
          color: "#082B5C",
        },

        pdfSection: {
          fontSize: 11,
          bold: true,
          color: "#082B5C",
        },

        pdfLabel: {
          fontSize: 8,
          bold: true,
          color: "#082B5C",
        },

        pdfValue: {
          fontSize: 8.5,
          color: "#172033",
        },
      },
    });

    // ==========================================================
    // Success Response
    // ==========================================================

    return {
      success: true,
      message: "CAPEX PDF generated successfully.",

      FileName: `CAPEX-${capex.CapexNumber}.pdf`,

      ContentType: "application/pdf",

      PdfBuffer: pdfBuffer,
    };
  } catch (error) {
    console.error(
      "Generate CAPEX PDF Service Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return fail(
      "Unable to generate CAPEX PDF at this time.",
      500,
    );
  }
};

// ============================================================ Exports
module.exports = {
  createCapex,
  getAllCapex,
  getCapexById,
  updateCapex,
  deleteCapex,
  processCapexApproval,
  getCapexSummaryReport,
  getCapexDepartmentReport,
  getCapexOrganizationReport,
  getApprovalConfig,
  createApprovalConfig,
  deleteApprovalConfig,
  generateCapexListPdf,
  getCapexDepartmentReportPdf,
  getCapexOrganizationReportPdf,
  generateCapexByIdPdf
};
