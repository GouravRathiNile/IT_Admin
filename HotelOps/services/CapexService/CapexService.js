const { pool } = require("../../db");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");
const generateDocumentUrl = require("../../AzurConfigration/Capex/AzureGetData");
const { formatDate } = require("../../utils/dateFormatter");
const DEFAULT_APPROVALS = Object.freeze([
  { LevelNo: 1, ApprovalRole: "GM" },
  { LevelNo: 2, ApprovalRole: "CEO" },
  { LevelNo: 3, ApprovalRole: "OWNER" },
]);
const APPROVAL_ROLES = new Set(["GM", "CEO", "OWNER"]);

// ============================================================ Shared Response Helpers
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
      data: {
        CapexID: capexID,
        CapexNumber: capexNumber,
        Total: total,
        DocumentCount: documents.length,
        Approvals: approvals.map((approval) => ({
          ...approval,
          Status: "Pending",
        })),
      },
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

// ============================================================ Read Query and Mapping Helpers
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
    cm.CreatedBy,
    cm.CreatedDate,
    cm.ModifiedBy,
    cm.ModifiedDate,

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
      stage.ApprovalRole,
      stage.Status,
      stage.LevelNo
    FROM
    (
      VALUES
        (1, 'GM', approval_state.GMStatus),
        (2, 'CEO', approval_state.CEOStatus),
        (3, 'OWNER', approval_state.OwnerStatus)
    ) AS stage(LevelNo, ApprovalRole, Status)

   WHERE UPPER(
    COALESCE(stage.Status, 'PENDING')
) NOT IN ('APPROVED', 'REJECTED')

    ORDER BY stage.LevelNo ASC
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
  CreatedBy: row.createdby == null ? null : Number(row.createdby),
  CreatedDate: row.createddate,
  ModifiedBy: row.modifiedby == null ? null : Number(row.modifiedby),
  ModifiedDate: row.modifieddate,
  CurrentApprovalRole: row.currentapprovalrole || null,
  CurrentStatus: row.currentstatus,
  Documents: [],
  Approvals: [],
});

// Generate a short-lived read URL while preserving stored blob paths in the DB.
const mapDocument = (row) => ({
  CapexDocumentID: Number(row.capexdocumentid),
  CapexID: Number(row.capexid),
  CapexNumber: Number(row.capexnumber),
  FileName: row.filename,
  FilePath: row.filepath ? generateDocumentUrl(row.filepath) : null,
  FileType: row.filetype,
  FileSize: row.filesize == null ? null : Number(row.filesize),
});

