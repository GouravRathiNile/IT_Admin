const { pool } = require("../../db");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");
const generateDocumentUrl = require("../../AzurConfigration/Opex/AzureGetData");
const { formatDate } = require("../../utils/dateFormatter");
const PdfPrinter = require("pdfmake");
const path = require("path");
const { generatePdf, loadLogo, } = require("../../utils/pdfHelper");
const { sendEmail } = require("../../utils/emailService");
const { buildOpexEmail } = require("./OpexEmailTemplate");
const generateOrganizationLogoUrl = require("../../AzurConfigration/ITAdmin/OrganizationMaster/AzureGetData");
const OPEX_DETAIL_PDF_FONTS = {
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

const OPEX_NOTIFICATION_MODULE = "Opex";


// ======================================================
const notificationUserIds = (values) => [...new Set((Array.isArray(values) ? values : [values])
  .filter((value) => value != null && /^[1-9]\d*$/.test(String(value).trim()))
  .map((value) => String(value).trim()))].sort();

// ==============================================================Default roles
const DEFAULT_APPROVALS = Object.freeze([
  { LevelNo: 1, ApprovalRole: "HOD" },
  { LevelNo: 2, ApprovalRole: "FC" },
  { LevelNo: 3, ApprovalRole: "GM" },
  { LevelNo: 4, ApprovalRole: "RD-FC" },
  { LevelNo: 5, ApprovalRole: "CEO" },
]);
const APPROVAL_ROLES = new Set(["HOD", "FC", "GM", "RD-FC", "CEO"]);
const CENTRAL_RDFC_ORGANIZATION_ID = 10;

// Returns true only when the OPEX creator is an active Finance HOD
// mapped to the same organization as the OPEX.
const isFinanceHodCreator = async (userID, organizationID) => {
  const normalizedUserID = Number(userID);
  const normalizedOrganizationID = Number(organizationID);

  if (
    !Number.isSafeInteger(normalizedUserID) ||
    normalizedUserID < 1 ||
    !Number.isSafeInteger(normalizedOrganizationID) ||
    normalizedOrganizationID < 1
  ) {
    return false;
  }

  const result = await pool.query(
    `
    SELECT 1
    FROM user_master um
    INNER JOIN department_master dm
      ON dm.departmentid = um.departmentid
    INNER JOIN user_org_mapping uom
      ON uom.userid = um.userid
    WHERE um.userid = $1
      AND uom.organizationid = $2
      AND UPPER(TRIM(um.usertype)) = 'HOD'
      AND UPPER(TRIM(COALESCE(dm.departmentname, ''))) = 'FINANCE'
      AND um.isactive = TRUE
      AND um.isdeleted = FALSE
      AND um.islocked = FALSE
      AND dm.isdeleted = FALSE
      AND uom.isactive = TRUE
      AND uom.isdeleted = FALSE
    LIMIT 1;
    `,
    [normalizedUserID, normalizedOrganizationID],
  );

  return result.rows.length > 0;
};
// Resolve recipients with the same effective-role rules used by OPEX approval:
// property/department HOD, property FC/GM/CEO, and central-org Finance HOD for RD-FC.
const resolveOpexNotificationRecipients = async ({ organizationID, department, roles = [],
  directUserIds = [], excludeUserID = null, actorUserID = null }) => {
  const normalizedRoles = [...new Set(roles.map((role) => String(role || "").trim().toUpperCase())
    .filter((role) => APPROVAL_ROLES.has(role)))];
  const normalizedUserIds = notificationUserIds(directUserIds);
  const result = await pool.query(`
    SELECT DISTINCT um.userid, um.email, om.organizationname,
      COALESCE(NULLIF(TRIM(om.shortname), ''), om.organizationname) AS organization_short_name,
      COALESCE(NULLIF(TRIM(actor.fullname), ''), NULLIF(TRIM(actor.username), '')) AS actor_name
    FROM user_master um
    INNER JOIN organization_master om ON om.organizationid = $1
    LEFT JOIN department_master dm ON dm.departmentid = um.departmentid
    LEFT JOIN user_master actor ON actor.userid::text = $5::text
    WHERE om.isactive = TRUE AND om.activationstatus = TRUE AND om.isdeleted = FALSE
      AND um.isactive = TRUE AND um.isdeleted = FALSE AND um.islocked = FALSE
      AND ($4::text IS NULL OR um.userid::text <> $4::text)
      AND (
        (um.userid::text = ANY($3::text[]) AND EXISTS (
          SELECT 1 FROM user_org_mapping direct_uom
          WHERE direct_uom.userid = um.userid AND direct_uom.organizationid = $1
            AND direct_uom.isactive = TRUE AND direct_uom.isdeleted = FALSE))
        OR ('HOD' = ANY($2::text[]) AND UPPER(TRIM(um.usertype)) = 'HOD'
          AND UPPER(TRIM(COALESCE(dm.departmentname, ''))) = UPPER(TRIM($6))
          AND dm.isdeleted = FALSE
          AND EXISTS (SELECT 1 FROM user_org_mapping hod_uom
            WHERE hod_uom.userid = um.userid AND hod_uom.organizationid = $1
              AND hod_uom.isactive = TRUE AND hod_uom.isdeleted = FALSE))
        OR ('FC' = ANY($2::text[]) AND UPPER(TRIM(um.usertype)) = 'HOD'
          AND UPPER(TRIM(COALESCE(dm.departmentname, ''))) = 'FINANCE'
          AND dm.organizationid = $1 AND dm.isdeleted = FALSE
          AND EXISTS (SELECT 1 FROM user_org_mapping fc_uom
            WHERE fc_uom.userid = um.userid AND fc_uom.organizationid = $1
              AND fc_uom.isactive = TRUE AND fc_uom.isdeleted = FALSE)
          AND NOT EXISTS (SELECT 1 FROM user_org_mapping central_fc_uom
            WHERE central_fc_uom.userid = um.userid AND central_fc_uom.organizationid = $7
              AND central_fc_uom.isactive = TRUE AND central_fc_uom.isdeleted = FALSE))
        OR ('GM' = ANY($2::text[]) AND UPPER(TRIM(um.usertype)) = 'GM'
          AND EXISTS (SELECT 1 FROM user_org_mapping gm_uom
            WHERE gm_uom.userid = um.userid AND gm_uom.organizationid = $1
              AND gm_uom.isactive = TRUE AND gm_uom.isdeleted = FALSE))
        OR ('CEO' = ANY($2::text[]) AND UPPER(TRIM(um.usertype)) = 'CEO'
          AND EXISTS (SELECT 1 FROM user_org_mapping ceo_uom
            WHERE ceo_uom.userid = um.userid AND ceo_uom.organizationid = $1
              AND ceo_uom.isactive = TRUE AND ceo_uom.isdeleted = FALSE))
        OR ('RD-FC' = ANY($2::text[]) AND UPPER(TRIM(um.usertype)) = 'HOD'
          AND UPPER(TRIM(COALESCE(dm.departmentname, ''))) = 'FINANCE'
          AND EXISTS (SELECT 1 FROM user_org_mapping rdfc_uom
            WHERE rdfc_uom.userid = um.userid AND rdfc_uom.organizationid = $7
              AND rdfc_uom.isactive = TRUE AND rdfc_uom.isdeleted = FALSE))
      )`,
    [organizationID, normalizedRoles, normalizedUserIds,
      excludeUserID == null ? null : String(excludeUserID),
      actorUserID == null ? null : String(actorUserID), String(department || ""),
      CENTRAL_RDFC_ORGANIZATION_ID]);
  return {
    userIds: notificationUserIds(result.rows.map((row) => row.userid)),
    emails: [...new Map(result.rows
      .map((row) => String(row.email || "").trim()).filter(Boolean)
      .map((email) => [email.toLowerCase(), email])).values()],
    organizationName: String(result.rows[0]?.organizationname || "").trim(),
    organizationShortName: String(result.rows[0]?.organization_short_name || "").trim(),
    actorName: String(result.rows[0]?.actor_name || "").trim(),
  };
};

// Email is explicitly orchestrated by OPEX after notification persistence;
// failures here cannot affect the committed OPEX or Firebase notification.
const sendOpexEmails = async ({ emails, organizationID, organizationName,
  notificationTitle, details }) => {
  if (!emails.length) return;
  try {
    const logoResult = await pool.query(`
      SELECT logoname
      FROM organization_master_logo
      WHERE organizationid = $1 AND isdeleted = FALSE
      ORDER BY logoid
      LIMIT 1`, [organizationID]);
    let logoUrl = process.env.NILE_OFFICIAL_LOGO_URL || null;
    if (logoResult.rows[0]?.logoname) {
      try { logoUrl = generateOrganizationLogoUrl(logoResult.rows[0].logoname); }
      catch (error) { console.error("OPEX email logo URL failed:", error.message); }
    }
    const email = buildOpexEmail({ notificationTitle, organizationName, logoUrl, details });
    await Promise.all(emails.map(async (address) => {
      try { await sendEmail(address, email.subject, email.text, email.html); }
      catch (error) { console.error("OPEX email delivery failed:", error.message); }
    }));
  } catch (error) {
    console.error("OPEX email preparation failed:", error.message);
  }
};

// Presentation is separate from recipient selection so text changes cannot alter workflow.
const opexNotificationContent = ({ kind, item, qty, department, description,
  organizationShortName, actorName, approverRole }) => {
  const title = kind === "CREATE"
    ? `OPEX - ${String(item || "").trim()} (${String(qty ?? "").trim()}) - ${String(department || "").trim()} - ${organizationShortName}`
    : `OPEX - ${String(item || "").trim()} - ${String(department || "").trim()} - ${organizationShortName}`;
  if (kind === "CREATE") return { title, message: String(description || "").trim() };
  const actionLabel = { APPROVE: "Approved", REJECT: "Rejected", RETURN: "Returned", HOLD: "Hold" }[kind];
  return { title, message: `${actionLabel} by ${actorName || approverRole}` };
};

// OPEX owns recipient/content rules; the shared service persists and pushes the final command.
const notifyOpex = async ({ organizationID, opexID, department, roles, directUserIds,
  excludeUserID, actorUserID, kind, item, qty, rate, total, description,
  actionQuantity, remark, actionDate, approverRole, action }) => {
  const context = await resolveOpexNotificationRecipients({
    organizationID, department,
    roles, directUserIds, excludeUserID, actorUserID
  });
  if (!context.userIds.length) return;
  const content = opexNotificationContent({
    kind, item, qty, department, description,
    approverRole, organizationShortName: context.organizationShortName, actorName: context.actorName
  });
  const { sendMessage } = require("../../producer/producer");
  const QUEUE = require("../../config/queue");
  const response = await sendMessage(QUEUE.NOTIFICATION.REQUEST, QUEUE.NOTIFICATION.RESPONSE, {
    action: "CREATE_NOTIFICATION",
    data: {
      organizationId: Number(organizationID), title: content.title, message: content.message,
      type: "info", moduleName: OPEX_NOTIFICATION_MODULE, entityType: "Opex",
      entityId: String(opexID), action, priority: "normal", userIds: context.userIds
    },
  });
  if (!response || response.success !== true) {
    console.error("OPEX notification request unsuccessful:", response?.message || "No response");
    return;
  }
  Promise.resolve().then(() => sendOpexEmails({
    emails: context.emails, organizationID, organizationName: context.organizationName,
    notificationTitle: content.title,
    details: {
      entityId: opexID, kind, item, department, quantity: qty, rate, total, description,
      actionQuantity, remark, actionBy: context.actorName || approverRole || "-", actionDate
    },
  })).catch((error) => console.error("OPEX email dispatch failed:", error.message));
};

// Notification failure is isolated from an OPEX transaction that already committed.
const notifyCommittedOpex = (event) => {
  Promise.resolve().then(() => notifyOpex(event))
    .catch((error) => console.error("OPEX notification failed:", error.message));
};

// ============================================================ Shared Response Helpers(Create Helpers)
const fail = (message, statusCode = 400) => ({
  success: false,
  statusCode,
  message,
});

// Resolve OPEX permissions from trusted JWT claims without changing the JWT.
// Organization 10 Finance HODs centrally perform RD-FC; other Finance HODs
// retain FC behavior and every non-Finance HOD remains department restricted.
const hasCentralRdfcMapping = async (queryable, userID) => {
  const normalizedUserID = Number(userID);
  if (!Number.isSafeInteger(normalizedUserID) || normalizedUserID < 1) {
    return false;
  }

  const result = await queryable.query(
    `
    SELECT 1
    FROM user_org_mapping uom
    INNER JOIN user_master um
      ON um.UserID = uom.UserID
    INNER JOIN organization_master om
      ON om.OrganizationID = uom.OrganizationID
    WHERE uom.UserID = $1
      AND uom.OrganizationID = $2
      AND uom.IsActive = TRUE
      AND uom.IsDeleted = FALSE
      AND um.IsActive = TRUE
      AND um.IsDeleted = FALSE
      AND um.IsLocked = FALSE
      AND om.IsActive = TRUE
      AND om.ActivationStatus = TRUE
      AND om.IsDeleted = FALSE
    LIMIT 1;
    `,
    [normalizedUserID, CENTRAL_RDFC_ORGANIZATION_ID],
  );

  return result.rows.length > 0;
};

const getRdfcMappedOrganizations = async (queryable, userID) => {
  const normalizedUserID = Number(userID);

  if (!Number.isSafeInteger(normalizedUserID) || normalizedUserID < 1) {
    return [];
  }

  const result = await queryable.query(
    `
    SELECT uom.OrganizationID
    FROM user_org_mapping uom
    INNER JOIN user_master um
      ON um.UserID = uom.UserID
    INNER JOIN organization_master om
      ON om.OrganizationID = uom.OrganizationID
    WHERE uom.UserID = $1
      AND uom.IsActive = TRUE
      AND uom.IsDeleted = FALSE
      AND um.IsActive = TRUE
      AND um.IsDeleted = FALSE
      AND um.IsLocked = FALSE
      AND om.IsActive = TRUE
      AND om.ActivationStatus = TRUE
      AND om.IsDeleted = FALSE
    ORDER BY uom.OrganizationID;
    `,
    [normalizedUserID],
  );

  return result.rows
    .map((row) => Number(row.organizationid))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
};

// const resolveOpexAccess = async (
//   data = {},
//   queryable = pool,
//   { approvalAction = false } = {},
// ) => {
//   const jwtRole = String(data.UserType || "").trim().toUpperCase();
//   const departmentName = String(data.DepartmentName || "").trim();

//   if (jwtRole === "RD-FC") {
//     return {
//       error: fail(
//         "RD-FC OPEX access is assigned to the Organization 10 Finance HOD.",
//         403,
//       ),
//     };
//   }

//   if (jwtRole === "HOD" && !departmentName) {
//     return {
//       error: fail("Department information is required for HOD OPEX access.", 403),
//     };
//   }

//   const financeHod =
//     jwtRole === "HOD" && departmentName.toUpperCase() === "FINANCE";

//   const centralContext =
//     financeHod &&
//     (approvalAction ||
//       Number(data.OrganizationID ?? data.Filters?.OrganizationID) ===
//       CENTRAL_RDFC_ORGANIZATION_ID);
//   let centralizedRdfc = false;

//   if (centralContext) {
//     centralizedRdfc = await hasCentralRdfcMapping(queryable, data.UserID);

//     if (!centralizedRdfc && !approvalAction) {
//       return {
//         error: fail(
//           "You are not authorized as the centralized RD-FC approver.",
//           403,
//         ),
//       };
//     }
//   }

//   return {
//     jwtRole,
//     effectiveRole: centralizedRdfc ? "RD-FC" : financeHod ? "FC" : jwtRole,
//     departmentName,
//     departmentScope: jwtRole === "HOD" && !financeHod ? departmentName : null,
//     financeHod,
//     centralizedRdfc,
//   };
// };

const resolveOpexAccess = async (
  data = {},
  queryable = pool,
  { approvalAction = false } = {},
) => {
  const jwtRole = String(data.UserType || "").trim().toUpperCase();
  const departmentName = String(data.DepartmentName || "").trim();

  if (jwtRole === "RD-FC") {
    return {
      error: fail(
        "RD-FC OPEX access is assigned to the Organization 10 Finance HOD.",
        403,
      ),
    };
  }

  if (jwtRole === "HOD" && !departmentName) {
    return {
      error: fail(
        "Department information is required for HOD OPEX access.",
        403,
      ),
    };
  }

  const financeHod =
    jwtRole === "HOD" &&
    departmentName.toUpperCase() === "FINANCE";

  let centralizedRdfc = false;
  let rdfcMappedOrganizations = [];

  if (financeHod) {
    centralizedRdfc = await hasCentralRdfcMapping(
      queryable,
      data.UserID,
    );

    if (centralizedRdfc) {
      rdfcMappedOrganizations = await getRdfcMappedOrganizations(
        queryable,
        data.UserID,
      );
    }
  }

  /*
   * Organization 10 Finance HOD acts as RD-FC.
   *
   * Organization selection:
   * - Organization 10 -> global RD view, but only mapped organizations
   * - Specific mapped organization -> only that organization
   * - Specific unmapped organization -> no access
   */
  let selectedOrganizationID = null;

  if (
    data.OrganizationID !== undefined &&
    data.OrganizationID !== null &&
    String(data.OrganizationID).trim() !== ""
  ) {
    selectedOrganizationID = Number(data.OrganizationID);
  }

  if (centralizedRdfc && selectedOrganizationID !== null) {
    if (
      selectedOrganizationID !== CENTRAL_RDFC_ORGANIZATION_ID &&
      !rdfcMappedOrganizations.includes(selectedOrganizationID)
    ) {
      return {
        error: fail(
          "You are not authorized for the selected organization.",
          403,
        ),
      };
    }
  }

  return {
    jwtRole,

    effectiveRole: centralizedRdfc
      ? "RD-FC"
      : financeHod
        ? "FC"
        : jwtRole,

    departmentName,

    departmentScope:
      jwtRole === "HOD" && !financeHod
        ? departmentName
        : null,

    financeHod,
    centralizedRdfc,

    rdfcMappedOrganizations,

    selectedOrganizationID,
  };
};
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

    // // const firstApprovalRole = String(approvals[0]?.ApprovalRole || "").trim().toUpperCase();
    // const firstApprovalRole = String(
    //   approvals[0]?.ApprovalRole || ""
    // )
    //   .trim()
    //   .toUpperCase();

    // const createNotificationRoles =
    //   firstApprovalRole === "HOD" &&
    //     String(data.Department || "").trim().toUpperCase() === "FINANCE"
    //     ? ["GM"]
    //     : firstApprovalRole
    //       ? [firstApprovalRole]
    //       : [];

    // // notifyCommittedOpex({
    // //   organizationID: data.OrganizationID, opexID: OpexID,
    // //   department: data.Department, roles: firstApprovalRole ? [firstApprovalRole] : [],
    // //   directUserIds: [], kind: "CREATE", item: data.Item, qty: data.Qty,
    // //   rate: data.Rate, total, description: data.Description, action: "CREATED"
    // // });
    // notifyCommittedOpex({
    //   organizationID: data.OrganizationID,
    //   opexID: OpexID,
    //   department: data.Department,
    //   roles: createNotificationRoles,
    //   directUserIds: [],
    //   kind: "CREATE",
    //   item: data.Item,
    //   qty: data.Qty,
    //   description: data.Description,
    //   action: "CREATED",
    // });

    const firstApprovalRole = String(
      approvals[0]?.ApprovalRole || "",
    ).trim().toUpperCase();

    const isFinanceOpex =
      String(data.Department || "").trim().toUpperCase() === "FINANCE";

    const creatorIsFinanceHod =
      isFinanceOpex &&
      await isFinanceHodCreator(data.CreatedBy, data.OrganizationID);

    const createNotificationExcludeUserID =
      creatorIsFinanceHod ? data.CreatedBy : null;

    notifyCommittedOpex({
      organizationID: data.OrganizationID,
      opexID: OpexID,
      department: data.Department,
      roles: firstApprovalRole ? [firstApprovalRole] : [],
      directUserIds: [],
      excludeUserID: createNotificationExcludeUserID,
      actorUserID: data.CreatedBy,
      kind: "CREATE",
      item: data.Item,
      qty: data.Qty,
      rate: data.Rate,
      total,
      description: data.Description,
      action: "CREATED",
    });

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
      ) <> 'APPROVED'

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
  ApprovedQuantity:
    row.approvedquantity === null || row.approvedquantity === undefined
      ? null
      : Number(row.approvedquantity),
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
            WHEN 'HOD' THEN ca.HODApprovedQuantity
            WHEN 'FC' THEN ca.FCApprovedQuantity
            WHEN 'GM' THEN ca.GMApprovedQuantity
            WHEN 'RD-FC' THEN ca.RDFCApprovedQuantity
            WHEN 'CEO' THEN ca.CEOApprovedQuantity
          END AS ApprovedQuantity,

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

