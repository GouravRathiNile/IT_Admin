const { pool } = require("../../db");
const {retryableDatabaseResponse,} = require("../../utils/retryableDatabaseError");
const generateDocumentUrl = require("../../AzurConfigration/Capex/AzureGetData");
const { formatDate } = require("../../utils/dateFormatter");
const PdfPrinter = require("pdfmake");
const path = require("path");

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
    console.log("GET ALL CAPEX DATA:", JSON.stringify(data));

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

    const validStatuses = ["PENDING", "APPROVED", "REJECTED"];

    if (approvalStatus && !validStatuses.includes(approvalStatus)) {
      return {
        success: false,
        message: "Status must be Pending, Approved, or Rejected.",
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
    // STATUS FILTER
    // =====================================================

    if (["GM", "CEO", "OWNER"].includes(userType)) {
      // ---------------------------------------------------
      // GM
      // ---------------------------------------------------

      if (userType === "GM") {
        if (approvalStatus) {
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

      // ---------------------------------------------------
      // CEO
      // ---------------------------------------------------
      else if (userType === "CEO") {
        if (approvalStatus) {
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

      // ---------------------------------------------------
      // OWNER
      // ---------------------------------------------------
      else if (userType === "OWNER") {
        if (approvalStatus) {
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

    // =====================================================
    // HOD
    // =====================================================
    else if (userType === "HOD") {
      if (approvalStatus === "REJECTED") {
        // Any stage rejected
        query += `
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
        // All stages approved
        query += `
          AND UPPER(
            COALESCE(
              approval_state.GMStatus,
              'PENDING'
            )
          ) = 'APPROVED'

          AND UPPER(
            COALESCE(
              approval_state.CEOStatus,
              'PENDING'
            )
          ) = 'APPROVED'

          AND UPPER(
            COALESCE(
              approval_state.OwnerStatus,
              'PENDING'
            )
          ) = 'APPROVED'
        `;
      } else if (approvalStatus === "PENDING") {
        // Not rejected + at least one pending
        query += `
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

      FROM Capex_Master cm

      INNER JOIN Organization_Master om
        ON om.OrganizationID = cm.OrganizationID
       AND om.IsActive = TRUE
       AND om.IsDeleted = FALSE
       AND om.ActivationStatus = TRUE

      LEFT JOIN Capex_Approval approval_state
        ON approval_state.CapexID = cm.CapexID
       AND approval_state.IsDeleted = FALSE

      WHERE cm.IsDeleted = FALSE
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

    if (["GM", "CEO", "OWNER"].includes(userType)) {
      let statusColumn = null;

      if (userType === "GM") {
        statusColumn = "approval_state.GMStatus";
      } else if (userType === "CEO") {
        statusColumn = "approval_state.CEOStatus";
      } else if (userType === "OWNER") {
        statusColumn = "approval_state.OwnerStatus";
      }

      if (approvalStatus) {
        countParams.push(approvalStatus);

        countQuery += `
          AND UPPER(
            COALESCE(
              ${statusColumn},
              'PENDING'
            )
          ) = $${countParams.length}
        `;
      } else {
        // Default pending for approvers
        countQuery += `
          AND UPPER(
            COALESCE(
              ${statusColumn},
              'PENDING'
            )
          ) = 'PENDING'
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
              approval_state.GMStatus,
              'PENDING'
            )
          ) = 'APPROVED'

          AND UPPER(
            COALESCE(
              approval_state.CEOStatus,
              'PENDING'
            )
          ) = 'APPROVED'

          AND UPPER(
            COALESCE(
              approval_state.OwnerStatus,
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
const updateCapex = async (data) => {
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
    // CAPEX Fields
    // OrganizationID and CapexNumber are NOT updated
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
      // Get existing CAPEX number
      // ----------------------------------------------------------

      const capexInfo = updateResult.rows[0];

      const capexNumber = Number(capexInfo.capexnumber);

      // ----------------------------------------------------------
      // Soft delete old documents
      // ----------------------------------------------------------

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

      // ----------------------------------------------------------
      // Generate IDs for new documents
      // ----------------------------------------------------------

      const newDocumentIDs = await reserveNumericIDs(
        client,
        "Capex_Documents",
        "CapexDocumentID",
        documents.length,
      );

      // ----------------------------------------------------------
      // Insert new documents
      // ----------------------------------------------------------

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
        SELECT CapexDocumentID
        FROM Capex_Documents
        WHERE CapexID = $1
          AND CapexDocumentID = ANY($2::bigint[])
          AND IsDeleted = FALSE;
        `,
        [data.CapexID, deleteDocumentIDs],
      );

      if (ownedDocuments.rows.length !== deleteDocumentIDs.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return fail("One or more selected CAPEX documents are invalid.", 400);
      }

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
        [data.UserID, data.CapexID, deleteDocumentIDs],
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
      message: "CAPEX updated successfully.",

      // data: {
      //   CapexID: Number(updated.capexid),
      //   OrganizationID: Number(updated.organizationid),
      //   CapexNumber: Number(updated.capexnumber),
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

    console.error("Update CAPEX Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    if (error.code === "23503") {
      return fail("Invalid CAPEX related data.", 400);
    }

    if (error.code === "23505") {
      return fail("CAPEX organization number already exists.", 409);
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

  // console.log("PROCESS CAPEX APPROVAL DATA:", JSON.stringify(data));

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

    if (!["APPROVE", "REJECT", "RETURN"].includes(action)) {
      return fail("Invalid CAPEX approval action.", 400);
    }

    // ============================================================
    // 3. REMARKS REQUIRED
    // ============================================================

    if (["REJECT", "RETURN"].includes(action) && !remarks) {
      return fail(`Remarks are required when the action is ${action}.`, 400);
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
        GMStatusDateTime,
        GMStatusApprovedBy,
        GMRemarks,

        CEOStatus,
        CEOStatusDateTime,
        CEOStatusApprovedBy,
        CEORemarks,

        OwnerStatus,
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
            statusDateTime: approval.gmstatusdatetime,
            approvedBy: approval.gmstatusapprovedby,
            remarks: approval.gmremarks,
          };

        case "CEO":
          return {
            status: approval.ceostatus,
            statusDateTime: approval.ceostatusdatetime,
            approvedBy: approval.ceostatusapprovedby,
            remarks: approval.ceoremarks,
          };

        case "OWNER":
          return {
            status: approval.ownerstatus,
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
    // PENDING / RETURNED / REJECTED
    // ------------------------------------------------------------

    if (
      userStageIndex === currentIndex &&
      ["PENDING", "RETURNED", "REJECTED"].includes(userStatus)
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

    const updateRoleApproval = async (role, status, userId, roleRemarks) => {
      let query = "";

      const params = [
        status,
        userId,
        roleRemarks || null,
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
              ModifiedBy = $2,
              ModifiedDate = CURRENT_TIMESTAMP
            WHERE CapexApprovalID = $4
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
              ModifiedBy = $2,
              ModifiedDate = CURRENT_TIMESTAMP
            WHERE CapexApprovalID = $4
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
              ModifiedBy = $2,
              ModifiedDate = CURRENT_TIMESTAMP
            WHERE CapexApprovalID = $4
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

      await updateRoleApproval(approverRole, "Approved", data.UserID, remarks);

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
      await updateRoleApproval(approverRole, "Rejected", data.UserID, remarks);

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

      await updateRoleApproval(approverRole, "Returned", data.UserID, remarks);

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
    // 22. FALLBACK
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

  return [
    filters.OrganizationID ?? null,
  ];
};
// Read/report failures return synchronously; they are not background-retried.
const reportFailure = (error, reportName) => {
  console.error(`${reportName} Error:`, error.message);

  return fail(
    `Unable to generate ${reportName} at this time.`,
    503
  );
};
// ============================================================ Summary Report
const getCapexSummaryReport = async (data) => {
  try {
console.log("Received Filters:", JSON.stringify(data.Filters));
    console.log("Query params:", reportParameters(data));
    const result = await pool.query(
      `
      ${REPORT_DATA_CTE}

      SELECT

        -- ====================================================
        -- TOTAL
        -- ====================================================

        COUNT(*)::bigint AS TotalCapex,

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

      FROM capex_data;
      `,

      reportParameters(data)
    );


    const row = result.rows[0];


    return {
      success: true,

      message: "CAPEX summary report fetched successfully.",

      data: {
        TotalCapex: Number(row.totalcapex),
        TotalAmount: Number(row.totalamount),

        PendingCount: Number(row.pendingcount),
        PendingAmount: Number(row.pendingamount),

        ApprovedCount: Number(row.approvedcount),
        ApprovedAmount: Number(row.approvedamount),

        RejectedCount: Number(row.rejectedcount),
        RejectedAmount: Number(row.rejectedamount),

        ReturnedCount: Number(row.returnedcount),
        ReturnedAmount: Number(row.returnedamount),

        VoidCount: Number(row.voidcount),
        VoidAmount: Number(row.voidamount),
      },
    };

  } catch (error) {

    return reportFailure(
      error,
      "CAPEX summary report"
    );

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
       GROUP BY COALESCE(Department, 'Unspecified')
       ORDER BY COALESCE(Department, 'Unspecified') ASC;`,
      reportParameters(data),
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

       GROUP BY
         cm.OrganizationID,
         om.ShortName

       ORDER BY
         cm.OrganizationID ASC;`,
      reportParameters(data),
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
      500
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

    const approvals = Array.isArray(data.Approvals)
      ? data.Approvals
      : [];

    if (!Number.isInteger(OrganizationID) || OrganizationID <= 0) {
      return fail("OrganizationID is required.", 400);
    }

    if (approvals.length === 0) {
      return fail(
        "At least one approval configuration is required.",
        400
      );
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
      const {
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
      } = approval;

      if (
        !Number.isInteger(ApprovalLevel) ||
        ApprovalLevel < 1
      ) {
        return fail(
          "ApprovalLevel must be a positive integer.",
          400
        );
      }

      if (
        !Number.isInteger(ApprovalOrder) ||
        ApprovalOrder < 1
      ) {
        return fail(
          "ApprovalOrder must be a positive integer.",
          400
        );
      }

      if (!APPROVAL_ROLES.has(ApprovalRole)) {
        return fail(
          "ApprovalRole must be GM, CEO, or OWNER.",
          400
        );
      }

      if (levels.has(ApprovalLevel)) {
        return fail(
          `Approval level ${ApprovalLevel} is duplicated in request.`,
          409
        );
      }

      if (roles.has(ApprovalRole)) {
        return fail(
          `${ApprovalRole} approval stage is duplicated in request.`,
          409
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
      [OrganizationID]
    );

    const existingConfigs = existingResult.rows;

    console.log(
      "EXISTING CAPEX CONFIGS =>",
      JSON.stringify(existingConfigs, null, 2)
    );

    // ============================================================
    // MAP BY LEVEL
    // ============================================================

    const existingByLevel = new Map();

    for (const row of existingConfigs) {
      existingByLevel.set(
        Number(row.ApprovalLevel),
        row
      );
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
      const {
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
        IsMandatory,
      } = approval;

      const existing = existingByLevel.get(ApprovalLevel);

      // ==========================================================
      // EXISTING RECORD
      // ==========================================================

      if (existing) {
        const ConfigID = Number(
          existing.CapexApprovalConfigID
        );

        if (!Number.isInteger(ConfigID)) {
          throw new Error(
            `Invalid CapexApprovalConfigID: ${existing.CapexApprovalConfigID}`
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
            ]
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
            ]
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
          ]
        );

        const ConfigID = Number(
          result.rows[0].CapexApprovalConfigID
        );

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

      if (
        existing.IsDeleted === false &&
        !processedLevels.has(level)
      ) {
        const ConfigID = Number(
          existing.CapexApprovalConfigID
        );

        if (!Number.isInteger(ConfigID)) {
          throw new Error(
            `Invalid CapexApprovalConfigID: ${existing.CapexApprovalConfigID}`
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
          [
            data.UserID,
            ConfigID,
            OrganizationID,
          ]
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
      message:
        "CAPEX approval configuration saved successfully.",

    };

  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error(
      "Save CAPEX Approval Config Error:",
      error.message
    );

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) return retryResponse;

    if (error.code === "23505") {
      return fail(
        "CAPEX approval configuration already exists.",
        409
      );
    }

    if (error.code === "23503") {
      return fail(
        "Invalid organization or user.",
        400
      );
    }

    return fail(
      "Unable to save CAPEX approval configuration at this time.",
      500
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

      return fail(
        "CAPEX approval configuration not found.",
        404,
      );
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
const generateCapexListPdf = async (capex) => {
  const fonts = {
    Roboto: {
      normal: path.join(
        process.cwd(),
        "fonts/Roboto-Regular.ttf",
      ),
      bold: path.join(
        process.cwd(),
        "fonts/Roboto-Medium.ttf",
      ),
      italics: path.join(
        process.cwd(),
        "fonts/Roboto-SemiBold.ttf",
      ),
      bolditalics: path.join(
        process.cwd(),
        "fonts/Roboto-Bold.ttf",
      ),
    },
  };

  const printer = new PdfPrinter(fonts);

  // ============================================================
  // CAPEX DETAILS
  // ============================================================

  const capexDetails = [
    [
      { text: "CAPEX Number", style: "label" },
      { text: String(capex.CapexNumber ?? "-"), style: "value" },
      { text: "CAPEX ID", style: "label" },
      { text: String(capex.CapexID ?? "-"), style: "value" },
    ],
    [
      { text: "Department", style: "label" },
      { text: capex.Department || "-", style: "value" },
      { text: "Item", style: "label" },
      { text: capex.Item || "-", style: "value" },
    ],
    [
      { text: "Description", style: "label" },
      {
        text: capex.Description || "-",
        style: "value",
        colSpan: 3,
      },
      {},
      {},
    ],
    [
      { text: "Make", style: "label" },
      { text: capex.Make || "-", style: "value" },
      { text: "Quantity", style: "label" },
      { text: String(capex.Qty ?? "-"), style: "value" },
    ],
    [
      { text: "Rate", style: "label" },
      {
        text:
          capex.Rate != null
            ? `₹ ${Number(capex.Rate).toLocaleString("en-IN")}`
            : "-",
        style: "value",
      },
      { text: "Total", style: "label" },
      {
        text:
          capex.Total != null
            ? `₹ ${Number(capex.Total).toLocaleString("en-IN")}`
            : "-",
        style: "value",
      },
    ],
    [
      { text: "Status", style: "label" },
      { text: capex.CurrentStatus || "-", style: "value" },
      { text: "Current Role", style: "label" },
      { text: capex.CurrentApprovalRole || "-", style: "value" },
    ],
    [
      { text: "Created Date", style: "label" },
      {
        text: capex.CreatedDate
          ? formatDate(capex.CreatedDate)
          : "-",
        style: "value",
      },
      { text: "Created By", style: "label" },
      {
        text: capex.CreatedBy != null
          ? String(capex.CreatedBy)
          : "-",
        style: "value",
      },
    ],
    [
      { text: "Modified Date", style: "label" },
      {
        text: capex.ModifiedDate
          ? formatDate(capex.ModifiedDate)
          : "-",
        style: "value",
      },
      { text: "Modified By", style: "label" },
      {
        text: capex.ModifiedBy != null
          ? String(capex.ModifiedBy)
          : "-",
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

  if (capex.Approvals?.length) {
    capex.Approvals.forEach((approval) => {
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

  if (capex.Documents?.length) {
    capex.Documents.forEach((document) => {
      documentRows.push([
        {
          text: String(document.CapexDocumentID ?? "-"),
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
                text: "CAPEX DETAILS",
                style: "title",
                border: [false, false, false, false],
              },
              {
                text: capex.CurrentStatus || "Pending",
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
        text: "CAPEX INFORMATION",
        style: "sectionTitle",
        marginBottom: 6,
      },

      {
        table: {
          widths: [85, "*", 85, "*"],
          body: capexDetails,
        },
        layout: {
          fillColor: (rowIndex) =>
            rowIndex % 2 === 0 ? "#F5F7FA" : "#FFFFFF",
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
          text: "CAPEX Management",
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
};