// Return approval fields without exposing soft-delete/audit internals.
const mapApproval = (row) => ({
  CapexApprovalID: Number(row.capexapprovalid),
  LevelNo: Number(row.levelno),
  ApprovalRole: row.approvalrole,
  Status: row.status,
  StatusDateTime: row.statusdatetime,
  StatusApprovedBy:
    row.statusapprovedby == null ? null : Number(row.statusapprovedby),
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
        stage.LevelNo,
        stage.ApprovalRole,
        stage.Status,
        stage.StatusDateTime,
        stage.StatusApprovedBy,
        stage.Remarks
      FROM Capex_Approval ca
      CROSS JOIN LATERAL
      (
        VALUES
          (1, 'GM', ca.GMStatus, ca.GMStatusDateTime, ca.GMStatusApprovedBy, ca.GMRemarks),
          (2, 'CEO', ca.CEOStatus, ca.CEOStatusDateTime, ca.CEOStatusApprovedBy, ca.CEORemarks),
          (3, 'OWNER', ca.OwnerStatus, ca.OwnerStatusDateTime, ca.OwnerStatusApprovedBy, ca.OwnerRemarks)
      ) AS stage(LevelNo, ApprovalRole, Status, StatusDateTime, StatusApprovedBy, Remarks)
      WHERE ca.CapexID = ANY($1::bigint[])
        AND ca.IsDeleted = FALSE
      ORDER BY ca.CapexID ASC, stage.LevelNo ASC, ca.CapexApprovalID ASC;
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

// ============================================================ Mutation Helpers
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

// Create the approval-stage snapshot attached to one CAPEX record.
const insertApprovalRows = async (client, capexID, approvals, userID) => {
  const approvalIDs = await reserveNumericIDs(
    client,
    "Capex_Approval",
    "CapexApprovalID",
    approvals.length,
  );

  for (const [index, approval] of approvals.entries()) {
    await client.query(
      `
      INSERT INTO Capex_Approval
      (
        CapexApprovalID,
        CapexID,
        LevelNo,
        ApprovalRole,
        Status,
        StatusDateTime,
        IsDeleted,
        CreatedBy,
        CreatedDate
      )
      VALUES ($1, $2, $3, $4, 'Pending', CURRENT_TIMESTAMP, FALSE, $5, CURRENT_TIMESTAMP);
      `,
      [
        approvalIDs[index],
        capexID,
        approval.LevelNo,
        approval.ApprovalRole,
        userID,
      ],
    );
  }
};

// Distinguish not-found records from authorization failures.
const capexExists = async (client, capexID) => {
  const result = await client.query(
    `SELECT 1 FROM Capex_Master WHERE CapexID = $1 AND IsDeleted = FALSE LIMIT 1;`,
    [capexID],
  );
  return result.rows.length > 0;
};

// Verify active user and organization mapping before organization reassignment.
const validateOrganizationAccess = async (client, userID, organizationID) => {
  const result = await client.query(
    `
    SELECT 1
    FROM user_org_mapping uom
    INNER JOIN user_master um ON um.UserID = uom.UserID
    INNER JOIN Organization_Master om ON om.OrganizationID = uom.OrganizationID
    WHERE uom.UserID = $1
      AND uom.OrganizationID = $2
      AND uom.IsActive = TRUE
      AND uom.IsDeleted = FALSE
      AND um.IsActive = TRUE
      AND um.IsDeleted = FALSE
      AND COALESCE(um.IsLocked, FALSE) = FALSE
      AND om.IsActive = TRUE
      AND om.IsDeleted = FALSE
      AND om.ActivationStatus = TRUE
    LIMIT 1;
    `,
    [userID, organizationID],
  );
  return result.rows.length > 0;
};

// Atomically reserve the next organization-specific CAPEX number.
const nextCapexNumber = async (client, organizationID) => {
  const result = await client.query(
    `
    INSERT INTO Capex_Organization_Sequence (OrganizationID, LastCapexNumber)
    VALUES ($1, 1)
    ON CONFLICT (OrganizationID)
    DO UPDATE SET
      LastCapexNumber = Capex_Organization_Sequence.LastCapexNumber + 1
    RETURNING LastCapexNumber;
    `,
    [organizationID],
  );
  return Number(result.rows[0].lastcapexnumber);
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

      data: {
        CapexID: Number(updated.capexid),
        OrganizationID: Number(updated.organizationid),
        CapexNumber: Number(updated.capexnumber),
        Department: updated.department,
        Item: updated.item,
        Description: updated.description,
        Make: updated.make,
        Qty: Number(updated.qty),
        Rate: Number(updated.rate),
        Total: Number(updated.total),
        IsVoid: updated.isvoid,
        VoidRemarks: updated.voidremarks,
        DocumentsUpdated: documents.length,
        DocumentsDeleted: deleteDocumentIDs.length,
      },
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
// Lock and process only the current configured approval stage.
const processCapexApproval = async (data) => {
  let client;
  let transactionStarted = false;

  console.log("PROCESS CAPEX APPROVAL DATA:", JSON.stringify(data));

  try {
    // ============================================================
    // 1. Normalize input
    // ============================================================

    const approverRole = String(data.UserType || "")
      .trim()
      .toUpperCase();

    const action = String(data.Action || "")
      .trim()
      .toUpperCase();

    const remarks = String(data.Remarks || "").trim();

    // ============================================================
    // 2. Validate action
    // ============================================================

    if (!["APPROVE", "REJECT", "RETURN"].includes(action)) {
      return fail("Invalid CAPEX approval action.", 400);
    }

    // ============================================================
    // 3. Remarks required for REJECT / RETURN
    // ============================================================

    if (["REJECT", "RETURN"].includes(action) && !remarks) {
      return fail(`Remarks are required when the action is ${action}.`, 400);
    }

    // ============================================================
    // 4. Validate role
    // ============================================================

    if (!APPROVAL_ROLES.has(approverRole)) {
      return fail("Your role is not authorized for CAPEX approval.", 403);
    }

    // ============================================================
    // 5. DB Connection
    // ============================================================

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ============================================================
    // 6. Get CAPEX
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
    // 7. CAPEX not found
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
    // 8. Get organization-specific / default approval config
    //
    // getMergedApprovals() should:
    // 1. First check organization configuration
    // 2. If not found, use default configuration
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
    // 9. Get CAPEX Approval
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
    // 10. Approval row not found
    // ============================================================

    if (approvalResult.rows.length === 0) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail("CAPEX approval record not found.", 404);
    }

    const approval = approvalResult.rows[0];

    // ============================================================
    // 11. Get role-specific approval data
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
    // 12. Build stages
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

    console.log("CAPEX APPROVAL STAGES:", JSON.stringify(stages));

    // ============================================================
    // 13. Final status already completed
    // ============================================================

    if (
      ["APPROVED", "REJECTED"].includes(
        String(approval.finalstatus || "")
          .trim()
          .toUpperCase(),
      )
    ) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail(
        `This CAPEX record is already ${String(
          approval.finalstatus,
        ).toLowerCase()}.`,
        400,
      );
    }

    // ============================================================
    // 14. Find current pending stage
    //
    // Example:
    //
    // GM      = Approved
    // CEO     = Pending
    // OWNER   = Pending
    //
    // currentIndex = CEO
    // currentRole  = CEO
    // ============================================================

    const currentIndex = stages.findIndex(
      (stage) => !["APPROVED"].includes(stage.status),
    );

    // ============================================================
    // 15. All stages approved
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
    // 16. Find user's own approval stage
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
    // 17. Determine whether user can perform action
    //
    // RULE:
    //
    // A. Current pending role can perform APPROVE/REJECT/RETURN
    //
    // B. Previous APPROVED role can ALSO perform
    //    REJECT/RETURN while next stage is PENDING.
    //
    // Example:
    //
    // GM APPROVED
    // CEO PENDING
    //
    // GM => APPROVE  ❌
    // GM => REJECT   ✅
    // GM => RETURN   ✅
    //
    // CEO => APPROVE  ✅
    // CEO => REJECT   ✅
    // CEO => RETURN   ✅
    // ============================================================

    let canPerformAction = false;

    // ------------------------------------------------------------
    // CASE 1:
    // User is the current pending stage
    // ------------------------------------------------------------

    if (
      userStageIndex === currentIndex &&
      ["PENDING", "RETURNED"].includes(userStatus)
    ) {
      canPerformAction = true;
    }

    // ------------------------------------------------------------
    // CASE 2:
    // User is previous approved stage
    //
    // User can REJECT / RETURN while next stage is pending.
    //
    // GM Approved -> CEO Pending
    // GM can Reject/Return
    //
    // CEO Approved -> OWNER Pending
    // CEO can Reject/Return
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
    // 18. Permission denied
    // ============================================================

    if (!canPerformAction) {
      await rollback(client, transactionStarted);

      transactionStarted = false;

      return fail(`You cannot perform ${action} action at this stage.`, 403);
    }

    // ============================================================
    // IMPORTANT:
    //
    // Action role is user's role, NOT currentRole.
    //
    // Example:
    //
    // GM Approved
    // CEO Pending
    // GM Reject
    //
    // We must update GM column, NOT CEO column.
    // ============================================================

    const actionRole = approverRole;

    // ============================================================
    // 19. Convert action to DB status
    // ============================================================

    const newStatus =
      action === "APPROVE"
        ? "Approved"
        : action === "REJECT"
          ? "Rejected"
          : "Returned";

    // ============================================================
    // 20. Update role status helper
    // ============================================================

    const updateRoleApproval = async (role, status, userId, roleRemarks) => {
      let query = "";
      let params = [
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
    // 21. APPROVE
    //
    // Only CURRENT stage can APPROVE.
    //
    // GM Approved -> CEO Pending
    // GM cannot approve again.
    //
    // CEO can approve.
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
      // Update current user's stage
      // ----------------------------------------------------------

      await updateRoleApproval(actionRole, "Approved", data.UserID, remarks);

      // ----------------------------------------------------------
      // Check next stage
      // ----------------------------------------------------------

      const followingStage = stages[currentIndex + 1];

      // ----------------------------------------------------------
      // More approval pending
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

          data: {
            CapexID: Number(capex.capexid),

            CapexNumber: Number(capex.capexnumber),

            CurrentStatus: "Pending",

            CurrentApprovalRole: followingStage.role,

            Action: "APPROVE",
          },
        };
      }

      // ----------------------------------------------------------
      // No next stage = FINAL APPROVAL
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

        data: {
          CapexID: Number(capex.capexid),

          CapexNumber: Number(capex.capexnumber),

          CurrentStatus: "Approved",

          CurrentApprovalRole: null,

          Action: "APPROVE",
        },
      };
    }

    // ============================================================
    // 22. REJECT
    //
    // Current pending role can reject.
    //
    // Previous approved role can ALSO reject while
    // next stage is pending.
    //
    // Example:
    //
    // GM Approved
    // CEO Pending
    //
    // GM Reject => GM becomes Rejected
    // FinalStatus = Rejected
    // ============================================================

    if (action === "REJECT") {
      await updateRoleApproval(actionRole, "Rejected", data.UserID, remarks);

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

        data: {
          CapexID: Number(capex.capexid),

          CapexNumber: Number(capex.capexnumber),

          CurrentStatus: "Rejected",

          CurrentApprovalRole: null,

          Action: "REJECT",
        },
      };
    }

    // ============================================================
    // 23. RETURN
    //
    // If current stage returns:
    //
    // CEO Pending -> CEO Returned
    //
    // If previous approved stage returns:
    //
    // GM Approved -> CEO Pending
    // GM Return
    //
    // GM becomes Returned
    // Then GM becomes current stage again.
    // ============================================================

    if (action === "RETURN") {
      await updateRoleApproval(actionRole, "Returned", data.UserID, remarks);

      // ----------------------------------------------------------
      // Reset FinalStatus
      // ----------------------------------------------------------

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

        data: {
          CapexID: Number(capex.capexid),

          CapexNumber: Number(capex.capexnumber),

          CurrentStatus: "Returned",

          CurrentApprovalRole: actionRole,

          Action: "RETURN",
        },
      };
    }

    // ============================================================
    // Should never reach here
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
// ============================================================ Report SQL
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
        WHEN cm.IsVoid = TRUE THEN 'Void'
        WHEN COALESCE(approval_state.HasRejected, FALSE) THEN 'Rejected'
        WHEN COALESCE(approval_state.HasReturned, FALSE) THEN 'Returned'
        WHEN approval_state.ApprovalCount > 0
          AND COALESCE(approval_state.AllApproved, FALSE) THEN 'Approved'
        ELSE 'Pending'
      END AS Status
    FROM Capex_Master cm
    LEFT JOIN LATERAL
    (
      SELECT
        COUNT(*)::integer AS ApprovalCount,
        BOOL_OR(UPPER(COALESCE(ca.Status, '')) = 'REJECTED') AS HasRejected,
        BOOL_OR(UPPER(COALESCE(ca.Status, '')) = 'RETURNED') AS HasReturned,
        BOOL_AND(UPPER(COALESCE(ca.Status, '')) = 'APPROVED') AS AllApproved
      FROM Capex_Approval ca
      WHERE ca.CapexID = cm.CapexID
        AND ca.IsDeleted = FALSE
    ) approval_state ON TRUE
    WHERE cm.IsDeleted = FALSE
      AND EXISTS
      (
        SELECT 1
        FROM user_org_mapping uom
        INNER JOIN user_master um
          ON um.UserID = uom.UserID
         AND um.IsActive = TRUE
         AND um.IsDeleted = FALSE
         AND COALESCE(um.IsLocked, FALSE) = FALSE
        INNER JOIN Organization_Master om
          ON om.OrganizationID = uom.OrganizationID
         AND om.IsActive = TRUE
         AND om.IsDeleted = FALSE
         AND om.ActivationStatus = TRUE
        WHERE uom.UserID = $1
          AND uom.OrganizationID = cm.OrganizationID
          AND uom.IsActive = TRUE
          AND uom.IsDeleted = FALSE
      )
      AND ($2::bigint IS NULL OR cm.OrganizationID = $2)
      AND ($3::text IS NULL OR LOWER(cm.Department) = LOWER($3))
      AND ($5::date IS NULL OR cm.CreatedDate >= $5::date)
      AND ($6::date IS NULL OR cm.CreatedDate < ($6::date + INTERVAL '1 day'))
  ),
  filtered_capex AS
  (
    SELECT *
    FROM capex_data
    WHERE $4::text IS NULL OR UPPER(Status) = UPPER($4)
  )