// Approval-role default view is the union of every role-specific status tab:
// records currently pending at that role, plus records already acted on by it.
const appendOpexRoleStatusFilter = (
  query,
  params,
  userType,
  approverStatusColumn,
  approvalStatus,
  financeHod = false,
) => {
  // A Finance HOD normally acts as FC, but must first be able to see the
  // Finance OPEX while its configured current stage is HOD.
  if (userType === "FC" && financeHod && approvalStatus === "PENDING") {
    params.push(userType);
    const roleParameter = `$${params.length}`;
    return `${query}
      AND (
        (
          UPPER(BTRIM(COALESCE(approval_state.HODStatus, 'PENDING'))) = 'APPROVED'
          AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = ${roleParameter}
          AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
        )
        OR (
          UPPER(COALESCE(current_stage.ApprovalRole, '')) = 'HOD'
          AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
          AND UPPER(TRIM(cm.Department)) = 'FINANCE'
        )
      )
    `;
  }

  if (userType === "FC" && financeHod && !approvalStatus) {
    params.push(userType);
    const roleParameter = `$${params.length}`;
    return `${query}
      AND (
        (
          UPPER(BTRIM(COALESCE(approval_state.HODStatus, 'PENDING'))) = 'APPROVED'
          AND (
            (UPPER(COALESCE(current_stage.ApprovalRole, '')) = ${roleParameter}
              AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING')
            OR UPPER(COALESCE(approval_state.FCStatus, ''))
              IN ('APPROVED', 'REJECTED', 'HOLD', 'RETURNED')
          )
        )
        OR (
          UPPER(COALESCE(current_stage.ApprovalRole, '')) = 'HOD'
          AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
          AND UPPER(TRIM(cm.Department)) = 'FINANCE'
        )
      )
    `;
  }

  // FC must never see or act on an OPEX until the HOD stage is approved.
  // This applies to Pending/default as well as FC's historical status tabs.
  if (userType === "FC") {
    query = `${query}
      AND UPPER(BTRIM(COALESCE(approval_state.HODStatus, 'PENDING')))
          = 'APPROVED'
    `;
  }

  if (approvalStatus === "PENDING") {
    params.push(userType);
    return `${query}
      AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${params.length}
      AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
    `;
  }

  if (approvalStatus) {
    params.push(approvalStatus);
    return `${query}
      AND UPPER(COALESCE(${approverStatusColumn}, 'PENDING'))
          = $${params.length}
    `;
  }

  params.push(userType);
  return `${query}
    AND (
      (
        UPPER(COALESCE(current_stage.ApprovalRole, '')) = $${params.length}
        AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
      )
      OR UPPER(COALESCE(${approverStatusColumn}, ''))
           IN ('APPROVED', 'REJECTED', 'HOLD', 'RETURNED')
    )
  `;
};

// Normal users see the overall workflow result instead of a single approval
// role's column. A terminal action takes precedence over later pending stages.
const appendOpexUserStatusFilter = (query, params, approvalStatus) => {
  if (!approvalStatus) return query;

  const workflowStatusColumns = [
    "approval_state.HODStatus",
    "approval_state.FCStatus",
    "approval_state.GMStatus",
    "approval_state.RDFCStatus",
    "approval_state.CEOStatus",
    "approval_state.FinalStatus",
  ];
  const normalizedStatus = (column) =>
    `UPPER(BTRIM(COALESCE(${column}, '')))`;
  const hasTerminalStatus = workflowStatusColumns
    .map(
      (column) =>
        `${normalizedStatus(column)} IN ('REJECTED', 'HOLD', 'RETURNED')`,
    )
    .join(" OR ");

  if (["REJECTED", "HOLD", "RETURNED"].includes(approvalStatus)) {
    params.push(approvalStatus);
    const statusParameter = `$${params.length}`;
    const hasRequestedStatus = workflowStatusColumns
      .map((column) => `${normalizedStatus(column)} = ${statusParameter}`)
      .join(" OR ");

    return `${query}
      AND (${hasRequestedStatus})
    `;
  }

  if (approvalStatus === "APPROVED") {
    params.push(approvalStatus);
    return `${query}
      AND ${normalizedStatus("approval_state.FinalStatus")} = $${params.length}
      AND NOT (${hasTerminalStatus})
    `;
  }

  return `${query}
    AND current_stage.ApprovalRole IS NOT NULL
    AND ${normalizedStatus("current_stage.Status")} = 'PENDING'
    AND ${normalizedStatus("approval_state.FinalStatus")} <> 'APPROVED'
    AND NOT (${hasTerminalStatus})
  `;
};