`;

// Keep parameter positions identical for every report query.
const reportParameters = (data) => {
  const filters = data.Filters || {};
  return [
    data.UserID,
    filters.OrganizationID ?? null,
    filters.Department ?? null,
    filters.Status ?? null,
    filters.FromDate ?? null,
    filters.ToDate ?? null,
  ];
};

// Read/report failures return synchronously; they are not background-retried.
const reportFailure = (error, reportName) => {
  console.error(`${reportName} Error:`, error.message);
  return fail(`Unable to generate ${reportName} at this time.`, 503);
};

// ============================================================ Summary Report
const getCapexSummaryReport = async (data) => {
  try {
    const result = await pool.query(
      `${REPORT_DATA_CTE}
       SELECT
         COUNT(*)::bigint AS TotalCapex,
         COALESCE(SUM(Total), 0) AS TotalAmount,
         COUNT(*) FILTER (WHERE Status = 'Pending')::bigint AS PendingCount,
         COALESCE(SUM(Total) FILTER (WHERE Status = 'Pending'), 0) AS PendingAmount,
         COUNT(*) FILTER (WHERE Status = 'Approved')::bigint AS ApprovedCount,
         COALESCE(SUM(Total) FILTER (WHERE Status = 'Approved'), 0) AS ApprovedAmount,
         COUNT(*) FILTER (WHERE Status = 'Rejected')::bigint AS RejectedCount,
         COALESCE(SUM(Total) FILTER (WHERE Status = 'Rejected'), 0) AS RejectedAmount,
         COUNT(*) FILTER (WHERE Status = 'Returned')::bigint AS ReturnedCount,
         COALESCE(SUM(Total) FILTER (WHERE Status = 'Returned'), 0) AS ReturnedAmount,
         COUNT(*) FILTER (WHERE Status = 'Void')::bigint AS VoidCount,
         COALESCE(SUM(Total) FILTER (WHERE Status = 'Void'), 0) AS VoidAmount
       FROM filtered_capex;`,
      reportParameters(data),
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
    return reportFailure(error, "CAPEX summary report");
  }
};

// ============================================================ Status Report
const getCapexStatusReport = async (data) => {
  try {
    const result = await pool.query(
      `${REPORT_DATA_CTE}
       SELECT
         Status,
         COUNT(*)::bigint AS Count,
         COALESCE(SUM(Total), 0) AS TotalAmount
       FROM filtered_capex
       GROUP BY Status
       ORDER BY
         CASE Status
           WHEN 'Pending' THEN 1
           WHEN 'Approved' THEN 2
           WHEN 'Rejected' THEN 3
           WHEN 'Returned' THEN 4
           WHEN 'Void' THEN 5
           ELSE 6
         END;`,
      reportParameters(data),
    );

    return {
      success: true,
      message: "CAPEX status report fetched successfully.",
      data: result.rows.map((row) => ({
        Status: row.status,
        Count: Number(row.count),
        TotalAmount: Number(row.totalamount),
      })),
    };
  } catch (error) {
    return reportFailure(error, "CAPEX status report");
  }
};

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
       FROM filtered_capex
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
         OrganizationID,
         COUNT(*)::bigint AS Count,
         COALESCE(SUM(Total), 0) AS TotalAmount,
         COUNT(*) FILTER (WHERE Status = 'Approved')::bigint AS ApprovedCount,
         COUNT(*) FILTER (WHERE Status = 'Pending')::bigint AS PendingCount,
         COUNT(*) FILTER (WHERE Status = 'Rejected')::bigint AS RejectedCount,
         COUNT(*) FILTER (WHERE Status = 'Returned')::bigint AS ReturnedCount
       FROM filtered_capex
       GROUP BY OrganizationID
       ORDER BY OrganizationID ASC;`,
      reportParameters(data),
    );

    return {
      success: true,
      message: "CAPEX organization report fetched successfully.",
      data: groupedReportRows(result.rows, "OrganizationID"),
    };
  } catch (error) {
    return reportFailure(error, "CAPEX organization report");
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
  getCapexStatusReport,
  getCapexDepartmentReport,
  getCapexOrganizationReport,
};