const normalizeOptionalOpexDate = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const isValidOpexDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const appendOpexDateFilter = (query, params, fromDate, toDate) => {
  if (fromDate) {
    params.push(fromDate);
    query += `
      AND cm.CreatedDate >= $${params.length}::date
    `;
  }

  if (toDate) {
    params.push(toDate);
    query += `
      AND cm.CreatedDate < ($${params.length}::date + INTERVAL '1 day')
    `;
  }

  return query;
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

    const access = await resolveOpexAccess(data);
    if (access.error) return access.error;

    const userType = access.effectiveRole;
    const departmentName = access.departmentScope;
    const requestedDepartment =
      data.Department !== undefined &&
        data.Department !== null &&
        String(data.Department).trim() !== ""
        ? String(data.Department).trim()
        : null;
    const fromDate = normalizeOptionalOpexDate(data.FromDate);
    const toDate = normalizeOptionalOpexDate(data.ToDate);

    if (fromDate && !isValidOpexDate(fromDate)) {
      return fail("FromDate must be a valid date in YYYY-MM-DD format.", 400);
    }

    if (toDate && !isValidOpexDate(toDate)) {
      return fail("ToDate must be a valid date in YYYY-MM-DD format.", 400);
    }

    if (fromDate && toDate && fromDate > toDate) {
      return fail("FromDate cannot be greater than ToDate.", 400);
    }

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
      ${Opex_SELECT}
    `;

    const params = [];

    // =====================================================
    // Organization Filter
    // =====================================================

    // if (
    //   !access.centralizedRdfc &&
    //   data.OrganizationID !== null &&
    //   data.OrganizationID !== undefined
    // ) {
    //   params.push(data.OrganizationID);

    //   query += `
    //     AND cm.OrganizationID = $${params.length}
    //   `;
    // }
    if (access.centralizedRdfc) {
      const selectedOrganizationID =
        access.selectedOrganizationID;

      if (
        selectedOrganizationID !== null &&
        selectedOrganizationID !== CENTRAL_RDFC_ORGANIZATION_ID
      ) {
        params.push(selectedOrganizationID);

        query += `
      AND cm.OrganizationID = $${params.length}
    `;
      } else {
        /*
         * Organization 10 selection means:
         * show all organizations mapped to the RD.
         */
        params.push(access.rdfcMappedOrganizations);

        query += `
      AND cm.OrganizationID = ANY($${params.length}::int[])
    `;
      }
    } else if (
      data.OrganizationID !== null &&
      data.OrganizationID !== undefined
    ) {
      params.push(data.OrganizationID);

      query += `
    AND cm.OrganizationID = $${params.length}
  `;
    }

    // HOD visibility is restricted to the department stored in the JWT.
    if (departmentName) {
      params.push(departmentName);

      query += `
        AND LOWER(TRIM(cm.Department)) = LOWER(TRIM($${params.length}))
      `;
    }

    if (requestedDepartment) {
      params.push(requestedDepartment);
      query += `
        AND LOWER(TRIM(cm.Department)) = LOWER(TRIM($${params.length}))
      `;
    }

    query = appendOpexDateFilter(query, params, fromDate, toDate);

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
      query = appendOpexRoleStatusFilter(
        query,
        params,
        userType,
        approverStatusColumn,
        approvalStatus,
        access.financeHod,
      );
    } else if (userType === "USER") {
      query = appendOpexUserStatusFilter(query, params, approvalStatus);
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

    // if (
    //   !access.centralizedRdfc &&
    //   data.OrganizationID !== null &&
    //   data.OrganizationID !== undefined
    // ) {
    //   countParams.push(data.OrganizationID);

    //   countQuery += `
    //     AND cm.OrganizationID = $${countParams.length}
    //   `;
    // }
    if (access.centralizedRdfc) {
      const selectedOrganizationID =
        access.selectedOrganizationID;

      if (
        selectedOrganizationID !== null &&
        selectedOrganizationID !== CENTRAL_RDFC_ORGANIZATION_ID
      ) {
        countParams.push(selectedOrganizationID);

        countQuery += `
      AND cm.OrganizationID = $${countParams.length}
    `;
      } else {
        countParams.push(access.rdfcMappedOrganizations);

        countQuery += `
      AND cm.OrganizationID = ANY($${countParams.length}::int[])
    `;
      }
    } else if (
      data.OrganizationID !== null &&
      data.OrganizationID !== undefined
    ) {
      countParams.push(data.OrganizationID);

      countQuery += `
    AND cm.OrganizationID = $${countParams.length}
  `;
    }

    if (departmentName) {
      countParams.push(departmentName);

      countQuery += `
        AND LOWER(TRIM(cm.Department)) = LOWER(TRIM($${countParams.length}))
      `;
    }

    if (requestedDepartment) {
      countParams.push(requestedDepartment);
      countQuery += `
        AND LOWER(TRIM(cm.Department)) = LOWER(TRIM($${countParams.length}))
      `;
    }

    countQuery = appendOpexDateFilter(
      countQuery,
      countParams,
      fromDate,
      toDate,
    );

    // =====================================================
    // COUNT STATUS FILTER
    // =====================================================

    if (approverStatusColumn) {
      countQuery = appendOpexRoleStatusFilter(
        countQuery,
        countParams,
        userType,
        approverStatusColumn,
        approvalStatus,
        access.financeHod,
      );
    } else if (userType === "USER") {
      countQuery = appendOpexUserStatusFilter(
        countQuery,
        countParams,
        approvalStatus,
      );
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
    // OPEX Fields
    // OrganizationID and OpexNumber are not updated
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
    // Update OPEX
    // ============================================================

    values.push(data.OpexID);

    const opexIDParameter = values.length;

    const updateResult = await client.query(
      `
      UPDATE Opex_Master
      SET ${assignments.join(", ")}
      WHERE OpexID = $${opexIDParameter}
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
    // OPEX Not Found
    // ============================================================

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return fail("OPEX record not found.", 404);
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
    // Document with OpexDocumentID:
    //   Existing document, so it remains unchanged
    //
    // Document without OpexDocumentID:
    //   New document, so it will be inserted
    //
    // Existing document missing from Documents:
    //   Soft deleted
    // ============================================================

    if (data.Documents !== undefined) {
      if (
        data.Documents !== null &&
        !Array.isArray(data.Documents)
      ) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return fail("Documents must be an array or null.", 400);
      }

      const incomingDocuments = Array.isArray(data.Documents)
        ? data.Documents
        : [];

      const opexInfo = updateResult.rows[0];
      const opexNumber = Number(opexInfo.opexnumber);

      // ==========================================================
      // Get Current Active Documents
      // ==========================================================

      const existingDocumentsResult = await client.query(
        `
        SELECT
          OpexDocumentID,
          FileName,
          FilePath,
          FileType,
          FileSize
        FROM Opex_Documents
        WHERE OpexID = $1
          AND IsDeleted = FALSE
        FOR UPDATE;
        `,
        [data.OpexID],
      );

      const existingDocuments = existingDocumentsResult.rows;

      const existingDocumentIDs = new Set(
        existingDocuments.map((document) =>
          String(document.opexdocumentid),
        ),
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

          return fail("Invalid OPEX document data.", 400);
        }

        const hasDocumentID =
          document.OpexDocumentID !== undefined &&
          document.OpexDocumentID !== null &&
          String(document.OpexDocumentID).trim() !== "";

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
            String(document.OpexDocumentID),
          ),
        ),
      ];

      const invalidDocumentID = receivedExistingDocumentIDs.find(
        (documentID) => !existingDocumentIDs.has(documentID),
      );

      if (invalidDocumentID) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return fail(
          "One or more existing OPEX documents are invalid.",
          400,
        );
      }

      // ==========================================================
      // Soft Delete Missing Existing Documents
      //
      // Documents null or []:
      // All current documents will be deleted.
      // ==========================================================

      const receivedDocumentIDSet = new Set(
        receivedExistingDocumentIDs,
      );

      const documentIDsToDelete = existingDocuments
        .filter(
          (document) =>
            !receivedDocumentIDSet.has(
              String(document.opexdocumentid),
            ),
        )
        .map((document) => document.opexdocumentid);

      if (documentIDsToDelete.length > 0) {
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
          [
            data.UserID,
            data.OpexID,
            documentIDsToDelete,
          ],
        );
      }

      // ==========================================================
      // Existing FilePaths That Will Remain Active
      // ==========================================================

      const activeFilePaths = new Set(
        existingDocuments
          .filter((document) =>
            receivedDocumentIDSet.has(
              String(document.opexdocumentid),
            ),
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

          return fail(
            "FileName is required for new OPEX documents.",
            400,
          );
        }

        if (
          document.FilePath === undefined ||
          document.FilePath === null ||
          String(document.FilePath).trim() === ""
        ) {
          await client.query("ROLLBACK");
          transactionStarted = false;

          return fail(
            "FilePath is required for new OPEX documents.",
            400,
          );
        }

        const filePath = String(document.FilePath).trim();

        // Do not insert the same file path again
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
          "Opex_Documents",
          "OpexDocumentID",
          uniqueNewDocuments.length,
        );

        for (
          let index = 0;
          index < uniqueNewDocuments.length;
          index += 1
        ) {
          const document = uniqueNewDocuments[index];

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
              opexNumber,
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
      message: "OPEX updated successfully.",
    };
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
      transactionStarted = false;
    }

    console.error("Update OPEX Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    if (error.code === "23503") {
      return fail("Invalid OPEX related data.", 400);
    }

    if (error.code === "23505") {
      return fail(
        "OPEX organization number or document already exists.",
        409,
      );
    }

    if (error.code === "22P02") {
      return fail("Invalid OPEX or document ID.", 400);
    }

    return fail("Unable to update OPEX at this time.", 500);
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

    const access = await resolveOpexAccess(data, pool, { approvalAction: true });
    if (access.error) return access.error;

    let approverRole = access.effectiveRole;

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
      return fail("Invalid Opex approval action.", 400);
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
        cm.CreatedBy,
        cm.Department,
        cm.Item,
        cm.Qty,
        cm.Rate,
        cm.Total,
        cm.Description,
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

    // Finance HOD and FC are the same user for Finance department OPEX.
    // When the current stage is HOD, this Finance HOD must act as HOD first.
    // FC will be auto-approved in the APPROVE flow below.
    const isFinanceOpexSameUser = (
      access.financeHod === true &&
      String(Opex.department || "").trim().toUpperCase() === "FINANCE"
    );

    if (isFinanceOpexSameUser && currentStage.role === "HOD") {
      approverRole = "HOD";
    }

    // Finance HOD is the effective HOD only for its own Finance OPEX while
    // that configured stage is current. Later FC/RD-FC stages remain unchanged.
    if (
      access.financeHod &&
      currentRole === "HOD" &&
      String(Opex.department || "").trim().toUpperCase() === "FINANCE"
    ) {
      approverRole = "HOD";
    }

    // Build one notification from the locked OPEX row and effective configured stage.
    const notifyApprovalCommitted = ({ kind, notificationAction, roles = [],
      includeCreator = false, excludeActor = false, actionDate: committedActionDate }) => notifyCommittedOpex({
        organizationID: Opex.organizationid, opexID: Opex.opexid,
        department: Opex.department, roles,
        directUserIds: includeCreator ? [Opex.createdby] : [],
        excludeUserID: excludeActor ? data.UserID : null, actorUserID: data.UserID,
        kind, item: Opex.item, qty: Opex.qty, rate: Opex.rate, total: Opex.total,
        description: Opex.description, actionQuantity: approvedQuantity, remark: remarks,
        actionDate: committedActionDate,
        approverRole, action: notificationAction,
      });

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
      AND IsDeleted = FALSE
    RETURNING HODStatusDateTime AS ActionDate;
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
      AND IsDeleted = FALSE
    RETURNING FCStatusDateTime AS ActionDate;
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
      AND IsDeleted = FALSE
    RETURNING GMStatusDateTime AS ActionDate;
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
      AND IsDeleted = FALSE
    RETURNING RDFCStatusDateTime AS ActionDate;
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
      AND IsDeleted = FALSE
    RETURNING CEOStatusDateTime AS ActionDate;
  `;
          break;

        default:
          throw new Error(`Unsupported approval role: ${role}`);
      }

      const result = await client.query(query, params);
      return result.rows[0]?.actiondate || null;
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

      const committedActionDate = await updateRoleApproval(
        approverRole,
        "Approved",
        data.UserID,
        remarks,
        approvedQuantity,
      );

      // ----------------------------------------------------------
      // Find next stage
      // ----------------------------------------------------------

      // const followingStage = stages[currentIndex + 1];
      // ----------------------------------------------------------
      // Find next stage
      // ----------------------------------------------------------

      const followingStage = stages[currentIndex + 1];

      // ----------------------------------------------------------
      // FINANCE HOD + FC SAME USER
      //
      // For Finance OPEX:
      // HOD approval automatically approves FC.
      // The workflow then moves directly to GM.
      // No separate FC approval/notification.
      // ----------------------------------------------------------

      const autoApproveFinanceFC =
        isFinanceOpexSameUser &&
        approverRole === "HOD" &&
        followingStage?.role === "FC";

      if (autoApproveFinanceFC) {
        await updateRoleApproval(
          "FC",
          "Approved",
          data.UserID,
          null,
          approvedQuantity,
        );
      }

      // If FC was auto-approved, skip FC and move to the next stage.
      // Normally this will be GM.
      const nextStage = autoApproveFinanceFC
        ? stages[currentIndex + 2]
        : followingStage;



      // ----------------------------------------------------------
      // NEXT APPROVAL EXISTS
      // ----------------------------------------------------------

      if (nextStage) {
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

        notifyApprovalCommitted({
          kind: "APPROVE", notificationAction: "APPROVED",
          roles: [nextStage.role], excludeActor: true,
          actionDate: committedActionDate
        });

        return {
          success: true,

          message: "Opex approved successfully.",

          // data: {
          //   OpexID: Number(Opex.Opexid),

          //   OpexNumber: Number(Opex.Opexnumber),

          //   CurrentStatus: "Pending",

          //   CurrentApprovalRole: nextStage.role,

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

      notifyApprovalCommitted({
        kind: "APPROVE", notificationAction: "APPROVED",
        excludeActor: true, actionDate: committedActionDate
      });

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
      const committedActionDate = await updateRoleApproval(
        approverRole,
        "Rejected",
        data.UserID,
        remarks,
        approvedQuantity,
      );

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

      notifyApprovalCommitted({
        kind: "REJECT", notificationAction: "REJECTED",
        roles: [approverRole], includeCreator: true, excludeActor: true,
        actionDate: committedActionDate
      });

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

      const committedActionDate = await updateRoleApproval(
        approverRole,
        "Returned",
        data.UserID,
        remarks,
        approvedQuantity,
      );

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

      notifyApprovalCommitted({
        kind: "RETURN", notificationAction: "RETURNED",
        roles: [approverRole], includeCreator: true, excludeActor: true,
        actionDate: committedActionDate
      });

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

      const committedActionDate = await updateRoleApproval(
        approverRole,
        "Hold",
        data.UserID,
        remarks,
        approvedQuantity,
      );

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

      notifyApprovalCommitted({
        kind: "HOLD", notificationAction: "HOLD",
        roles: [currentRole], includeCreator: true, excludeActor: true,
        actionDate: committedActionDate
      });

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
          UPPER(COALESCE(ca.HODStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.FCStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.GMStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.RDFCStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.CEOStatus, '')) = 'REJECTED'
          OR UPPER(COALESCE(ca.FinalStatus, '')) = 'REJECTED'
        THEN 'Rejected'

        -- ====================================================
        -- 3. HOLD
        -- ====================================================
        WHEN
          UPPER(COALESCE(ca.HODStatus, '')) = 'HOLD'
          OR UPPER(COALESCE(ca.FCStatus, '')) = 'HOLD'
          OR UPPER(COALESCE(ca.GMStatus, '')) = 'HOLD'
          OR UPPER(COALESCE(ca.RDFCStatus, '')) = 'HOLD'
          OR UPPER(COALESCE(ca.CEOStatus, '')) = 'HOLD'
          OR UPPER(COALESCE(ca.FinalStatus, '')) = 'HOLD'
        THEN 'Hold'

        -- ====================================================
        -- 4. RETURNED
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
        -- 5. FINALLY APPROVED
        -- ====================================================
        WHEN UPPER(COALESCE(ca.FinalStatus, '')) = 'APPROVED'
        THEN 'Approved'

        -- ====================================================
        -- 6. OTHERWISE PENDING
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
const departmentReportParameters = (data) => {
  const filters = data.Filters || data || {};
  const department =
    filters.Department !== undefined &&
      filters.Department !== null &&
      String(filters.Department).trim() !== ""
      ? String(filters.Department).trim()
      : null;

  return [
    filters.OrganizationID ?? null,
    department,
    normalizeOptionalOpexDate(filters.FromDate),
    normalizeOptionalOpexDate(filters.ToDate),
  ];
};
const organizationReportParameters = (data) => {
  const filters = data.Filters || data || {};
  return [
    filters.OrganizationID ?? null,
    normalizeOptionalOpexDate(filters.FromDate),
    normalizeOptionalOpexDate(filters.ToDate),
  ];
};
const validateOpexReportDates = (data) => {
  const filters = data.Filters || data || {};
  const fromDate = normalizeOptionalOpexDate(filters.FromDate);
  const toDate = normalizeOptionalOpexDate(filters.ToDate);

  if (fromDate && !isValidOpexDate(fromDate)) {
    return fail("FromDate must be a valid date in YYYY-MM-DD format.", 400);
  }
  if (toDate && !isValidOpexDate(toDate)) {
    return fail("ToDate must be a valid date in YYYY-MM-DD format.", 400);
  }
  if (fromDate && toDate && fromDate > toDate) {
    return fail("FromDate cannot be greater than ToDate.", 400);
  }

  return null;
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
    const access = await resolveOpexAccess(data);
    if (access.error) return access.error;

    const UserType = access.effectiveRole;
    const DepartmentName = access.departmentScope;

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
          UPPER(COALESCE(current_stage.Status, 'PENDING')) AS CurrentStageStatus,

          -- Keep the summary aligned with list visibility: a property Finance
          -- HOD also owns Finance OPEX while its configured HOD stage is pending.
          ($5::boolean = TRUE
            AND UPPER(TRIM(cm.Department)) = 'FINANCE'
            AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = 'HOD'
            AND UPPER(COALESCE(current_stage.Status, 'PENDING')) = 'PENDING'
            AND UPPER(COALESCE(ca.FinalStatus, 'PENDING')) = 'PENDING'
          ) AS FinanceHodPending

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

        WHERE ($4::boolean = TRUE OR cm.OrganizationID = $1)
          AND cm.IsDeleted = FALSE
          AND (
            $2::text <> 'HOD'
            OR LOWER(TRIM(cm.Department)) = LOWER(TRIM($3::text))
          )
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
            WHEN FinanceHodPending THEN 'Pending'
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
           OR FinanceHodPending
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
      [OrganizationID, UserType, DepartmentName || null, access.centralizedRdfc,
        access.financeHod && !access.centralizedRdfc],
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
    HoldCount: Number(row.holdcount),
    ReturnedCount: Number(row.returnedcount),
  }));
// ============================================================ Department Report
const getOpexDepartmentReport = async (data) => {
  try {
    const dateValidationError = validateOpexReportDates(data);
    if (dateValidationError) return dateValidationError;

    const result = await pool.query(
      `${REPORT_DATA_CTE}
       SELECT
         COALESCE(Department, 'Unspecified') AS Department,
         COUNT(*)::bigint AS Count,
         COALESCE(SUM(Total), 0) AS TotalAmount,
         COUNT(*) FILTER (WHERE Status = 'Approved')::bigint AS ApprovedCount,
         COUNT(*) FILTER (WHERE Status = 'Pending')::bigint AS PendingCount,
         COUNT(*) FILTER (WHERE Status = 'Rejected')::bigint AS RejectedCount,
         COUNT(*) FILTER (WHERE Status = 'Hold')::bigint AS HoldCount,
         COUNT(*) FILTER (WHERE Status = 'Returned')::bigint AS ReturnedCount
       FROM Opex_data
       WHERE (
         $2::text IS NULL
         OR LOWER(TRIM(COALESCE(Department, 'Unspecified')))
            = LOWER(TRIM($2::text))
       )
         AND ($3::date IS NULL OR CreatedDate >= $3::date)
         AND (
           $4::date IS NULL
           OR CreatedDate < ($4::date + INTERVAL '1 day')
         )
       GROUP BY COALESCE(Department, 'Unspecified')
       ORDER BY COALESCE(Department, 'Unspecified') ASC;`,
      departmentReportParameters(data),
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
    const dateValidationError = validateOpexReportDates(data);
    if (dateValidationError) return dateValidationError;

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
           WHERE cm.Status = 'Hold'
         )::bigint AS HoldCount,

         COUNT(*) FILTER (
           WHERE cm.Status = 'Returned'
         )::bigint AS ReturnedCount

       FROM Opex_data cm

       LEFT JOIN Organization_Master om
         ON om.OrganizationID = cm.OrganizationID
         AND om.IsDeleted = FALSE

       WHERE ($2::date IS NULL OR cm.CreatedDate >= $2::date)
         AND (
           $3::date IS NULL
           OR cm.CreatedDate < ($3::date + INTERVAL '1 day')
         )

       GROUP BY
         cm.OrganizationID,
         om.ShortName

       ORDER BY
         cm.OrganizationID ASC;`,
      organizationReportParameters(data),
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
        HoldCount: Number(row.holdcount),
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
// ============================================================Opex List PDF
const generateLegacyOpexDetailPdf = async (Opex) => {
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
const generateOpexListPdf = async (data) => {
  try {
    const rows = [];
    const exportPageSize = 1000;
    let page = 1;
    let totalPages = 1;

    do {
      const response = await getAllOpex({
        ...data,
        page,
        PageSize: exportPageSize,
      });

      if (!response.success) return response;

      rows.push(...response.data);
      totalPages = response.TotalPages;
      page += 1;
    } while (page <= totalPages);

    const access = await resolveOpexAccess(data);
    if (access.error) return access.error;

    const organizationId = Number(data.OrganizationID);
    let organizationName = data.OrganizationName || null;

    if (
      !organizationName &&
      Number.isSafeInteger(organizationId) &&
      organizationId > 0
    ) {
      const organizationResult = await pool.query(
        `
        SELECT OrganizationName
        FROM Organization_Master
        WHERE OrganizationID = $1
          AND IsDeleted = FALSE
        LIMIT 1;
        `,
        [organizationId],
      );

      organizationName = organizationResult.rows[0]?.organizationname || null;
    }

    const formatFilterDate = (value) =>
      value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
        ? formatDate(value)
        : "All";

    const pdfRows = rows.map((row, index) => ({
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
        `Qty - ${approval.ApprovedQuantity === null ||
          approval.ApprovedQuantity === undefined
          ? "-"
          : approval.ApprovedQuantity
        }`,
      );
      if (approval.Remarks) details.push(approval.Remarks);
      return details.join("\n");
    };

    // Build approval columns from the configured flow returned with the OPEX
    // records. Preserve workflow order and include each role only once.
    const approvalRoles = [];
    const approvalRoleSet = new Set();

    for (const row of rows) {
      for (const approval of row.Approvals || []) {
        const role = String(approval.ApprovalRole || "").trim().toUpperCase();

        if (role && !approvalRoleSet.has(role)) {
          approvalRoleSet.add(role);
          approvalRoles.push(role);
        }
      }
    }
    const pdfBuffer = await generatePdf({
      title: "OPEX LIST REPORT",
      reportName: "OPEX List Report",
      organizationId: data.OrganizationID || null,
      orientation: "landscape",
      metadata: [
        {
          label: "Organization",
          value: organizationName || "All",
        },
        {
          label: "Department",
          value: data.Department || access.departmentScope || "All",
        },
        {
          label: "From Date",
          value: formatFilterDate(data.FromDate),
        },
        {
          label: "To Date",
          value: formatFilterDate(data.ToDate),
        },
        {
          label: "Status",
          value: data.Status || "All",
        },
        { label: "Total Records", value: rows.length },
      ],
      columns: [
        {
          header: "#",
          value: (row) => row.ExportSerialNumber,
          width: 24,
          align: "left",
        },
        {
          key: "OrganizationShortName",
          header: "HTL",
          width: 38
        },
        {
          key: "Department",
          header: "DEPT",
          width: 50,
        },
        {
          header: "ITEM",
          value: (row) =>
            [row.Item, row.Description]
              .filter(
                (value) =>
                  value !== null &&
                  value !== undefined &&
                  String(value).trim() !== "",
              )
              .join("\n") || "-",
          width: "*",
        },
        {
          key: "Qty",
          header: "QTY",
          width: 32,
          align: "left",
        },
        {
          header: "RATE",
          value: (row) =>
            Number(row.Rate || 0).toLocaleString("en-IN", {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            }),
          width: 52,
          align: "left",
        },
        {
          header: "TOTAL",
          value: (row) =>
            Number(row.Total || 0).toLocaleString("en-IN", {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            }),
          width: 70,
          align: "left",
        },
        ...approvalRoles.map((role) => ({
          header: role,
          value: (row) => approvalValue(row, role),
          width: 75,
          align: "left",
        })),
      ],
      rows: pdfRows,
      pageMargins: [20, 25, 20, 35],
    });

    return {
      success: true,
      message: "OPEX list PDF generated successfully.",
      data: pdfBuffer,
      fileName: `OPEX_List_Report_${Date.now()}.pdf`,
      contentType: "application/pdf",
    };
  } catch (error) {
    console.error("Generate OPEX List PDF Error:", error.message);
    return fail("Unable to generate OPEX list PDF.", 503);
  }
};
// ============================================================ Department Report Pdf
const getOpexDepartmentReportPdf = async (data) => {
  try {
    const dateValidationError = validateOpexReportDates(data);
    if (dateValidationError) return dateValidationError;

    // Same query as OPEX Department Report GET API
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
           WHERE Status = 'Hold'
         )::bigint AS HoldCount,

         COUNT(*) FILTER (
           WHERE Status = 'Returned'
         )::bigint AS ReturnedCount

       FROM Opex_data

       WHERE (
         $2::text IS NULL
         OR LOWER(TRIM(COALESCE(Department, 'Unspecified')))
            = LOWER(TRIM($2::text))
       )
         AND ($3::date IS NULL OR CreatedDate >= $3::date)
         AND (
           $4::date IS NULL
           OR CreatedDate < ($4::date + INTERVAL '1 day')
         )

       GROUP BY COALESCE(Department, 'Unspecified')

       ORDER BY COALESCE(Department, 'Unspecified') ASC;`,
      departmentReportParameters(data),
    );

    const rows = result.rows;

    // ============================================================
    // Generate PDF
    // ============================================================

    const pdfBuffer = await generatePdf({
      title: "OPEX Department Report",
      reportName: "OPEX Department Report",

      organizationId:
        data?.Filters?.OrganizationID ||
        data?.OrganizationID ||
        null,

      orientation: "landscape",

      metadata: [
        {
          label: "Department",
          value: data?.Filters?.Department || data?.Department || "All",
        },
        {
          label: "From Date",
          value: data?.Filters?.FromDate
            ? formatDate(data.Filters.FromDate)
            : data?.FromDate
              ? formatDate(data.FromDate)
              : "All",
        },
        {
          label: "To Date",
          value: data?.Filters?.ToDate
            ? formatDate(data.Filters.ToDate)
            : data?.ToDate
              ? formatDate(data.ToDate)
              : "All",
        },
        {
          label: "Total Departments",
          value: rows.length,
        },
      ],

      columns: [
        {
          header: "Department",
          key: "department",
          width: 100,
          align: "center",
        },
        {
          header: "Total Count",
          key: "count",
          width: 100,
          align: "center",
        },


        {
          header: "Approved",
          key: "approvedcount",
          width: 100,
          align: "center",
        },
        {
          header: "Pending",
          key: "pendingcount",
          width: 100,
          align: "center",
        },
        {
          header: "Rejected",
          key: "rejectedcount",
          width: 100,
          align: "center",
        },

        {
          header: "Returned",
          key: "returnedcount",
          width: 100,
          align: "center",
        },
        {
          header: "Hold",
          key: "holdcount",
          width: 100,
          align: "center",
        },
      ],

      rows,
    });

    // ============================================================
    // Response
    // ============================================================

    return {
      success: true,
      message: "OPEX department report PDF generated successfully.",
      pdfBuffer,
      fileName: "OPEX_Department_Report.pdf",
    };
  } catch (error) {
    console.error("OPEX Department Report PDF Error:", error);

    return {
      success: false,
      message: "Unable to generate OPEX department report PDF.",
      statusCode: 500,
    };
  }
};
// ============================================================ Organization Report pdf
const getOpexOrganizationReportPdf = async (data) => {
  try {
    const dateValidationError = validateOpexReportDates(data);
    if (dateValidationError) return dateValidationError;

    // Same query as OPEX Organization Report GET API
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
           WHERE cm.Status = 'Hold'
         )::bigint AS HoldCount,

         COUNT(*) FILTER (
           WHERE cm.Status = 'Returned'
         )::bigint AS ReturnedCount

       FROM Opex_data cm

       LEFT JOIN Organization_Master om
         ON om.OrganizationID = cm.OrganizationID
         AND om.IsDeleted = FALSE

       WHERE ($2::date IS NULL OR cm.CreatedDate >= $2::date)
         AND (
           $3::date IS NULL
           OR cm.CreatedDate < ($3::date + INTERVAL '1 day')
         )

       GROUP BY
         cm.OrganizationID,
         om.ShortName

       ORDER BY
         cm.OrganizationID ASC;`,
      organizationReportParameters(data),
    );

    const rows = result.rows.map((row) => ({
      organizationid: Number(row.organizationid),
      shortname: row.shortname || "Unspecified",
      count: Number(row.count || 0),
      totalamount: Number(row.totalamount || 0),
      approvedcount: Number(row.approvedcount || 0),
      pendingcount: Number(row.pendingcount || 0),
      rejectedcount: Number(row.rejectedcount || 0),
      holdcount: Number(row.holdcount || 0),
      returnedcount: Number(row.returnedcount || 0),
    }));

    // ============================================================
    // Generate PDF
    // ============================================================

    const pdfBuffer = await generatePdf({
      title: "OPEX Organization Report",
      reportName: "OPEX Organization Report",

      organizationId: data.OrganizationID || null,

      orientation: "landscape",

      metadata: [
        {
          label: "From Date",
          value: data.FromDate ? formatDate(data.FromDate) : "All",
        },
        {
          label: "To Date",
          value: data.ToDate ? formatDate(data.ToDate) : "All",
        },

      ],

      columns: [

        {
          header: "Organization",
          key: "shortname",
          width: 100,
          align: "center",
        },
        {
          header: "Total Count",
          key: "count",
          width: 100,
          align: "center",
        },

        {
          header: "Approved",
          key: "approvedcount",
          width: 100,
          align: "center",
        },
        {
          header: "Pending",
          key: "pendingcount",
          width: 100,
          align: "center",
        },
        {
          header: "Rejected",
          key: "rejectedcount",
          width: 100,
          align: "center",
        },

        {
          header: "Returned",
          key: "returnedcount",
          width: 100,
          align: "center",
        },
        {
          header: "Hold",
          key: "holdcount",
          width: 100,
          align: "center",
        },
      ],

      rows,
    });

    return {
      success: true,
      message: "OPEX organization report PDF generated successfully.",
      pdfBuffer,
      fileName: "OPEX_Organization_Report.pdf",
    };
  } catch (error) {
    console.error("OPEX Organization Report PDF Error:", error);

    return {
      success: false,
      message: "Unable to generate OPEX organization report PDF.",
      statusCode: 500,
    };
  }
};
// ============================================================SINGLE OPEX DETAIL PDF
// ====================OPEX SINGLE DETAIL PDF HELPERS
const formatOpexAmount = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "0.00";
  }

  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};
const opexPdfValue = (value) => {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return "-";
  }

  return String(value);
};
const generateOpexByIdPdf = async (data) => {
  try {
    // ==========================================================
    // VALIDATE OPEX ID
    // ==========================================================

    const opexID = Number(data.OpexID);

    if (
      !Number.isInteger(opexID) ||
      opexID <= 0
    ) {
      return fail(
        "Valid OPEX ID is required.",
        400,
      );
    }

    // ==========================================================
    // FETCH OPEX
    // Same query as Get By ID API
    // ==========================================================

    const result = await pool.query(
      `
      ${Opex_SELECT}
      AND cm.OpexID = $1
      LIMIT 1;
      `,
      [opexID],
    );

    if (result.rows.length === 0) {
      return fail(
        "OPEX record not found.",
        404,
      );
    }

    // ==========================================================
    // ATTACH DOCUMENTS + APPROVALS
    // Same data as Get By ID API
    // ==========================================================

    const [opex] =
      await attachRelatedData(
        result.rows,
      );

    const approvals =
      Array.isArray(
        opex.Approvals,
      )
        ? opex.Approvals
        : [];

    // ==========================================================
    // COLORS
    // ==========================================================

    const COLORS = {
      mainHeader: "#082B5C",

      label: "#082B5C",

      value: "#172033",

      icon: "#0D3B7A",

      labelBackground:
        "#F4F6F9",

      tableHeaderBackground:
        "#F4F6F9",

      border: "#CFD7E3",

      white: "#FFFFFF",

      approved: "#15803D",

      approvedBackground:
        "#DCFCE7",

      pending: "#D97706",

      pendingBackground:
        "#FEF3C7",

      rejected: "#B91C1C",

      rejectedBackground:
        "#FEE2E2",

      returned: "#7C3AED",

      returnedBackground:
        "#EDE9FE",

      hold: "#B45309",

      holdBackground:
        "#FEF3C7",

      muted: "#64748B",
    };

    // ==========================================================
    // COMMON LABEL WIDTH
    // ==========================================================

    const LABEL_WIDTH = 90;

    // ==========================================================
    // LOGO + GENERATED DATE
    // ==========================================================

    const logo =
      await loadLogo(
        opex.OrganizationID,
      );

    const generatedOn =
      formatDate(
        new Date(),
        "DD MMM YYYY hh:mm A",
      );

    // ==========================================================
    // SVG ICONS
    // ==========================================================

    const fieldIcon = (
      type,
    ) => {
      const stroke =
        COLORS.icon;

      const line = (
        x1,
        y1,
        x2,
        y2,
        lineWidth = 1.25,
      ) => ({
        type: "line",

        x1,
        y1,
        x2,
        y2,

        lineWidth,

        lineColor:
          stroke,
      });

      const rect = (
        x,
        y,
        w,
        h,
        r = 0,
      ) => ({
        type: "rect",

        x,
        y,
        w,
        h,
        r,

        lineWidth: 1.25,

        lineColor:
          stroke,
      });

      const ellipse = (
        x,
        y,
        r1,
        r2 = r1,
      ) => ({
        type: "ellipse",

        x,
        y,
        r1,
        r2,

        lineWidth: 1.25,

        lineColor:
          stroke,
      });

      const icons = {
        // -----------------------------------------------
        // Organization
        // -----------------------------------------------

        organization: [
          rect(
            5,
            3,
            10,
            15,
            1,
          ),

          line(
            2,
            18,
            18,
            18,
          ),

          line(
            8,
            7,
            8,
            8,
          ),

          line(
            12,
            7,
            12,
            8,
          ),

          line(
            8,
            11,
            8,
            12,
          ),

          line(
            12,
            11,
            12,
            12,
          ),

          line(
            10,
            15,
            10,
            18,
          ),
        ],

        // -----------------------------------------------
        // OPEX Number
        // -----------------------------------------------

        opex: [
          rect(
            4,
            2,
            11,
            16,
            1,
          ),

          line(
            7,
            6,
            12,
            6,
          ),

          line(
            7,
            9,
            12,
            9,
          ),

          line(
            7,
            12,
            12,
            12,
          ),

          line(
            7,
            15,
            11,
            15,
          ),
        ],

        // -----------------------------------------------
        // Calendar
        // -----------------------------------------------

        calendar: [
          rect(
            2,
            4,
            16,
            14,
            1,
          ),

          line(
            2,
            8,
            18,
            8,
          ),

          line(
            6,
            2,
            6,
            6,
          ),

          line(
            14,
            2,
            14,
            6,
          ),

          line(
            6,
            11,
            8,
            11,
          ),

          line(
            11,
            11,
            13,
            11,
          ),

          line(
            6,
            14,
            8,
            14,
          ),

          line(
            11,
            14,
            13,
            14,
          ),
        ],

        // -----------------------------------------------
        // Department
        // -----------------------------------------------

        department: [
          ellipse(
            10,
            5,
            2.5,
          ),

          ellipse(
            4,
            7,
            2,
          ),

          ellipse(
            16,
            7,
            2,
          ),

          line(
            6,
            18,
            6,
            13,
          ),

          line(
            14,
            18,
            14,
            13,
          ),

          line(
            6,
            13,
            14,
            13,
          ),

          line(
            2,
            18,
            18,
            18,
          ),
        ],

        // -----------------------------------------------
        // Item
        // -----------------------------------------------

        item: [
          {
            type:
              "polyline",

            points: [
              {
                x: 2,
                y: 8,
              },

              {
                x: 9,
                y: 1,
              },

              {
                x: 18,
                y: 10,
              },

              {
                x: 10,
                y: 18,
              },

              {
                x: 2,
                y: 10,
              },
            ],

            closePath: true,

            lineWidth:
              1.25,

            lineColor:
              stroke,
          },

          ellipse(
            8,
            6,
            1.2,
          ),
        ],

        // -----------------------------------------------
        // Make
        // -----------------------------------------------

        make: [
          ellipse(
            10,
            10,
            5,
          ),

          ellipse(
            10,
            10,
            2,
          ),

          line(
            10,
            1,
            10,
            5,
          ),

          line(
            10,
            15,
            10,
            19,
          ),

          line(
            1,
            10,
            5,
            10,
          ),

          line(
            15,
            10,
            19,
            10,
          ),

          line(
            4,
            4,
            7,
            7,
          ),

          line(
            13,
            13,
            16,
            16,
          ),

          line(
            16,
            4,
            13,
            7,
          ),

          line(
            4,
            16,
            7,
            13,
          ),
        ],

        // -----------------------------------------------
        // Quantity
        // -----------------------------------------------

        quantity: [
          {
            type:
              "polyline",

            points: [
              {
                x: 10,
                y: 1,
              },

              {
                x: 18,
                y: 5,
              },

              {
                x: 10,
                y: 9,
              },

              {
                x: 2,
                y: 5,
              },
            ],

            closePath: true,

            lineWidth:
              1.25,

            lineColor:
              stroke,
          },

          line(
            2,
            5,
            2,
            14,
          ),

          line(
            18,
            5,
            18,
            14,
          ),

          line(
            2,
            14,
            10,
            19,
          ),

          line(
            18,
            14,
            10,
            19,
          ),

          line(
            10,
            9,
            10,
            19,
          ),
        ],

        // -----------------------------------------------
        // Rate
        // -----------------------------------------------

        rate: [
          line(
            5,
            3,
            15,
            3,
          ),

          line(
            5,
            7,
            15,
            7,
          ),

          line(
            8,
            3,
            8,
            17,
          ),

          line(
            8,
            7,
            16,
            18,
          ),

          line(
            8,
            7,
            11,
            7,
          ),
        ],

        // -----------------------------------------------
        // Total
        // -----------------------------------------------

        total: [
          ellipse(
            10,
            5,
            7,
            3,
          ),

          ellipse(
            10,
            10,
            7,
            3,
          ),

          ellipse(
            10,
            15,
            7,
            3,
          ),

          line(
            3,
            5,
            3,
            15,
          ),

          line(
            17,
            5,
            17,
            15,
          ),
        ],

        // -----------------------------------------------
        // Description
        // -----------------------------------------------

        description: [
          rect(
            4,
            2,
            12,
            16,
            1,
          ),

          line(
            7,
            7,
            13,
            7,
          ),

          line(
            7,
            10,
            13,
            10,
          ),

          line(
            7,
            13,
            12,
            13,
          ),
        ],
      };

      const iconScale =
        0.8;

      return (
        icons[type] ||
        icons.opex
      ).map(
        (shape) => {
          const scaledShape =
          {
            ...shape,

            lineWidth:
              (
                shape.lineWidth ||
                1
              ) *
              iconScale,
          };

          for (
            const coordinate of [
              "x",
              "y",

              "x1",
              "y1",

              "x2",
              "y2",

              "w",
              "h",

              "r",

              "r1",
              "r2",
            ]
          ) {
            if (
              typeof scaledShape[
              coordinate
              ] ===
              "number"
            ) {
              scaledShape[
                coordinate
              ] *=
                iconScale;
            }
          }

          if (
            Array.isArray(
              scaledShape.points,
            )
          ) {
            scaledShape.points =
              scaledShape.points.map(
                (
                  point,
                ) => ({
                  x:
                    point.x *
                    iconScale,

                  y:
                    point.y *
                    iconScale,
                }),
              );
          }

          return scaledShape;
        },
      );
    };

    // ==========================================================
    // LABEL CELL
    // ==========================================================

    const labelCell = (
      text,
      icon,
    ) => ({
      columns: [
        {
          width: 22,

          canvas:
            fieldIcon(
              icon,
            ),

          margin: [
            0,
            0,
            0,
            0,
          ],
        },

        {
          width: "*",

          text,

          style:
            "fieldLabel",

          margin: [
            3,
            3,
            0,
            0,
          ],
        },
      ],

      fillColor:
        COLORS.labelBackground,

      margin: [
        8,
        6,
        6,
        6,
      ],
    });

    // ==========================================================
    // VALUE CELL
    // ==========================================================

    const valueCell = (
      value,
    ) => ({
      text:
        opexPdfValue(
          value,
        ),

      style:
        "fieldValue",

      margin: [
        8,
        6,
        6,
        6,
      ],
    });

    // ==========================================================
    // TABLE BORDER
    // ==========================================================

    const borderedLayout = {
      hLineColor: () =>
        COLORS.border,

      vLineColor: () =>
        COLORS.border,

      hLineWidth: () =>
        0.7,

      vLineWidth: () =>
        0.7,

      paddingLeft: () =>
        0,

      paddingRight: () =>
        0,

      paddingTop: () =>
        0,

      paddingBottom: () =>
        0,
    };

    // ==========================================================
    // STATUS CELL
    // ==========================================================

    const statusCell = (
      statusValue,
    ) => ({
      text:
        opexPdfValue(
          statusValue,
        ),

      style:
        "approvalValue",

      margin: [
        4,
        5,
        4,
        5,
      ],
    });

    // ==========================================================
    // APPROVAL ROWS
    //
    // Dynamic:
    // HOD
    // FC
    // GM
    // RD-FC
    // CEO
    //
    // Whatever attachRelatedData returns will be displayed.
    // ==========================================================

    const approvalRows = [];

    approvals.forEach(
      (approval) => {
        if (
          approval.ApprovalRole ===
          undefined ||
          approval.ApprovalRole ===
          null ||
          String(
            approval.ApprovalRole,
          ).trim() === ""
        ) {
          return;
        }

        const approvalRole =
          String(
            approval.ApprovalRole,
          ).trim();

        const approvedQuantity =
          approval.ApprovedQuantity !==
            null &&
            approval.ApprovedQuantity !==
            undefined &&
            String(
              approval.ApprovedQuantity,
            ).trim() !== ""
            ? formatOpexAmount(
              approval.ApprovedQuantity,
            )
            : "-";

        approvalRows.push([
          // -----------------------------------------
          // Approval Role
          // -----------------------------------------

          {
            text:
              approvalRole,

            style:
              "approvalRole",

            margin: [
              4,
              5,
              4,
              5,
            ],
          },

          // -----------------------------------------
          // Status
          // -----------------------------------------

          statusCell(
            approval.Status,
          ),

          // -----------------------------------------
          // Approved Qty
          // -----------------------------------------

          {
            text:
              approvedQuantity,

            style:
              "approvalValue",

            margin: [
              4,
              5,
              4,
              5,
            ],
          },

          // -----------------------------------------
          // Remarks
          // -----------------------------------------

          {
            text:
              opexPdfValue(
                approval.Remarks,
              ),

            style:
              "approvalValue",

            margin: [
              4,
              5,
              4,
              5,
            ],
          },
        ]);
      },
    );

    // ==========================================================
    // NO APPROVAL DATA
    // ==========================================================

    if (
      approvalRows.length ===
      0
    ) {
      approvalRows.push([
        {
          text:
            "No approval details available",

          colSpan: 4,

          alignment:
            "center",

          color:
            COLORS.muted,

          margin: [
            0,
            7,
            0,
            7,
          ],
        },

        {},

        {},

        {},
      ]);
    }

    // ==========================================================
    // DOCUMENT DEFINITION
    // ==========================================================

    const documentDefinition = {
      pageSize: "A4",

      pageOrientation:
        "portrait",

      pageMargins: [
        22,
        26,
        22,
        72,
      ],

      defaultStyle: {
        font: "Roboto",

        fontSize: 9,

        color:
          COLORS.value,
      },

      content: [
        // ======================================================
        // HEADER
        // ======================================================

        {
          table: {
            widths: [
              130,
              "*",
            ],

            body: [
              [
                logo
                  ? {
                    image:
                      logo,

                    fit: [
                      102,
                      58,
                    ],

                    border: [
                      false,
                      false,
                      false,
                      false,
                    ],
                  }
                  : {
                    text: "",

                    border: [
                      false,
                      false,
                      false,
                      false,
                    ],
                  },

                {
                  text:
                    "OPEX Detail Report",

                  style:
                    "title",

                  alignment:
                    "center",

                  margin: [
                    0,
                    18,
                    80,
                    0,
                  ],

                  border: [
                    false,
                    false,
                    false,
                    false,
                  ],
                },
              ],
            ],
          },

          layout:
            "noBorders",
        },

        // ======================================================
        // HEADER LINE
        // ======================================================

        {
          canvas: [
            {
              type:
                "line",

              x1: 0,

              y1: 0,

              x2: 551,

              y2: 0,

              lineWidth:
                0.8,

              lineColor:
                COLORS.mainHeader,
            },
          ],

          margin: [
            0,
            7,
            0,
            18,
          ],
        },

        // ======================================================
        // ORGANIZATION + OPEX NUMBER
        // CREATED DATE + DEPARTMENT
        // ======================================================

        {
          table: {
            widths: [
              LABEL_WIDTH,
              "*",

              LABEL_WIDTH,
              "*",
            ],

            body: [
              // -----------------------------------------------
              // Organization + OPEX No.
              // -----------------------------------------------

              [
                labelCell(
                  "Organization",
                  "organization",
                ),

                valueCell(
                  opex.OrganizationShortName ||
                  opex.OrganizationID,
                ),

                labelCell(
                  "OPEX No.",
                  "opex",
                ),

                valueCell(
                  opex.OpexNumber,
                ),
              ],

              // -----------------------------------------------
              // Date + Department
              // -----------------------------------------------

              [
                labelCell(
                  "Created On",
                  "calendar",
                ),

                valueCell(
                  opex.CreatedDate,
                ),

                labelCell(
                  "Department",
                  "department",
                ),

                valueCell(
                  opex.Department,
                ),
              ],
            ],
          },

          layout:
            borderedLayout,

          margin: [
            0,
            0,
            0,
            0,
          ],
        },

        // ======================================================
        // ITEM + MAKE
        // ======================================================

        {
          table: {
            widths: [
              LABEL_WIDTH,
              "*",

              LABEL_WIDTH,
              "*",
            ],

            body: [
              [
                labelCell(
                  "Item",
                  "item",
                ),

                valueCell(
                  opex.Item,
                ),

                labelCell(
                  "Make",
                  "make",
                ),

                valueCell(
                  opex.Make,
                ),
              ],
            ],
          },

          layout:
            borderedLayout,

          margin: [
            0,
            0,
            0,
            0,
          ],
        },

        // ======================================================
        // QUANTITY + RATE + TOTAL
        // ======================================================

        {
          table: {
            widths: [
              LABEL_WIDTH,
              "*",

              LABEL_WIDTH,
              "*",

              LABEL_WIDTH,
              "*",
            ],

            body: [
              [
                // -------------------------------------------
                // Quantity
                // -------------------------------------------

                labelCell(
                  "Quantity",
                  "quantity",
                ),

                valueCell(
                  formatOpexAmount(
                    opex.Qty,
                  ),
                ),

                // -------------------------------------------
                // Rate
                // -------------------------------------------

                labelCell(
                  "Rate",
                  "rate",
                ),

                valueCell(
                  `INR ${formatOpexAmount(
                    opex.Rate,
                  )}`,
                ),

                // -------------------------------------------
                // Total
                // -------------------------------------------

                labelCell(
                  "Total",
                  "total",
                ),

                {
                  text:
                    `INR ${formatOpexAmount(
                      opex.Total,
                    )}`,

                  style:
                    "totalValue",

                  margin: [
                    8,
                    6,
                    6,
                    6,
                  ],
                },
              ],
            ],
          },

          layout:
            borderedLayout,

          // Quantity row ke upar aur niche gap
          margin: [
            0,
            8,
            0,
            8,
          ],
        },

        // ======================================================
        // DESCRIPTION
        // ======================================================

        {
          table: {
            widths: [
              LABEL_WIDTH,
              "*",
            ],

            body: [
              [
                labelCell(
                  "Description",
                  "description",
                ),

                {
                  text:
                    opexPdfValue(
                      opex.Description,
                    ),

                  style:
                    "descriptionValue",

                  margin: [
                    8,
                    6,
                    6,
                    6,
                  ],
                },
              ],
            ],
          },

          layout:
            borderedLayout,

          margin: [
            0,
            0,
            0,
            0,
          ],
        },

        // ======================================================
        // APPROVAL TABLE
        // ======================================================

        {
          table: {
            headerRows: 1,

            widths: [
              100,
              120,
              80,
              "*",
            ],

            body: [
              // -----------------------------------------------
              // Header
              // -----------------------------------------------

              [
                {
                  text:
                    "Approval",

                  style:
                    "tableHeader",
                },

                {
                  text:
                    "Status",

                  style:
                    "tableHeader",
                },

                {
                  text:
                    "Qty",

                  style:
                    "tableHeader",
                },

                {
                  text:
                    "Remarks",

                  style:
                    "tableHeader",
                },
              ],

              // -----------------------------------------------
              // Dynamic OPEX Approvals
              // -----------------------------------------------

              ...approvalRows,
            ],
          },

          layout: {
            hLineColor:
              () =>
                COLORS.border,

            vLineColor:
              () =>
                COLORS.border,

            hLineWidth:
              () =>
                0.7,

            vLineWidth:
              () =>
                0.7,

            fillColor:
              (
                rowIndex,
              ) =>
                rowIndex ===
                  0
                  ? COLORS.tableHeaderBackground
                  : COLORS.white,

            paddingLeft:
              () => 8,

            paddingRight:
              () => 8,

            paddingTop:
              () => 6,

            paddingBottom:
              () => 6,
          },

          // Description ke baad approval table gap
          margin: [
            0,
            12,
            0,
            5,
          ],
        },
      ],

      // ========================================================
      // FOOTER
      // ========================================================

      footer: () => ({
        margin: [
          22,
          8,
          22,
          0,
        ],

        stack: [
          // ----------------------------------------------------
          // Footer Line
          // ----------------------------------------------------

          {
            canvas: [
              {
                type:
                  "line",

                x1: 0,

                y1: 0,

                x2: 551,

                y2: 0,

                lineWidth:
                  0.7,

                lineColor:
                  COLORS.mainHeader,
              },
            ],

            margin: [
              0,
              0,
              0,
              8,
            ],
          },

          // ----------------------------------------------------
          // Footer Text
          // ----------------------------------------------------

          {
            columns: [
              {
                stack: [
                  {
                    text:
                      "Powered by HotelOps",

                    bold: true,

                    color:
                      COLORS.mainHeader,

                    fontSize:
                      8,
                  },
                ],
              },

              {
                width: 130,

                stack: [
                  {
                    text:
                      `Generated On   :  ${generatedOn}`,

                    fontSize:
                      7,

                    color:
                      COLORS.label,
                  },
                ],
              },
            ],
          },
        ],
      }),

      // ========================================================
      // STYLES
      // ========================================================

      styles: {
        title: {
          fontSize:
            18,

          bold:
            true,

          color:
            COLORS.mainHeader,
        },

        fieldLabel: {
          fontSize:
            9,

          bold:
            true,

          color:
            COLORS.label,
        },

        fieldValue: {
          fontSize:
            9,

          color:
            COLORS.value,
        },

        descriptionValue: {
          fontSize:
            9,

          lineHeight:
            1.25,

          color:
            COLORS.value,
        },

        totalValue: {
          fontSize:
            9,

          bold:
            true,

          color:
            COLORS.value,
        },

        tableHeader: {
          fontSize:
            9,

          bold:
            true,

          color:
            COLORS.label,

          fillColor:
            COLORS.tableHeaderBackground,

          margin: [
            3,
            2,
            3,
            2,
          ],
        },

        approvalRole: {
          fontSize:
            9,

          bold:
            true,

          color:
            COLORS.value,
        },

        approvalValue: {
          fontSize:
            9,

          color:
            COLORS.value,
        },
      },
    };

    // ==========================================================
    // CREATE PDF
    // ==========================================================

    const pdfBuffer =
      await new Promise(
        (
          resolve,
          reject,
        ) => {
          try {
            const pdfDocument =
              new PdfPrinter(
                OPEX_DETAIL_PDF_FONTS,
              ).createPdfKitDocument(
                documentDefinition,
              );

            const chunks = [];

            pdfDocument.on(
              "data",
              (
                chunk,
              ) =>
                chunks.push(
                  chunk,
                ),
            );

            pdfDocument.on(
              "end",
              () =>
                resolve(
                  Buffer.concat(
                    chunks,
                  ),
                ),
            );

            pdfDocument.on(
              "error",
              reject,
            );

            pdfDocument.end();
          } catch (error) {
            reject(error);
          }
        },
      );

    // ==========================================================
    // SUCCESS
    // ==========================================================

    return {
      success: true,

      message:
        "OPEX PDF generated successfully.",

      FileName:
        `OPEX-${opex.OpexNumber}.pdf`,

      ContentType:
        "application/pdf",

      PdfBuffer:
        pdfBuffer,
    };
  } catch (error) {
    console.error(
      "Generate OPEX PDF Service Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(
        error,
      );

    if (
      retryResponse
    ) {
      return retryResponse;
    }

    return fail(
      "Unable to generate OPEX PDF at this time.",
      500,
    );
  }
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
  getOpexDepartmentReportPdf,
  getOpexOrganizationReportPdf,
  generateOpexByIdPdf
};
