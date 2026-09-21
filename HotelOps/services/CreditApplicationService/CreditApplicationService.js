const { pool } = require("../../db");
const {retryableDatabaseResponse,} = require("../../utils/retryableDatabaseError");
const { formatDate } = require("../../utils/dateFormatter");
const generateUrl = require("../../AzurConfigration/CreditApplication/AzureGetData");
// ===============================================Pdf Helper
const { generatePdf, loadLogo } = require("../../utils/pdfHelper");
const PdfPrinter = require("pdfmake");
const path = require("path");
const EQUIPMENT_DETAIL_PDF_FONTS = {
  Roboto: {
    normal: path.join(process.cwd(), "fonts/Roboto-Regular.ttf"),
    bold: path.join(process.cwd(), "fonts/Roboto-Medium.ttf"),
    italics: path.join(process.cwd(), "fonts/Roboto-SemiBold.ttf"),
    bolditalics: path.join(process.cwd(), "fonts/Roboto-Bold.ttf"),
  },
};

// ===================== Response Helpers
const ok = (message, data, metadata) => ({
  success: true,
  message,
  ...(metadata !== undefined ? metadata : {}),
  ...(data !== undefined ? { data } : {}),
});
const fail = (message, statusCode = 400) => ({
  success: false,
  statusCode,
  message,
});
const databaseFailure = (error, action) => {
  console.error(`${action} Error:`, error.message);

  const retryResponse =
    retryableDatabaseResponse(error);

  if (retryResponse) {
    return retryResponse;
  }

  return {
    success: false,
    statusCode: 500,
    message: `Unable to ${action.toLowerCase()}.`,
  };
};
// ======================== Default Credit Application Approval Levels
const DEFAULT_CREDIT_APPLICATION_APPROVALS = Object.freeze([
  { LevelNo: 1, ApprovalRole: "FC" },
  { LevelNo: 2, ApprovalRole: "GM" },
]);
const CREDIT_APPLICATION_APPROVAL_ROLES = new Set([
  "FC",
  "GM",
]);
const normalizeCreditApplicationApprovalRole = (value) => {
  const role = String(value || "").trim().toUpperCase();
  return role === "FINANCE" ? "FC" : role;
};
// ============================================================ CREATE CREDIT APPLICATION
const createCreditApplication = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      OrganizationID,

      ApplicationDate,

      CompanyName,
      CompanyGSTIN,
      MSME,

      BusinessAddress,
      BillingAddress,

      AuthorisedPersonNamePosition,
      AuthorisedPersonMobileNo,
      AuthorisedPersonEmail,

      AccountsContactNamePosition,
      AccountsContactMobileNo,
      AccountsContactEmail,

      RecommendedBy,
      Position,

      CreditReferenceCheckedBy,
      CreditReferenceCheckedDate,

      CreditAmountAllowed,
      ExpectedBusinessFY,
      FinancialYear,

      Documents,

      UserID,
    } = data;


    // ============================================================
    // Insert Credit Application Master
    // ARID create ke time NULL rahegi
    // ============================================================

    const masterResult = await client.query(
      `
      INSERT INTO Credit_Application_Entry_Master
      (
        OrganizationID,

        ApplicationDate,

        CompanyName,
        CompanyGSTIN,
        MSME,

        BusinessAddress,
        BillingAddress,

        AuthorisedPersonNamePosition,
        AuthorisedPersonMobileNo,
        AuthorisedPersonEmail,

        AccountsContactNamePosition,
        AccountsContactMobileNo,
        AccountsContactEmail,

        RecommendedBy,
        Position,

        CreditReferenceCheckedBy,
        CreditReferenceCheckedDate,

        CreditAmountAllowed,
        ExpectedBusinessFY,
        FinancialYear,

        ARID,

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
        $10,

        $11,
        $12,
        $13,

        $14,
        $15,

        $16,
        $17,

        $18,
        $19,
        $20,

        NULL,

        FALSE,

        $21,
        CURRENT_TIMESTAMP
      )
      RETURNING CreditApplicationID;
      `,
      [
        OrganizationID,

        ApplicationDate,

        CompanyName,
        CompanyGSTIN,
        MSME,

        BusinessAddress,
        BillingAddress,

        AuthorisedPersonNamePosition,
        AuthorisedPersonMobileNo,
        AuthorisedPersonEmail,

        AccountsContactNamePosition,
        AccountsContactMobileNo,
        AccountsContactEmail,

        RecommendedBy,
        Position,

        CreditReferenceCheckedBy,
        CreditReferenceCheckedDate,

        CreditAmountAllowed,
        ExpectedBusinessFY,
        FinancialYear,

        UserID,
      ],
    );

    const CreditApplicationID =
      masterResult.rows[0].creditapplicationid;


    // ============================================================
    // Insert Documents
    // ============================================================

    for (let i = 0; i < (Documents || []).length; i++) {
      const document = Documents[i];

      await client.query(
        `
        INSERT INTO Credit_Application_Entry_Master_document
        (
          CreditApplicationID,
          DocumentType,

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
          CreditApplicationID,
          document.DocumentType || null,

          document.FileName || null,
          document.FilePath || null,
          document.FileType || null,
          document.FileSize ?? null,

          UserID,
        ],
      );
    }


    // ============================================================
    // Create Approval Row
    // ============================================================

    await client.query(
      `
      INSERT INTO Credit_Application_Approval
      (
        CreditApplicationID,

        FinanceStatus,
        GMStatus,
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

        FALSE,

        $2,
        CURRENT_TIMESTAMP
      );
      `,
      [
        CreditApplicationID,
        UserID,
      ],
    );


    // ============================================================
    // Commit
    // ============================================================

    await client.query("COMMIT");

    return ok(
      "Credit Application created successfully."
    );

  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23503") {
      return fail(
        "Invalid Credit Application related data.",
        400,
      );
    }

    if (error.code === "23505") {
      return fail(
        "Credit Application record already exists.",
        409,
      );
    }

    if (error.code === "22P02") {
      return fail(
        "Invalid Credit Application data.",
        400,
      );
    }

    return databaseFailure(
      error,
      "Create Credit Application",
    );

  } finally {
    client.release();
  }
};
// ============================================================ Get Apis Helper
// ========================Approval Role Condition Helper
const resolveCreditApplicationApprovalRole = ({
  UserType,
  DepartmentName,
}) => {
  const userType = String(
    UserType || "",
  )
    .trim()
    .toUpperCase();

  const departmentName = String(
    DepartmentName || "",
  )
    .trim()
    .toUpperCase();

  // ============================================================
  // FC
  // FC approval = FC HOD
  // ============================================================

  if (
    userType === "HOD" &&
    ["FC", "FINANCE"].includes(departmentName)
  ) {
    return "FC";
  }

  // ============================================================
  // GM
  // ============================================================

  if (userType === "GM") {
    return "GM";
  }

  return null;
};
// ======================== Get Approval Flow Helper
const getCreditApplicationApprovalFlow = async (
  OrganizationID,
  db = pool,
) => {
  const result = await db.query(
    `
    SELECT
      CreditApplicationApprovalConfigID,
      ApprovalLevel,
      ApprovalRole,
      ApprovalOrder,
      IsMandatory

    FROM Credit_Application_Approval_Config

    WHERE OrganizationID = $1
      AND IsDeleted = FALSE

    ORDER BY
      ApprovalOrder ASC,
      ApprovalLevel ASC,
      CreditApplicationApprovalConfigID ASC;
    `,
    [
      OrganizationID,
    ],
  );

  // ============================================================
  // Organization Specific Flow
  // ============================================================

  if (result.rows.length > 0) {
    return result.rows.map(
      (row) => ({
        CreditApplicationApprovalConfigID:
          Number(
            row.creditapplicationapprovalconfigid,
          ),

        LevelNo:
          Number(
            row.approvallevel,
          ),

        ApprovalRole:
          normalizeCreditApplicationApprovalRole(
            row.approvalrole,
          ),

        ApprovalOrder:
          Number(
            row.approvalorder,
          ),

        IsMandatory:
          Boolean(
            row.ismandatory,
          ),
      }),
    );
  }

  // ============================================================
  // Default Flow
  // FC -> GM
  // ============================================================

  return DEFAULT_CREDIT_APPLICATION_APPROVALS.map(
    (item, index) => ({
      CreditApplicationApprovalConfigID:
        null,

      LevelNo:
        item.LevelNo,

      ApprovalRole:
        item.ApprovalRole,

      ApprovalOrder:
        index + 1,

      IsMandatory:
        true,
    }),
  );
};
// ======================== Normalize Helper
const normalizeCreditApprovalStatus = (value) =>
  String(
    value || "Pending",
  )
    .trim()
    .toUpperCase();
// ======================== Row Mapper Helper
const mapCreditApplication = (row) => ({
  CreditApplicationID:
    Number(row.creditapplicationid),

  OrganizationID:
    Number(row.organizationid),

  OrganizationShortName:
    row.OrganizationShortName ??
    row.organizationshortname ??
    null,

  ApplicationDate:
    formatDate(row.applicationdate),

  CompanyName:
    row.companyname,

  CompanyGSTIN:
    row.companygstin,

  MSME:
    row.msme,

  BusinessAddress:
    row.businessaddress,

  BillingAddress:
    row.billingaddress,

  AuthorisedPersonNamePosition:
    row.authorisedpersonnameposition,

  AuthorisedPersonMobileNo:
    row.authorisedpersonmobileno,

  AuthorisedPersonEmail:
    row.authorisedpersonemail,

  AccountsContactNamePosition:
    row.accountscontactnameposition,

  AccountsContactMobileNo:
    row.accountscontactmobileno,

  AccountsContactEmail:
    row.accountscontactemail,

  RecommendedBy:
    row.recommendedby,

  Position:
    row.position,

  CreditReferenceCheckedBy:
    row.creditreferencecheckedby,

  CreditReferenceCheckedDate:
    formatDate(
      row.creditreferencecheckeddate,
    ),

  CreditAmountAllowed:
    row.creditamountallowed !== null
      ? Number(row.creditamountallowed)
      : null,

  ExpectedBusinessFY:
    row.expectedbusinessfy !== null
      ? Number(row.expectedbusinessfy)
      : null,

  FinancialYear:
    row.financialyear,

  ARID:
    row.arid || null,

  CurrentApprovalRole:
    null,

  CurrentStatus:
    "Pending",

  FinalStatus:
    row.finalstatus || "Pending",

  FinalStatusDateTime:
    row.finalstatusdatetime || null,

  Approvals: [],

  Documents: [],

  CreatedDate:
    formatDate(row.createddate),


});
// ======================= Attach Documents + Approval Array Helper
const attachCreditApplicationRelatedData = async (
  rows,
) => {
  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    return [];
  }

  const CreditApplicationIDs =
    rows.map(
      (row) =>
        Number(
          row.creditapplicationid,
        ),
    );

  // ============================================================
  // Documents
  // ============================================================

  const documentsResult =
    await pool.query(
      `
      SELECT
        CreditApplicationDocumentID,
        CreditApplicationID,
        DocumentType,
        FileName,
        FilePath,
        FileType,
        FileSize,
        CreatedDate

      FROM Credit_Application_Entry_Master_document

      WHERE CreditApplicationID =
            ANY($1::bigint[])

        AND IsDeleted = FALSE

      ORDER BY
        CreditApplicationID ASC,
        CreditApplicationDocumentID ASC;
      `,
      [
        CreditApplicationIDs,
      ],
    );


  // ============================================================
  // Approval Config For All Organizations
  // ============================================================

  const organizationIDs = [
    ...new Set(
      rows.map(
        (row) =>
          Number(
            row.organizationid,
          ),
      ),
    ),
  ];

  const configResult =
    await pool.query(
      `
      SELECT
        CreditApplicationApprovalConfigID,
        OrganizationID,
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
        IsMandatory

      FROM Credit_Application_Approval_Config

      WHERE OrganizationID =
            ANY($1::bigint[])

        AND IsDeleted = FALSE

      ORDER BY
        OrganizationID ASC,
        ApprovalOrder ASC,
        ApprovalLevel ASC,
        CreditApplicationApprovalConfigID ASC;
      `,
      [
        organizationIDs,
      ],
    );


  // ============================================================
  // Build Organization Approval Flow Map
  // ============================================================

  const flowsByOrganization =
    new Map();

  for (
    const row of configResult.rows
  ) {
    const OrganizationID =
      Number(
        row.organizationid,
      );

    if (
      !flowsByOrganization.has(
        OrganizationID,
      )
    ) {
      flowsByOrganization.set(
        OrganizationID,
        [],
      );
    }

    flowsByOrganization
      .get(OrganizationID)
      .push({
        CreditApplicationApprovalConfigID:
          Number(
            row.creditapplicationapprovalconfigid,
          ),

        LevelNo:
          Number(
            row.approvallevel,
          ),

        ApprovalRole:
          normalizeCreditApplicationApprovalRole(
            row.approvalrole,
          ),

        ApprovalOrder:
          Number(
            row.approvalorder,
          ),

        IsMandatory:
          Boolean(
            row.ismandatory,
          ),
      });
  }


  // ============================================================
  // Default FC -> GM
  // ============================================================

  const defaultFlow =
    DEFAULT_CREDIT_APPLICATION_APPROVALS.map(
      (item, index) => ({
        CreditApplicationApprovalConfigID:
          null,

        LevelNo:
          item.LevelNo,

        ApprovalRole:
          item.ApprovalRole,

        ApprovalOrder:
          index + 1,

        IsMandatory:
          true,
      }),
    );


  // ============================================================
  // Map Credit Application Rows
  // ============================================================

  const mapped =
    rows.map((row) => {
      const item =
        mapCreditApplication(
          row,
        );

      const approvalFlow =
        flowsByOrganization.get(
          Number(
            row.organizationid,
          ),
        ) ||
        defaultFlow;


      const statusMap = {
        FC: {
          Status:
            row.financestatus ||
            "Pending",

          StatusDateTime:
            row.financestatusdatetime ||
            null,

          ApprovedBy:
            row.financestatusapprovedby !== null
              ? Number(
                  row.financestatusapprovedby,
                )
              : null,

          Remarks:
            row.financeremarks ||
            null,
        },

        GM: {
          Status:
            row.gmstatus ||
            "Pending",

          StatusDateTime:
            row.gmstatusdatetime ||
            null,

          ApprovedBy:
            row.gmstatusapprovedby !== null
              ? Number(
                  row.gmstatusapprovedby,
                )
              : null,

          Remarks:
            row.gmremarks ||
            null,
        },
      };


      // ==========================================================
      // Approval Array
      // ==========================================================

      item.Approvals =
        approvalFlow.map(
          (approval) => {
            const approvalData =
              statusMap[
                approval.ApprovalRole
              ] || {};

           return {
  CreditApplicationApprovalConfigID:
    approval.CreditApplicationApprovalConfigID ??
    null,

  ApprovalRole:
    approval.ApprovalRole,

  Status:
    approvalData.Status || "Pending",

  Remarks:
    approvalData.Remarks || null,
};
          },
        );


      // ==========================================================
      // Current Approval Stage
      // ==========================================================

      const currentStage =
        item.Approvals.find(
          (approval) =>
            normalizeCreditApprovalStatus(
              approval.Status,
            ) !==
            "APPROVED",
        );


      if (
        normalizeCreditApprovalStatus(
          item.FinalStatus,
        ) === "APPROVED"
      ) {
        item.CurrentApprovalRole =
          null;

        item.CurrentStatus =
          "Approved";
      } else {
        item.CurrentApprovalRole =
          currentStage
            ?.ApprovalRole ||
          null;

        item.CurrentStatus =
          currentStage
            ?.Status ||
          item.FinalStatus ||
          "Pending";
      }

      return item;
    });


  // ============================================================
  // Map By Credit Application ID
  // ============================================================

  const byID =
    new Map(
      mapped.map(
        (item) => [
          item.CreditApplicationID,
          item,
        ],
      ),
    );


  // ============================================================
  // Attach Documents
  // ============================================================

  for (
    const row of documentsResult.rows
  ) {
    const item =
      byID.get(
        Number(
          row.creditapplicationid,
        ),
      );

    if (!item) {
      continue;
    }

    item.Documents.push({
  CreditApplicationDocumentID:
    Number(
      row.creditapplicationdocumentid,
    ),

  DocumentType:
    row.documenttype,

  FileName:
    row.filename,

  FilePath:
    row.filepath
      ? generateUrl(row.filepath)
      : null,
});
  }

  return mapped;
};
// ====================== Credit Application Query
const CREDIT_APPLICATION_BASE_FROM = `
  FROM Credit_Application_Entry_Master ca

  LEFT JOIN Organization_Master om
    ON om.OrganizationID =
       ca.OrganizationID

   AND om.IsDeleted = FALSE

  LEFT JOIN Credit_Application_Approval approval
    ON approval.CreditApplicationID =
       ca.CreditApplicationID

   AND approval.IsDeleted = FALSE


  LEFT JOIN LATERAL
  (
    SELECT
      approval_flow.ApprovalRole,

      CASE
        WHEN approval_flow.ApprovalRole =
             'FC'
        THEN COALESCE(
          approval.FinanceStatus,
          'Pending'
        )

        WHEN approval_flow.ApprovalRole =
             'GM'
        THEN COALESCE(
          approval.GMStatus,
          'Pending'
        )

        ELSE
          'Pending'

      END AS Status

    FROM
    (
      SELECT
        CASE
          WHEN UPPER(TRIM(config.ApprovalRole)) = 'FINANCE'
          THEN 'FC'
          ELSE UPPER(TRIM(config.ApprovalRole))
        END AS ApprovalRole,

        config.ApprovalOrder,

        config.ApprovalLevel

      FROM Credit_Application_Approval_Config config

      WHERE config.OrganizationID =
            ca.OrganizationID

        AND config.IsDeleted =
            FALSE


      UNION ALL


      SELECT
        default_flow.ApprovalRole,

        default_flow.ApprovalOrder,

        default_flow.ApprovalLevel

      FROM
      (
        VALUES
          ('FC', 1, 1),
          ('GM', 2, 2)

      ) AS default_flow(
        ApprovalRole,
        ApprovalOrder,
        ApprovalLevel
      )

      WHERE NOT EXISTS
      (
        SELECT 1

        FROM Credit_Application_Approval_Config config

        WHERE config.OrganizationID =
              ca.OrganizationID

          AND config.IsDeleted =
              FALSE
      )

    ) approval_flow

    WHERE UPPER(
      TRIM(
        CASE
          WHEN approval_flow.ApprovalRole =
               'FC'
          THEN COALESCE(
            approval.FinanceStatus,
            'Pending'
          )

          WHEN approval_flow.ApprovalRole =
               'GM'
          THEN COALESCE(
            approval.GMStatus,
            'Pending'
          )

          ELSE
            'Pending'

        END
      )
    ) <> 'APPROVED'

    ORDER BY
      approval_flow.ApprovalOrder ASC,
      approval_flow.ApprovalLevel ASC

    LIMIT 1

  ) current_stage ON TRUE
`;
// ============================================================Credit Applications List
const getCreditApplicationList = async (data) => {
  try {
    // ============================================================
    // Organization
    // ============================================================

    const OrganizationID =
      Number(
        data.OrganizationID,
      );

    if (
      !Number.isSafeInteger(
        OrganizationID,
      ) ||
      OrganizationID <= 0
    ) {
      return fail(
        "OrganizationID is required.",
        400,
      );
    }


    // ============================================================
    // Pagination
    // ============================================================

    const page =
      Number(data.page) || 1;

    const PageSize =
      Number(
        data.PageSize,
      ) || 10;

    if (
      !Number.isInteger(page) ||
      page <= 0
    ) {
      return fail(
        "page must be a positive integer.",
        400,
      );
    }

    if (
      !Number.isInteger(
        PageSize,
      ) ||
      PageSize <= 0 ||
      PageSize > 100
    ) {
      return fail(
        "PageSize must be between 1 and 100.",
        400,
      );
    }

    const offset =
      (page - 1) *
      PageSize;


    // ============================================================
    // Company Name
    // ============================================================

    const CompanyName =
      data.CompanyName !== undefined &&
      data.CompanyName !== null &&
      String(
        data.CompanyName,
      ).trim() !== ""
        ? String(
            data.CompanyName,
          ).trim()
        : null;


    // ============================================================
    // Status
    // ============================================================

    const Status =
      data.Status !== undefined &&
      data.Status !== null &&
      String(
        data.Status,
      ).trim() !== ""
        ? String(
            data.Status,
          )
            .trim()
            .toUpperCase()
        : null;

    const validStatuses = [
      "PENDING",
      "APPROVED",
      "REJECTED",
      "RETURNED",
    ];

    if (
      Status &&
      !validStatuses.includes(
        Status,
      )
    ) {
      return fail(
        "Status must be Pending, Approved, Rejected, or Returned.",
        400,
      );
    }


    // ============================================================
    // Application Date Range
    // ============================================================

    const normalizeDateFilter = (value) =>
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
        ? String(value).trim()
        : null;

    const FromDate = normalizeDateFilter(data.FromDate);
    const ToDate = normalizeDateFilter(data.ToDate);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    const isValidDateFilter = (value) => {
      if (!value || !datePattern.test(value)) return false;
      const parsedDate = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsedDate.getTime()) &&
        parsedDate.toISOString().slice(0, 10) === value;
    };

    if (FromDate && !isValidDateFilter(FromDate)) {
      return fail("FromDate must be a valid date in YYYY-MM-DD format.", 400);
    }

    if (ToDate && !isValidDateFilter(ToDate)) {
      return fail("ToDate must be a valid date in YYYY-MM-DD format.", 400);
    }

    if (FromDate && ToDate && FromDate > ToDate) {
      return fail("FromDate cannot be greater than ToDate.", 400);
    }


    // ============================================================
    // Logged-In User Approval Role
    // ============================================================

    const approvalRole =
      resolveCreditApplicationApprovalRole({
        UserType:
          data.UserType,

        DepartmentName:
          data.DepartmentName,
      });


    const userType =
      String(
        data.UserType || "",
      )
        .trim()
        .toUpperCase();

    const departmentName =
      String(
        data.DepartmentName ||
          "",
      )
        .trim()
        .toUpperCase();


    // ============================================================
    // CEO / Front Office
    //
    // No default list.
    // CompanyName search compulsory.
    // ============================================================

    const searchOnlyViewer =
      !approvalRole &&
      (
        userType === "CEO" ||
        departmentName ===
          "FRONT OFFICE" ||
        departmentName === "FO"
      );

    if (
      searchOnlyViewer &&
      !CompanyName
    ) {
      return ok(
        "Credit Application records fetched successfully.",
        {
          TotalCount: 0,
          PageCount: 0,
          CurrentPage: page,
          PageSize,
          TotalPages: 0,
          data: [],
        },
      );
    }


    // ============================================================
    // Common WHERE
    // Same WHERE for Count + List
    // ============================================================

    let whereClause = `
      WHERE ca.IsDeleted = FALSE
        AND ca.OrganizationID = $1
    `;

    const params = [
      OrganizationID,
    ];


    // ============================================================
    // Company Search
    // ============================================================

    if (CompanyName) {
      params.push(
        CompanyName,
      );

      whereClause += `
        AND COALESCE(
          ca.CompanyName,
          ''
        ) ILIKE '%' ||
          $${params.length} ||
          '%'
      `;
    }


    // ============================================================
    // Application Date Filters (Inclusive)
    // ============================================================

    if (FromDate) {
      params.push(FromDate);
      whereClause += `
        AND ca.ApplicationDate >= $${params.length}::date
      `;
    }

    if (ToDate) {
      params.push(ToDate);
      whereClause += `
        AND ca.ApplicationDate <= $${params.length}::date
      `;
    }


    // ============================================================
    // CEO / Front Office Visibility
    // ============================================================

    if (searchOnlyViewer) {
      whereClause += `
        AND UPPER(
          TRIM(
            COALESCE(
              approval.FinanceStatus,
              ''
            )
          )
        ) = 'APPROVED'

        AND UPPER(
          TRIM(
            COALESCE(
              approval.GMStatus,
              ''
            )
          )
        ) = 'APPROVED'

        AND NULLIF(
          TRIM(
            COALESCE(
              ca.ARID,
              ''
            )
          ),
          ''
        ) IS NOT NULL
      `;
    }


    // ============================================================
    // Approver Access
    // ============================================================

    else if (approvalRole) {
      const roleStatusColumns = {
        FC:
          "approval.FinanceStatus",

        GM:
          "approval.GMStatus",
      };

      const roleStatusColumn =
        roleStatusColumns[
          approvalRole
        ];


      // ==========================================================
      // Pending
      // ==========================================================

      if (Status === "PENDING") {
        params.push(
          approvalRole,
        );

        const roleIndex =
          params.length;

        whereClause += `
          AND
          (
            (
              UPPER(
                COALESCE(
                  current_stage.ApprovalRole,
                  ''
                )
              ) =
              $${roleIndex}

              AND UPPER(
                TRIM(
                  COALESCE(
                    current_stage.Status,
                    'Pending'
                  )
                )
              ) = 'PENDING'
            )
        `;

        // FC ko ARID pending records bhi dikhne hain
        if (
          approvalRole ===
          "FC"
        ) {
          whereClause += `
            OR
            (
              UPPER(
                TRIM(
                  COALESCE(
                    approval.FinanceStatus,
                    ''
                  )
                )
              ) = 'APPROVED'

              AND UPPER(
                TRIM(
                  COALESCE(
                    approval.GMStatus,
                    ''
                  )
                )
              ) = 'APPROVED'

              AND NULLIF(
                TRIM(
                  COALESCE(
                    ca.ARID,
                    ''
                  )
                ),
                ''
              ) IS NULL
            )
          `;
        }

        whereClause += `
          )
        `;
      }


      // ==========================================================
      // Approved / Rejected / Returned
      // Logged-in approver ka own history
      // ==========================================================

      else if (
        Status ===
          "APPROVED" ||
        Status ===
          "REJECTED" ||
        Status ===
          "RETURNED"
      ) {
        params.push(
          Status,
        );

        whereClause += `
          AND UPPER(
            TRIM(
              COALESCE(
                ${roleStatusColumn},
                ''
              )
            )
          ) =
          $${params.length}
        `;

        // GM approval ke baad AR ID pending record FC ka pending task hai,
        // isliye use FC Approved history mein include nahi karna hai.
        if (
          approvalRole === "FC" &&
          Status === "APPROVED"
        ) {
          whereClause += `
            AND NOT
            (
              UPPER(TRIM(COALESCE(approval.FinanceStatus, ''))) = 'APPROVED'
              AND UPPER(TRIM(COALESCE(approval.GMStatus, ''))) = 'APPROVED'
              AND NULLIF(TRIM(COALESCE(ca.ARID, '')), '') IS NULL
            )
          `;
        }
      }


      // ==========================================================
      // No Status
      // Current work + own history
      // ==========================================================

      else {
        params.push(
          approvalRole,
        );

        whereClause += `
          AND
          (
            (
              UPPER(
                COALESCE(
                  current_stage.ApprovalRole,
                  ''
                )
              ) =
              $${params.length}

              AND UPPER(
                TRIM(
                  COALESCE(
                    current_stage.Status,
                    'Pending'
                  )
                )
              ) = 'PENDING'
            )

            OR

            UPPER(
              TRIM(
                COALESCE(
                  ${roleStatusColumn},
                  ''
                )
              )
            ) IN
            (
              'APPROVED',
              'REJECTED',
              'RETURNED'
            )
          )
        `;
      }
    }


    // ============================================================
    // Normal User Status Filter
    // Sales / Sales & Marketing etc.
    // ============================================================

    else if (Status) {
      if (
        Status === "APPROVED"
      ) {
        whereClause += `
          AND UPPER(
            TRIM(
              COALESCE(
                approval.FinalStatus,
                ''
              )
            )
          ) = 'APPROVED'
        `;
      }

      else if (
        Status === "REJECTED"
      ) {
        whereClause += `
          AND
          (
            UPPER(
              TRIM(
                COALESCE(
                  approval.FinanceStatus,
                  ''
                )
              )
            ) = 'REJECTED'

            OR

            UPPER(
              TRIM(
                COALESCE(
                  approval.GMStatus,
                  ''
                )
              )
            ) = 'REJECTED'

            OR

            UPPER(
              TRIM(
                COALESCE(
                  approval.FinalStatus,
                  ''
                )
              )
            ) = 'REJECTED'
          )
        `;
      }

      else if (
        Status === "RETURNED"
      ) {
        whereClause += `
          AND
          (
            UPPER(
              TRIM(
                COALESCE(
                  approval.FinanceStatus,
                  ''
                )
              )
            ) = 'RETURNED'

            OR

            UPPER(
              TRIM(
                COALESCE(
                  approval.GMStatus,
                  ''
                )
              )
            ) = 'RETURNED'

            OR

            UPPER(
              TRIM(
                COALESCE(
                  approval.FinalStatus,
                  ''
                )
              )
            ) = 'RETURNED'
          )
        `;
      }

      else if (
        Status === "PENDING"
      ) {
        whereClause += `
          AND current_stage.ApprovalRole
              IS NOT NULL

          AND UPPER(
            TRIM(
              COALESCE(
                current_stage.Status,
                'Pending'
              )
            )
          ) = 'PENDING'

          AND UPPER(
            TRIM(
              COALESCE(
                approval.FinalStatus,
                'Pending'
              )
            )
          ) <> 'APPROVED'

          AND UPPER(
            TRIM(
              COALESCE(
                approval.FinanceStatus,
                ''
              )
            )
          ) NOT IN
          (
            'REJECTED',
            'RETURNED'
          )

          AND UPPER(
            TRIM(
              COALESCE(
                approval.GMStatus,
                ''
              )
            )
          ) NOT IN
          (
            'REJECTED',
            'RETURNED'
          )
        `;
      }
    }


    // ============================================================
    // Count
    // ============================================================

    const countResult =
      await pool.query(
        `
        SELECT
          COUNT(*)::bigint
            AS TotalCount

        ${CREDIT_APPLICATION_BASE_FROM}

        ${whereClause};
        `,
        params,
      );

    const TotalCount =
      Number(
        countResult.rows[0]
          ?.totalcount || 0,
      );


    // ============================================================
    // List Parameters
    // ============================================================

    const listParams = [
      ...params,
      PageSize,
      offset,
    ];

    const limitIndex =
      params.length + 1;

    const offsetIndex =
      params.length + 2;


    // ============================================================
    // List
    // ============================================================

    const result =
      await pool.query(
        `
        SELECT
          ca.CreditApplicationID,
          ca.OrganizationID,

        

          om.ShortName
            AS "OrganizationShortName",

          ca.ApplicationDate,

          ca.CompanyName,
          ca.CompanyGSTIN,
          ca.MSME,

          ca.BusinessAddress,
          ca.BillingAddress,

          ca.AuthorisedPersonNamePosition,
          ca.AuthorisedPersonMobileNo,
          ca.AuthorisedPersonEmail,

          ca.AccountsContactNamePosition,
          ca.AccountsContactMobileNo,
          ca.AccountsContactEmail,

          ca.RecommendedBy,
          ca.Position,

          ca.CreditReferenceCheckedBy,
          ca.CreditReferenceCheckedDate,

          ca.CreditAmountAllowed,
          ca.ExpectedBusinessFY,
          ca.FinancialYear,

          ca.ARID,

          ca.CreatedBy,
          ca.CreatedDate,
          ca.ModifiedBy,
          ca.ModifiedDate,

          approval.CreditApplicationApprovalID,

          approval.FinanceStatus,
          approval.FinanceStatusDateTime,
          approval.FinanceStatusApprovedBy,
          approval.FinanceRemarks,

          approval.GMStatus,
          approval.GMStatusDateTime,
          approval.GMStatusApprovedBy,
          approval.GMRemarks,

          approval.FinalStatus,
          approval.FinalStatusDateTime

        ${CREDIT_APPLICATION_BASE_FROM}

        ${whereClause}

        ORDER BY
          ca.CreatedDate DESC,
          ca.CreditApplicationID DESC

        LIMIT $${limitIndex}

        OFFSET $${offsetIndex};
        `,
        listParams,
      );


    // ============================================================
    // Attach Documents + Approval
    // ============================================================

    const records =
      await attachCreditApplicationRelatedData(
        result.rows,
      );


    // ============================================================
    // CanApprove
    // ============================================================

    for (
      const record of records
    ) {
      const fcApproval = record.Approvals.find(
        (stage) => stage.ApprovalRole === "FC",
      );
      const gmApproval = record.Approvals.find(
        (stage) => stage.ApprovalRole === "GM",
      );
      const isFCARPending =
        approvalRole === "FC" &&
        normalizeCreditApprovalStatus(fcApproval?.Status) === "APPROVED" &&
        normalizeCreditApprovalStatus(gmApproval?.Status) === "APPROVED" &&
        String(record.ARID || "").trim() === "";

      const currentStage =
        record.Approvals.find(
          (stage) =>
            normalizeCreditApprovalStatus(
              stage.Status,
            ) !==
            "APPROVED",
        );

      record.CanApprove =
        Boolean(
          approvalRole &&

          normalizeCreditApprovalStatus(
            record.FinalStatus,
          ) !==
            "APPROVED" &&

          currentStage
            ?.ApprovalRole ===
            approvalRole &&

          normalizeCreditApprovalStatus(
            currentStage?.Status,
          ) ===
            "PENDING"
        );

      if (isFCARPending) {
        record.CurrentApprovalRole = "FC";
        record.CurrentStatus = "Pending";
        record.CanApprove = false;
      }
    }


    // ============================================================
    // Remove Detail-Only Fields From List
    // ============================================================

    for (
      const record of records
    ) {
      for (
        const field of [
          "OrganizationName",

          "BusinessAddress",
          "BillingAddress",

          "AuthorisedPersonNamePosition",
          "AuthorisedPersonMobileNo",
          "AuthorisedPersonEmail",

          "AccountsContactNamePosition",
          "AccountsContactMobileNo",
          "AccountsContactEmail",

          "RecommendedBy",

          "FinalStatusDateTime",

          "CreatedBy",
          "ModifiedDate",

          "Documents",
        ]
      ) {
        delete record[field];
      }

      for (const approval of record.Approvals || []) {
        delete approval.StatusDateTime;
        delete approval.ApprovedBy;
      }
    }


    // ============================================================
    // Pagination
    // ============================================================

    const TotalPages =
      TotalCount > 0
        ? Math.ceil(
            TotalCount /
              PageSize,
          )
        : 0;


    // ============================================================
    // Response
    // ============================================================

    return ok(
      "Credit Application records fetched successfully.",
      {
        TotalCount,

        PageCount:
          records.length,

        CurrentPage:
          page,

        PageSize,

        TotalPages,

        data:
          records,
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch Credit Application records",
    );
  }
};
// ============================================================Get Credit Application By ID
const getCreditApplicationById = async (data) => {
  try {
    // ============================================================
    // ID
    // ============================================================

    const CreditApplicationID =
      Number(
        data.CreditApplicationID,
      );

    if (
      !Number.isSafeInteger(
        CreditApplicationID,
      ) ||
      CreditApplicationID <= 0
    ) {
      return fail(
        "Valid CreditApplicationID is required.",
        400,
      );
    }


    // ============================================================
    // Query
    // ============================================================

    const result =
      await pool.query(
        `
        SELECT
          ca.CreditApplicationID,
          ca.OrganizationID,

          om.OrganizationName
            AS "OrganizationName",

          om.ShortName
            AS "OrganizationShortName",

          ca.ApplicationDate,

          ca.CompanyName,
          ca.CompanyGSTIN,
          ca.MSME,

          ca.BusinessAddress,
          ca.BillingAddress,

          ca.AuthorisedPersonNamePosition,
          ca.AuthorisedPersonMobileNo,
          ca.AuthorisedPersonEmail,

          ca.AccountsContactNamePosition,
          ca.AccountsContactMobileNo,
          ca.AccountsContactEmail,

          ca.RecommendedBy,
          ca.Position,

          ca.CreditReferenceCheckedBy,
          ca.CreditReferenceCheckedDate,

          ca.CreditAmountAllowed,
          ca.ExpectedBusinessFY,
          ca.FinancialYear,

          ca.ARID,

          ca.CreatedBy,
          ca.CreatedDate,
          ca.ModifiedBy,
          ca.ModifiedDate,

          approval.CreditApplicationApprovalID,

          approval.FinanceStatus,
          approval.FinanceStatusDateTime,
          approval.FinanceStatusApprovedBy,
          approval.FinanceRemarks,

          approval.GMStatus,
          approval.GMStatusDateTime,
          approval.GMStatusApprovedBy,
          approval.GMRemarks,

          approval.FinalStatus,
          approval.FinalStatusDateTime

        ${CREDIT_APPLICATION_BASE_FROM}

        WHERE
          ca.CreditApplicationID = $1

          AND ca.IsDeleted =
              FALSE

        LIMIT 1;
        `,
        [
          CreditApplicationID,
        ],
      );


    // ============================================================
    // Not Found
    // ============================================================

    if (
      result.rows.length === 0
    ) {
      return fail(
        "Credit Application record not found.",
        404,
      );
    }


    // ============================================================
    // Attach Documents + Approval
    // ============================================================

    const records =
      await attachCreditApplicationRelatedData(
        result.rows,
      );

    const CreditApplication =
      records[0];


    // ============================================================
    // Approval Role
    // ============================================================

    const approvalRole =
      resolveCreditApplicationApprovalRole({
        UserType:
          data.UserType,

        DepartmentName:
          data.DepartmentName,
      });


    const userType =
      String(
        data.UserType || "",
      )
        .trim()
        .toUpperCase();

    const departmentName =
      String(
        data.DepartmentName || "",
      )
        .trim()
        .toUpperCase();


    // ============================================================
    // CEO / Front Office
    // Only completed records
    // ============================================================

    const searchOnlyViewer =
      !approvalRole &&
      (
        userType === "CEO" ||
        departmentName ===
          "FRONT OFFICE" ||
        departmentName === "FO"
      );

    if (searchOnlyViewer) {
      const fcApproved =
        normalizeCreditApprovalStatus(
          result.rows[0]
            .financestatus,
        ) === "APPROVED";

      const gmApproved =
        normalizeCreditApprovalStatus(
          result.rows[0]
            .gmstatus,
        ) === "APPROVED";

      const hasARID =
        String(
          CreditApplication.ARID ||
            "",
        ).trim() !== "";

      if (
        !fcApproved ||
        !gmApproved ||
        !hasARID
      ) {
        return fail(
          "You are not authorized to view this Credit Application.",
          403,
        );
      }
    }


    // ============================================================
    // Approver View Access
    // ============================================================

    if (approvalRole) {
      const currentStage =
        CreditApplication.Approvals.find(
          (stage) =>
            normalizeCreditApprovalStatus(
              stage.Status,
            ) !==
            "APPROVED",
        );

      const ownApproval =
        CreditApplication.Approvals.find(
          (stage) =>
            stage.ApprovalRole ===
            approvalRole,
        );

      const ownStatus =
        normalizeCreditApprovalStatus(
          ownApproval?.Status,
        );

      const hasAlreadyActed =
        [
          "APPROVED",
          "REJECTED",
          "RETURNED",
        ].includes(
          ownStatus,
        );

      const isCurrentStage =
        currentStage
          ?.ApprovalRole ===
        approvalRole;


      // FC ko ARID pending state me access rahega
      const fcARPending =
        approvalRole ===
          "FC" &&

        normalizeCreditApprovalStatus(
          result.rows[0]
            .financestatus,
        ) ===
          "APPROVED" &&

        normalizeCreditApprovalStatus(
          result.rows[0]
            .gmstatus,
        ) ===
          "APPROVED" &&

        String(
          CreditApplication.ARID ||
            "",
        ).trim() === "";


      if (
        !isCurrentStage &&
        !hasAlreadyActed &&
        !fcARPending
      ) {
        return fail(
          "You are not authorized to view this Credit Application at the current approval stage.",
          403,
        );
      }
    }


    // ============================================================
    // Can Approve
    // ============================================================

    const currentStage =
      CreditApplication.Approvals.find(
        (stage) =>
          normalizeCreditApprovalStatus(
            stage.Status,
          ) !==
          "APPROVED",
      );

    CreditApplication.CanApprove =
      Boolean(
        approvalRole &&

        normalizeCreditApprovalStatus(
          CreditApplication.FinalStatus,
        ) !==
          "APPROVED" &&

        currentStage
          ?.ApprovalRole ===
          approvalRole &&

        normalizeCreditApprovalStatus(
          currentStage?.Status,
        ) ===
          "PENDING"
      );


    // ============================================================
    // Response
    // ============================================================

    return ok(
      "Credit Application record fetched successfully.",
      CreditApplication,
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch Credit Application record",
    );
  }
}; 
// ============================================================UPDATE CREDIT APPLICATION
const updateCreditApplication = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      CreditApplicationID,
      OrganizationID,

      ApplicationDate,

      CompanyName,
      CompanyGSTIN,
      MSME,

      BusinessAddress,
      BillingAddress,

      AuthorisedPersonNamePosition,
      AuthorisedPersonMobileNo,
      AuthorisedPersonEmail,

      AccountsContactNamePosition,
      AccountsContactMobileNo,
      AccountsContactEmail,

      RecommendedBy,
      Position,

      CreditReferenceCheckedBy,
      CreditReferenceCheckedDate,

      CreditAmountAllowed,
      ExpectedBusinessFY,
      FinancialYear,

      Documents,
      DeleteDocumentIDs,

      UserID,
    } = data;

    // ============================================================
    // Check Record
    // Lock record during update
    // ============================================================

    const existingResult =
      await client.query(
        `
        SELECT
          ca.CreditApplicationID,
          approval.FinalStatus

        FROM Credit_Application_Entry_Master ca

        LEFT JOIN Credit_Application_Approval approval
          ON approval.CreditApplicationID =
             ca.CreditApplicationID
         AND approval.IsDeleted = FALSE

        WHERE ca.CreditApplicationID = $1
          AND ca.OrganizationID = $2
          AND ca.IsDeleted = FALSE

        FOR UPDATE OF ca;
        `,
        [
          CreditApplicationID,
          OrganizationID,
        ],
      );

    if (
      existingResult.rows.length === 0
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Credit Application record not found.",
        404,
      );
    }

    // ============================================================
    // Approved record cannot be modified
    // ============================================================

    const finalStatus =
      normalizeCreditApprovalStatus(
        existingResult.rows[0].finalstatus,
      );

    if (finalStatus === "APPROVED") {
      await client.query("ROLLBACK");

      return fail(
        "Approved Credit Application cannot be modified.",
        400,
      );
    }

    // ============================================================
    // Update Master
    //
    // ARID intentionally not updated here.
    // ============================================================

    await client.query(
      `
      UPDATE Credit_Application_Entry_Master

      SET
        ApplicationDate = $1,

        CompanyName = $2,
        CompanyGSTIN = $3,
        MSME = $4,

        BusinessAddress = $5,
        BillingAddress = $6,

        AuthorisedPersonNamePosition = $7,
        AuthorisedPersonMobileNo = $8,
        AuthorisedPersonEmail = $9,

        AccountsContactNamePosition = $10,
        AccountsContactMobileNo = $11,
        AccountsContactEmail = $12,

        RecommendedBy = $13,
        Position = $14,

        CreditReferenceCheckedBy = $15,
        CreditReferenceCheckedDate = $16,

        CreditAmountAllowed = $17,
        ExpectedBusinessFY = $18,
        FinancialYear = $19,

        ModifiedBy = $20,
        ModifiedDate = CURRENT_TIMESTAMP

      WHERE CreditApplicationID = $21
        AND OrganizationID = $22
        AND IsDeleted = FALSE;
      `,
      [
        ApplicationDate,

        CompanyName,
        CompanyGSTIN,
        MSME,

        BusinessAddress,
        BillingAddress,

        AuthorisedPersonNamePosition,
        AuthorisedPersonMobileNo,
        AuthorisedPersonEmail,

        AccountsContactNamePosition,
        AccountsContactMobileNo,
        AccountsContactEmail,

        RecommendedBy,
        Position,

        CreditReferenceCheckedBy,
        CreditReferenceCheckedDate,

        CreditAmountAllowed,
        ExpectedBusinessFY,
        FinancialYear,

        UserID,

        CreditApplicationID,
        OrganizationID,
      ],
    );

    // ============================================================
    // Delete Selected Documents
    // Soft Delete
    // ============================================================

    if (
      Array.isArray(DeleteDocumentIDs) &&
      DeleteDocumentIDs.length > 0
    ) {
      await client.query(
        `
        UPDATE Credit_Application_Entry_Master_document

        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP

        WHERE CreditApplicationID = $2

          AND CreditApplicationDocumentID =
              ANY($3::bigint[])

          AND IsDeleted = FALSE;
        `,
        [
          UserID,
          CreditApplicationID,
          DeleteDocumentIDs,
        ],
      );
    }

    // ============================================================
    // Insert New Documents
    // ============================================================

    for (
      let i = 0;
      i < (Documents || []).length;
      i++
    ) {
      const document =
        Documents[i];

      await client.query(
        `
        INSERT INTO Credit_Application_Entry_Master_document
        (
          CreditApplicationID,
          DocumentType,

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
          CreditApplicationID,

          document.DocumentType || null,

          document.FileName || null,
          document.FilePath || null,
          document.FileType || null,
          document.FileSize ?? null,

          UserID,
        ],
      );
    }

    // ============================================================
    // Commit
    // ============================================================

    await client.query("COMMIT");

    return ok(
      "Credit Application updated successfully.",
    );

  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23503") {
      return fail(
        "Invalid Credit Application related data.",
        400,
      );
    }

    if (error.code === "22P02") {
      return fail(
        "Invalid Credit Application data.",
        400,
      );
    }

    return databaseFailure(
      error,
      "Update Credit Application",
    );

  } finally {
    client.release();
  }
};
// ============================================================DELETE CREDIT APPLICATION
const deleteCreditApplication = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      CreditApplicationID,
      UserID,
    } = data;

    const existingResult =
      await client.query(
        `
        SELECT
          ca.CreditApplicationID,
          approval.FinalStatus

        FROM Credit_Application_Entry_Master ca

        LEFT JOIN Credit_Application_Approval approval
          ON approval.CreditApplicationID =
             ca.CreditApplicationID
         AND approval.IsDeleted = FALSE

        WHERE ca.CreditApplicationID = $1
          AND ca.IsDeleted = FALSE

        FOR UPDATE OF ca;
        `,
        [
          CreditApplicationID,
        ],
      );

    if (
      existingResult.rows.length === 0
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Credit Application record not found.",
        404,
      );
    }

    const finalStatus =
      normalizeCreditApprovalStatus(
        existingResult.rows[0].finalstatus,
      );

    if (finalStatus === "APPROVED") {
      await client.query("ROLLBACK");

      return fail(
        "Approved Credit Application cannot be deleted.",
        400,
      );
    }

    await client.query(
      `
      UPDATE Credit_Application_Entry_Master
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CreditApplicationID = $2
        AND IsDeleted = FALSE;
      `,
      [
        UserID,
        CreditApplicationID,
      ],
    );

    await client.query(
      `
      UPDATE Credit_Application_Entry_Master_document
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CreditApplicationID = $2
        AND IsDeleted = FALSE;
      `,
      [
        UserID,
        CreditApplicationID,
      ],
    );

    await client.query(
      `
      UPDATE Credit_Application_Approval
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CreditApplicationID = $2
        AND IsDeleted = FALSE;
      `,
      [
        UserID,
        CreditApplicationID,
      ],
    );

    await client.query("COMMIT");

    return ok(
      "Credit Application deleted successfully.",
    );

  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(
      error,
      "Delete Credit Application",
    );

  } finally {
    client.release();
  }
};
// ============================================================ CREDIT APPLICATION APPROVAL
const processCreditApplicationApproval = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      CreditApplicationID,
      Action,
      Remarks,

      UserID,
      UserType,
      DepartmentName,
    } = data;

    // ============================================================
    // Logged-In Approval Role
    // ============================================================

    const approvalRole =
      resolveCreditApplicationApprovalRole({
        UserType,
        DepartmentName,
      });

    if (!approvalRole) {
      await client.query("ROLLBACK");

      return fail(
        "You are not authorized to approve Credit Applications.",
        403,
      );
    }

    // ============================================================
    // Lock Credit Application + Approval
    // ============================================================

    const result = await client.query(
      `
      SELECT
        ca.CreditApplicationID,
        ca.OrganizationID,
        ca.CompanyName,
        ca.ARID,

        approval.CreditApplicationApprovalID,

        approval.FinanceStatus,
        approval.FinanceStatusDateTime,
        approval.FinanceStatusApprovedBy,
        approval.FinanceRemarks,

        approval.GMStatus,
        approval.GMStatusDateTime,
        approval.GMStatusApprovedBy,
        approval.GMRemarks,

        approval.FinalStatus,
        approval.FinalStatusDateTime

      FROM Credit_Application_Entry_Master ca

      INNER JOIN Credit_Application_Approval approval
        ON approval.CreditApplicationID =
           ca.CreditApplicationID

       AND approval.IsDeleted = FALSE

      WHERE ca.CreditApplicationID = $1
        AND ca.IsDeleted = FALSE

      FOR UPDATE OF ca, approval;
      `,
      [
        CreditApplicationID,
      ],
    );

    // ============================================================
    // Not Found
    // ============================================================

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return fail(
        "Credit Application record not found.",
        404,
      );
    }

    const row = result.rows[0];

    const OrganizationID =
      Number(row.organizationid);

    // ============================================================
    // Already Final Approved
    // ============================================================

    if (
      normalizeCreditApprovalStatus(
        row.finalstatus,
      ) === "APPROVED"
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Credit Application is already fully approved.",
        400,
      );
    }

    // ============================================================
    // Already Rejected
    // ============================================================

    if (
      normalizeCreditApprovalStatus(
        row.finalstatus,
      ) === "REJECTED"
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Rejected Credit Application cannot be approved further.",
        400,
      );
    }

    // ============================================================
    // Get Organization Approval Flow
    //
    // Custom config available:
    // use config
    //
    // No config:
    // FC -> GM
    // ============================================================

    const approvalFlow =
      await getCreditApplicationApprovalFlow(
        OrganizationID,
        client,
      );

    // ============================================================
    // Validate Approval Flow Roles
    // ============================================================

    for (const stage of approvalFlow) {
      if (
        !CREDIT_APPLICATION_APPROVAL_ROLES.has(
          stage.ApprovalRole,
        )
      ) {
        await client.query("ROLLBACK");

        return fail(
          "Credit Application approval configuration contains an invalid approval role.",
          400,
        );
      }
    }

    // ============================================================
    // Existing Status Map
    // ============================================================

    const statusMap = {
      FC:
        row.financestatus ||
        "Pending",

      GM:
        row.gmstatus ||
        "Pending",
    };

    // ============================================================
    // Current Approval Stage
    //
    // First stage which is not Approved
    // ============================================================

    const currentStage =
      approvalFlow.find(
        (stage) =>
          normalizeCreditApprovalStatus(
            statusMap[
              stage.ApprovalRole
            ],
          ) !== "APPROVED",
      );

    if (!currentStage) {
      await client.query("ROLLBACK");

      return fail(
        "No pending approval stage found.",
        400,
      );
    }

    // ============================================================
    // Logged-In User Must Be Current Stage
    // ============================================================

    if (
      currentStage.ApprovalRole !==
      approvalRole
    ) {
      await client.query("ROLLBACK");

      return fail(
        `Credit Application is currently pending for ${currentStage.ApprovalRole} approval.`,
        403,
      );
    }

    // ============================================================
    // Current Stage Status
    // ============================================================

    const currentStatus =
      normalizeCreditApprovalStatus(
        statusMap[
          approvalRole
        ],
      );

    if (
      currentStatus !== "PENDING"
    ) {
      await client.query("ROLLBACK");

      return fail(
        `${approvalRole} approval is already ${currentStatus}.`,
        400,
      );
    }

    // ============================================================
    // Action -> Status
    // ============================================================

    const newStatus =
      Action === "APPROVE"
        ? "Approved"
        : Action === "REJECT"
          ? "Rejected"
          : "Returned";

    // ============================================================
    // Role Column Mapping
    // ============================================================

    const roleColumns = {
      FC: {
        Status:
          "FinanceStatus",

        DateTime:
          "FinanceStatusDateTime",

        ApprovedBy:
          "FinanceStatusApprovedBy",

        Remarks:
          "FinanceRemarks",
      },

      GM: {
        Status:
          "GMStatus",

        DateTime:
          "GMStatusDateTime",

        ApprovedBy:
          "GMStatusApprovedBy",

        Remarks:
          "GMRemarks",
      },
    };

    const columns =
      roleColumns[
        approvalRole
      ];

    // ============================================================
    // Update Current Approval Stage
    // ============================================================

    await client.query(
      `
      UPDATE Credit_Application_Approval

      SET
        ${columns.Status} = $1,
        ${columns.DateTime} = CURRENT_TIMESTAMP,
        ${columns.ApprovedBy} = $2,
        ${columns.Remarks} = $3,

        ModifiedBy = $2,
        ModifiedDate = CURRENT_TIMESTAMP

      WHERE CreditApplicationID = $4
        AND IsDeleted = FALSE;
      `,
      [
        newStatus,
        UserID,
        Remarks || null,
        CreditApplicationID,
      ],
    );

    // ============================================================
    // REJECT
    // Final Status = Rejected
    // ============================================================

    if (Action === "REJECT") {
      await client.query(
        `
        UPDATE Credit_Application_Approval

        SET
          FinalStatus = 'Rejected',
          FinalStatusDateTime = CURRENT_TIMESTAMP,

          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP

        WHERE CreditApplicationID = $2
          AND IsDeleted = FALSE;
        `,
        [
          UserID,
          CreditApplicationID,
        ],
      );
    }

    // ============================================================
    // RETURN
    // Final Status = Returned
    // ============================================================

    else if (Action === "RETURN") {
      await client.query(
        `
        UPDATE Credit_Application_Approval

        SET
          FinalStatus = 'Returned',
          FinalStatusDateTime = CURRENT_TIMESTAMP,

          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP

        WHERE CreditApplicationID = $2
          AND IsDeleted = FALSE;
        `,
        [
          UserID,
          CreditApplicationID,
        ],
      );
    }

    // ============================================================
    // APPROVE
    // Check Next Stage
    // ============================================================

    else if (Action === "APPROVE") {
      statusMap[
        approvalRole
      ] = "Approved";

      const nextStage =
        approvalFlow.find(
          (stage) =>
            normalizeCreditApprovalStatus(
              statusMap[
                stage.ApprovalRole
              ],
            ) !== "APPROVED",
        );

      // ==========================================================
      // No Next Stage
      // Fully Approved
      // ==========================================================

      if (!nextStage) {
        await client.query(
          `
          UPDATE Credit_Application_Approval

          SET
            FinalStatus = 'Approved',
            FinalStatusDateTime = CURRENT_TIMESTAMP,

            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP

          WHERE CreditApplicationID = $2
            AND IsDeleted = FALSE;
          `,
          [
            UserID,
            CreditApplicationID,
          ],
        );
      }

      // ==========================================================
      // Next Stage Available
      // Final remains Pending
      // ==========================================================

      else {
        await client.query(
          `
          UPDATE Credit_Application_Approval

          SET
            FinalStatus = 'Pending',
            FinalStatusDateTime = NULL,

            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP

          WHERE CreditApplicationID = $2
            AND IsDeleted = FALSE;
          `,
          [
            UserID,
            CreditApplicationID,
          ],
        );
      }
    }

    // ============================================================
    // Commit
    // ============================================================

    await client.query("COMMIT");

    return ok(
      `Credit Application ${newStatus.toLowerCase()} successfully.`,
    );

  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(
      error,
      "Process Credit Application approval",
    );

  } finally {
    client.release();
  }
};
// ============================================================UPDATE AR ID
const updateCreditApplicationARID = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      CreditApplicationID,
      ARID,

      UserID,
      UserType,
      DepartmentName,
    } = data;

    // ============================================================
    // Validate Credit Application ID
    // ============================================================

    const creditApplicationID =
      Number(CreditApplicationID);

    if (
      !Number.isSafeInteger(creditApplicationID) ||
      creditApplicationID <= 0
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Valid CreditApplicationID is required.",
        400,
      );
    }

    // ============================================================
    // Validate AR ID
    // ============================================================

    const arID =
      String(ARID || "").trim();

    if (!arID) {
      await client.query("ROLLBACK");

      return fail(
        "AR ID is required.",
        400,
      );
    }

    // ============================================================
    // Logged-In User Must Be FC
    // ============================================================

    const approvalRole =
      resolveCreditApplicationApprovalRole({
        UserType,
        DepartmentName,
      });

    if (
      approvalRole !== "FC"
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Only FC can update AR ID.",
        403,
      );
    }

    // ============================================================
    // Lock Credit Application + Approval
    // ============================================================

    const result =
      await client.query(
        `
        SELECT
          ca.CreditApplicationID,
          ca.OrganizationID,
          ca.ARID,

          approval.CreditApplicationApprovalID,

          approval.FinanceStatus,
          approval.GMStatus,

          approval.FinalStatus,
          approval.FinalStatusDateTime

        FROM Credit_Application_Entry_Master ca

        INNER JOIN Credit_Application_Approval approval
          ON approval.CreditApplicationID =
             ca.CreditApplicationID

         AND approval.IsDeleted = FALSE

        WHERE ca.CreditApplicationID = $1
          AND ca.IsDeleted = FALSE

        FOR UPDATE OF ca, approval;
        `,
        [
          creditApplicationID,
        ],
      );

    // ============================================================
    // Not Found
    // ============================================================

    if (
      result.rows.length === 0
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Credit Application record not found.",
        404,
      );
    }

    const row =
      result.rows[0];

    const OrganizationID =
      Number(
        row.organizationid,
      );

    // ============================================================
    // AR ID Already Added
    // ============================================================

    if (
      String(
        row.arid || "",
      ).trim() !== ""
    ) {
      await client.query("ROLLBACK");

      return fail(
        "AR ID has already been added for this Credit Application.",
        400,
      );
    }

    // ============================================================
    // Get Approval Flow
    //
    // Organization Config Available
    //      → Config Flow
    //
    // Config Not Available
    //      → Default FC -> GM
    // ============================================================

    const approvalFlow =
      await getCreditApplicationApprovalFlow(
        OrganizationID,
        client,
      );

    // ============================================================
    // Validate Approval Flow
    // ============================================================

    if (
      !Array.isArray(approvalFlow) ||
      approvalFlow.length === 0
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Credit Application approval flow is not configured.",
        400,
      );
    }

    for (
      const stage of approvalFlow
    ) {
      if (
        !CREDIT_APPLICATION_APPROVAL_ROLES.has(
          stage.ApprovalRole,
        )
      ) {
        await client.query("ROLLBACK");

        return fail(
          `Invalid approval role configured: ${stage.ApprovalRole}.`,
          400,
        );
      }
    }

    // ============================================================
    // Current Approval Status Map
    // ============================================================

    const statusMap = {
      FC:
        row.financestatus ||
        "Pending",

      GM:
        row.gmstatus ||
        "Pending",
    };

    // ============================================================
    // Check Configured Approval Flow
    //
    // Every configured stage must be Approved
    // ============================================================

    const pendingStage =
      approvalFlow.find(
        (stage) =>
          normalizeCreditApprovalStatus(
            statusMap[
              stage.ApprovalRole
            ],
          ) !== "APPROVED",
      );

    if (pendingStage) {
      await client.query("ROLLBACK");

      const pendingStatus =
        normalizeCreditApprovalStatus(
          statusMap[
            pendingStage.ApprovalRole
          ],
        );

      return fail(
        `${pendingStage.ApprovalRole} approval is ${pendingStatus}. AR ID can be added only after all approvals are completed.`,
        400,
      );
    }

    // ============================================================
    // Final Status Must Be Approved
    // ============================================================

    if (
      normalizeCreditApprovalStatus(
        row.finalstatus,
      ) !== "APPROVED"
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Credit Application must be fully approved before updating AR ID.",
        400,
      );
    }

    // ============================================================
    // Update AR ID
    // ============================================================

    const updateResult =
      await client.query(
        `
        UPDATE Credit_Application_Entry_Master

        SET
          ARID = $1,

          ModifiedBy = $2,
          ModifiedDate = CURRENT_TIMESTAMP

        WHERE CreditApplicationID = $3
          AND IsDeleted = FALSE

        RETURNING
          CreditApplicationID,
          ARID;
        `,
        [
          arID,
          UserID,
          creditApplicationID,
        ],
      );

    // ============================================================
    // Safety Check
    // ============================================================

    if (
      updateResult.rows.length === 0
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Unable to update AR ID.",
        400,
      );
    }

    // ============================================================
    // Commit
    // ============================================================

    await client.query("COMMIT");

    return ok(
      "AR ID updated successfully.",
      {
        CreditApplicationID:
          Number(
            updateResult.rows[0]
              .creditapplicationid,
          ),

        ARID:
          updateResult.rows[0]
            .arid,
      },
    );

  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(
      error,
      "Update Credit Application AR ID",
    );

  } finally {
    client.release();
  }
};
// ============================================================ Create Approval Config
const createCreditApplicationApprovalConfig = async (data) => {
  let client;
  let transactionStarted = false;

  try {
    const OrganizationID =
      Number(
        data.OrganizationID,
      );

    const approvals =
      Array.isArray(
        data.Approvals,
      )
        ? data.Approvals
        : [];

    // ============================================================
    // VALIDATION
    // ============================================================

    if (
      !Number.isInteger(
        OrganizationID,
      ) ||
      OrganizationID <= 0
    ) {
      return fail(
        "OrganizationID is required.",
        400,
      );
    }

    if (
      approvals.length === 0
    ) {
      return fail(
        "At least one approval configuration is required.",
        400,
      );
    }

    // ============================================================
    // NORMALIZE
    // ============================================================

    const normalizedApprovals =
      approvals.map(
        (approval) => ({
          ApprovalLevel:
            Number(
              approval.ApprovalLevel,
            ),

          ApprovalRole:
            normalizeCreditApplicationApprovalRole(
              approval.ApprovalRole,
            ),

          ApprovalOrder:
            Number(
              approval.ApprovalOrder,
            ),

          // Backend se automatic TRUE
          IsMandatory: true,
        }),
      );

    // ============================================================
    // DUPLICATE + ROLE VALIDATION
    // ============================================================

    const levels =
      new Set();

    const roles =
      new Set();

    const orders =
      new Set();

    for (
      const approval of
      normalizedApprovals
    ) {
      const {
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
      } = approval;

      if (
        !Number.isInteger(
          ApprovalLevel,
        ) ||
        ApprovalLevel < 1
      ) {
        return fail(
          "ApprovalLevel must be a positive integer.",
          400,
        );
      }

      if (
        !Number.isInteger(
          ApprovalOrder,
        ) ||
        ApprovalOrder < 1
      ) {
        return fail(
          "ApprovalOrder must be a positive integer.",
          400,
        );
      }

      if (
        !CREDIT_APPLICATION_APPROVAL_ROLES.has(
          ApprovalRole,
        )
      ) {
        return fail(
          "ApprovalRole must be FC or GM.",
          400,
        );
      }

      if (
        levels.has(
          ApprovalLevel,
        )
      ) {
        return fail(
          `Approval level ${ApprovalLevel} is duplicated in request.`,
          409,
        );
      }

      if (
        roles.has(
          ApprovalRole,
        )
      ) {
        return fail(
          `${ApprovalRole} approval stage is duplicated in request.`,
          409,
        );
      }

      if (
        orders.has(
          ApprovalOrder,
        )
      ) {
        return fail(
          `Approval order ${ApprovalOrder} is duplicated in request.`,
          409,
        );
      }

      levels.add(
        ApprovalLevel,
      );

      roles.add(
        ApprovalRole,
      );

      orders.add(
        ApprovalOrder,
      );
    }

    // ============================================================
    // TRANSACTION
    // ============================================================

    client =
      await pool.connect();

    await client.query(
      "BEGIN",
    );

    transactionStarted =
      true;

    // ============================================================
    // GET EXISTING CONFIG
    // Active + Soft Deleted
    // ============================================================

    const existingResult =
      await client.query(
        `
        SELECT
          CreditApplicationApprovalConfigID
            AS "CreditApplicationApprovalConfigID",

          OrganizationID
            AS "OrganizationID",

          ApprovalLevel
            AS "ApprovalLevel",

          ApprovalRole
            AS "ApprovalRole",

          ApprovalOrder
            AS "ApprovalOrder",

          IsMandatory
            AS "IsMandatory",

          IsDeleted
            AS "IsDeleted"

        FROM Credit_Application_Approval_Config

        WHERE OrganizationID = $1

        ORDER BY
          ApprovalLevel ASC,
          CreditApplicationApprovalConfigID ASC

        FOR UPDATE;
        `,
        [
          OrganizationID,
        ],
      );

    const existingConfigs =
      existingResult.rows;

    // ============================================================
    // MAP EXISTING CONFIG BY LEVEL
    // ============================================================

    const existingByLevel =
      new Map();

    for (
      const row of
      existingConfigs
    ) {
      existingByLevel.set(
        Number(
          row.ApprovalLevel,
        ),
        row,
      );
    }

    const processedLevels =
      new Set();

    // ============================================================
    // INSERT / UPDATE / RESTORE
    // ============================================================

    for (
      const approval of
      normalizedApprovals
    ) {
      const {
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
        IsMandatory,
      } = approval;

      const existing =
        existingByLevel.get(
          ApprovalLevel,
        );

      // ==========================================================
      // EXISTING RECORD
      // ==========================================================

      if (existing) {
        const ConfigID =
          Number(
            existing
              .CreditApplicationApprovalConfigID,
          );

        if (
          !Number.isInteger(
            ConfigID,
          )
        ) {
          throw new Error(
            `Invalid CreditApplicationApprovalConfigID: ${existing.CreditApplicationApprovalConfigID}`,
          );
        }

        // ========================================================
        // RESTORE SOFT DELETED
        // ========================================================

        if (
          existing.IsDeleted ===
          true
        ) {
          await client.query(
            `
            UPDATE Credit_Application_Approval_Config

            SET
              ApprovalRole = $1,
              ApprovalOrder = $2,
              IsMandatory = $3,

              IsDeleted = FALSE,

              ModifiedBy = $4,
              ModifiedDate =
                CURRENT_TIMESTAMP,

              DeletedBy = NULL,
              DeletedDate = NULL

            WHERE
              CreditApplicationApprovalConfigID = $5

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
        }

        // ========================================================
        // NORMAL UPDATE
        // ========================================================

        else {
          await client.query(
            `
            UPDATE Credit_Application_Approval_Config

            SET
              ApprovalRole = $1,
              ApprovalOrder = $2,
              IsMandatory = $3,

              ModifiedBy = $4,
              ModifiedDate =
                CURRENT_TIMESTAMP

            WHERE
              CreditApplicationApprovalConfigID = $5

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
        }
      }

      // ==========================================================
      // NEW INSERT
      // ==========================================================

      else {
        await client.query(
          `
          INSERT INTO Credit_Application_Approval_Config
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
            TRUE,

            FALSE,

            $5,
            CURRENT_TIMESTAMP
          );
          `,
          [
            OrganizationID,
            ApprovalLevel,
            ApprovalRole,
            ApprovalOrder,
            data.UserID,
          ],
        );
      }

      processedLevels.add(
        ApprovalLevel,
      );
    }

    // ============================================================
    // SOFT DELETE
    //
    // DB me active hai
    // lekin new request me nahi hai
    // ============================================================

    for (
      const existing of
      existingConfigs
    ) {
      const level =
        Number(
          existing.ApprovalLevel,
        );

      if (
        existing.IsDeleted ===
          false &&
        !processedLevels.has(
          level,
        )
      ) {
        const ConfigID =
          Number(
            existing
              .CreditApplicationApprovalConfigID,
          );

        if (
          !Number.isInteger(
            ConfigID,
          )
        ) {
          throw new Error(
            `Invalid CreditApplicationApprovalConfigID: ${existing.CreditApplicationApprovalConfigID}`,
          );
        }

        await client.query(
          `
          UPDATE Credit_Application_Approval_Config

          SET
            IsDeleted = TRUE,

            DeletedBy = $1,
            DeletedDate =
              CURRENT_TIMESTAMP,

            ModifiedBy = $1,
            ModifiedDate =
              CURRENT_TIMESTAMP

          WHERE
            CreditApplicationApprovalConfigID = $2

            AND OrganizationID = $3

            AND IsDeleted = FALSE;
          `,
          [
            data.UserID,
            ConfigID,
            OrganizationID,
          ],
        );
      }
    }

    // ============================================================
    // COMMIT
    // ============================================================

    await client.query(
      "COMMIT",
    );

    transactionStarted =
      false;

    return ok(
      "Credit Application approval configuration saved successfully.",
    );

  } catch (error) {
    if (
      client &&
      transactionStarted
    ) {
      await client.query(
        "ROLLBACK",
      );
    }

    console.error(
      "Save Credit Application Approval Config Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(
        error,
      );

    if (retryResponse) {
      return retryResponse;
    }

    if (
      error.code === "23505"
    ) {
      return fail(
        "Credit Application approval configuration already exists.",
        409,
      );
    }

    if (
      error.code === "23503"
    ) {
      return fail(
        "Invalid organization or user.",
        400,
      );
    }

    return fail(
      "Unable to save Credit Application approval configuration at this time.",
      500,
    );

  } finally {
    if (client) {
      client.release();
    }
  }
};
// ============================================================ Approval Config List
const getCreditApplicationApprovalConfigList = async (data) => {
  try {
    const OrganizationID =
      Number(
        data.OrganizationID,
      );

    if (
      !Number.isSafeInteger(
        OrganizationID,
      ) ||
      OrganizationID <= 0
    ) {
      return fail(
        "Valid OrganizationID is required.",
        400,
      );
    }

    const result =
      await pool.query(
        `
        SELECT
          CreditApplicationApprovalConfigID,
          ApprovalLevel,
          ApprovalRole,
          ApprovalOrder,
          IsMandatory,
          CreatedDate

        FROM Credit_Application_Approval_Config

        WHERE OrganizationID = $1
          AND IsDeleted = FALSE

        ORDER BY
          ApprovalOrder ASC,
          ApprovalLevel ASC;
        `,
        [
          OrganizationID,
        ],
      );

    const CreatedDate =
      result.rows.length > 0
        ? formatDate(
            result.rows[0]
              .createddate,
          )
        : null;

    const approvals =
      result.rows.map(
        (row) => ({
          CreditApplicationApprovalConfigID:
            Number(
              row.creditapplicationapprovalconfigid,
            ),

          ApprovalLevel:
            Number(
              row.approvallevel,
            ),

          ApprovalRole:
            normalizeCreditApplicationApprovalRole(
              row.approvalrole,
            ),

          ApprovalOrder:
            Number(
              row.approvalorder,
            ),

          IsMandatory:
            Boolean(
              row.ismandatory,
            ),
        }),
      );

    return ok(
      "Credit Application approval config fetched successfully.",
      {
        OrganizationID,

        CreatedDate,

        Count:
          approvals.length,

        data:
          approvals,
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch Credit Application approval config",
    );
  }
};
// ============================================================Delete Approval Config
const deleteCreditApplicationApprovalConfig = async (data) => {
  try {
    const CreditApplicationApprovalConfigID =
      Number(
        data.CreditApplicationApprovalConfigID,
      );

    const UserID =
      Number(
        data.UserID,
      );

    if (
      !Number.isSafeInteger(
        CreditApplicationApprovalConfigID,
      ) ||
      CreditApplicationApprovalConfigID <= 0
    ) {
      return fail(
        "Valid CreditApplicationApprovalConfigID is required.",
        400,
      );
    }

    const result =
      await pool.query(
        `
        UPDATE Credit_Application_Approval_Config

        SET
          IsDeleted = TRUE,

          DeletedBy = $1,
          DeletedDate =
            CURRENT_TIMESTAMP,

          ModifiedBy = $1,
          ModifiedDate =
            CURRENT_TIMESTAMP

        WHERE
          CreditApplicationApprovalConfigID = $2

          AND IsDeleted = FALSE

        RETURNING
          CreditApplicationApprovalConfigID;
        `,
        [
          UserID,
          CreditApplicationApprovalConfigID,
        ],
      );

    if (
      result.rows.length === 0
    ) {
      return fail(
        "Credit Application approval config not found.",
        404,
      );
    }

    return ok(
      "Credit Application approval config deleted successfully.",
      {
        CreditApplicationApprovalConfigID,
      },
    );

  } catch (error) {
    const retryResponse =
      retryableDatabaseResponse(
        error,
      );

    if (retryResponse) {
      return retryResponse;
    }

    return databaseFailure(
      error,
      "Delete Credit Application approval config",
    );
  }
};
// ========================================================================Reports
// ============================================================COMPANY WISE REPORT
const getCompanyWiseReport = async (data) => {
  try {
    // ============================================================
    // Organization
    // ============================================================

    const OrganizationID =
      Number(data.OrganizationID);

    if (
      !Number.isSafeInteger(OrganizationID) ||
      OrganizationID <= 0
    ) {
      return fail(
        "Valid OrganizationID is required.",
        400,
      );
    }

    // ============================================================
    // Pagination
    // ============================================================

    const page =
      Number(data.page) || 1;

    const PageSize =
      Number(data.PageSize) || 10;

    if (
      !Number.isInteger(page) ||
      page <= 0
    ) {
      return fail(
        "page must be a positive integer.",
        400,
      );
    }

    if (
      !Number.isInteger(PageSize) ||
      PageSize <= 0 ||
      PageSize > 100
    ) {
      return fail(
        "PageSize must be between 1 and 100.",
        400,
      );
    }

    const offset =
      (page - 1) * PageSize;

    // ============================================================
    // Filters
    // ============================================================

    const CompanyName =
      data.CompanyName !== undefined &&
      data.CompanyName !== null &&
      String(data.CompanyName).trim() !== ""
        ? String(data.CompanyName).trim()
        : null;

    const FromDate =
      data.FromDate !== undefined &&
      data.FromDate !== null &&
      String(data.FromDate).trim() !== ""
        ? String(data.FromDate).trim()
        : null;

    const ToDate =
      data.ToDate !== undefined &&
      data.ToDate !== null &&
      String(data.ToDate).trim() !== ""
        ? String(data.ToDate).trim()
        : null;

    // ============================================================
    // Date Validation
    // ============================================================

    const dateFormat =
      /^\d{4}-\d{2}-\d{2}$/;

    if (
      FromDate &&
      !dateFormat.test(FromDate)
    ) {
      return fail(
        "FromDate must be in YYYY-MM-DD format.",
        400,
      );
    }

    if (
      ToDate &&
      !dateFormat.test(ToDate)
    ) {
      return fail(
        "ToDate must be in YYYY-MM-DD format.",
        400,
      );
    }

    if (
      FromDate &&
      ToDate &&
      FromDate > ToDate
    ) {
      return fail(
        "FromDate cannot be greater than ToDate.",
        400,
      );
    }

    // ============================================================
    // WHERE
    // ============================================================

    let whereClause = `
      WHERE ca.IsDeleted = FALSE
        AND ca.OrganizationID = $1
    `;

    const params = [
      OrganizationID,
    ];

    // ============================================================
    // Company Filter
    // ============================================================

    if (CompanyName) {
      params.push(
        CompanyName,
      );

      whereClause += `
        AND COALESCE(
          ca.CompanyName,
          ''
        ) ILIKE '%' ||
          $${params.length} ||
          '%'
      `;
    }

    // ============================================================
    // From Date
    // ============================================================

    if (FromDate) {
      params.push(
        FromDate,
      );

      whereClause += `
        AND ca.ApplicationDate >=
            $${params.length}::date
      `;
    }

    // ============================================================
    // To Date
    // ============================================================

    if (ToDate) {
      params.push(
        ToDate,
      );

      whereClause += `
        AND ca.ApplicationDate <=
            $${params.length}::date
      `;
    }

    // ============================================================
    // Count Companies
    // ============================================================

    const countResult =
      await pool.query(
        `
        SELECT
          COUNT(*)::bigint
            AS TotalCount

        FROM
        (
          SELECT
            UPPER(
              TRIM(
                ca.CompanyName
              )
            )

          FROM Credit_Application_Entry_Master ca

          LEFT JOIN Credit_Application_Approval approval
            ON approval.CreditApplicationID =
               ca.CreditApplicationID

           AND approval.IsDeleted = FALSE

          ${whereClause}

          GROUP BY
            UPPER(
              TRIM(
                ca.CompanyName
              )
            )

        ) company_group;
        `,
        params,
      );

    const TotalCount =
      Number(
        countResult.rows[0]
          ?.totalcount || 0,
      );

    // ============================================================
    // Pagination Params
    // ============================================================

    const listParams = [
      ...params,
      PageSize,
      offset,
    ];

    const limitIndex =
      params.length + 1;

    const offsetIndex =
      params.length + 2;

    // ============================================================
    // Report
    // ============================================================

    const result =
      await pool.query(
        `
        SELECT
          MIN(
            TRIM(
              ca.CompanyName
            )
          ) AS CompanyName,

          COUNT(
            ca.CreditApplicationID
          )::bigint
            AS TotalApplications,

          COALESCE(
            SUM(
              ca.CreditAmountAllowed
            ),
            0
          )
            AS TotalCreditAmount,

          COALESCE(
            SUM(
              ca.ExpectedBusinessFY
            ),
            0
          )
            AS TotalExpectedBusinessFY,

          -- ======================================================
          -- Pending
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE UPPER(
              TRIM(
                COALESCE(
                  approval.FinalStatus,
                  'Pending'
                )
              )
            ) = 'PENDING'
          )::bigint
            AS PendingCount,

          -- ======================================================
          -- Approved
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE UPPER(
              TRIM(
                COALESCE(
                  approval.FinalStatus,
                  ''
                )
              )
            ) = 'APPROVED'
          )::bigint
            AS ApprovedCount,

          -- ======================================================
          -- Rejected
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE UPPER(
              TRIM(
                COALESCE(
                  approval.FinalStatus,
                  ''
                )
              )
            ) = 'REJECTED'
          )::bigint
            AS RejectedCount,

          -- ======================================================
          -- Returned
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE UPPER(
              TRIM(
                COALESCE(
                  approval.FinalStatus,
                  ''
                )
              )
            ) = 'RETURNED'
          )::bigint
            AS ReturnedCount,

          -- ======================================================
          -- AR CREATED
          -- ARID available
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE NULLIF(
              TRIM(
                COALESCE(
                  ca.ARID,
                  ''
                )
              ),
              ''
            ) IS NOT NULL
          )::bigint
            AS ARCreatedCount,

          -- ======================================================
          -- AR PENDING
          -- ARID null / blank
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE NULLIF(
              TRIM(
                COALESCE(
                  ca.ARID,
                  ''
                )
              ),
              ''
            ) IS NULL
          )::bigint
            AS ARPendingCount

        FROM Credit_Application_Entry_Master ca

        LEFT JOIN Credit_Application_Approval approval
          ON approval.CreditApplicationID =
             ca.CreditApplicationID

         AND approval.IsDeleted = FALSE

        ${whereClause}

        GROUP BY
          UPPER(
            TRIM(
              ca.CompanyName
            )
          )

        ORDER BY
          CompanyName ASC

        LIMIT $${limitIndex}
        OFFSET $${offsetIndex};
        `,
        listParams,
      );

    // ============================================================
    // Mapping
    // ============================================================

    const records =
      result.rows.map(
        (row) => ({
          CompanyName:
            row.companyname,

          TotalApplications:
            Number(
              row.totalapplications,
            ),

          TotalCreditAmount:
            Number(
              row.totalcreditamount,
            ),

          TotalExpectedBusinessFY:
            Number(
              row.totalexpectedbusinessfy,
            ),

          PendingCount:
            Number(
              row.pendingcount,
            ),

          ApprovedCount:
            Number(
              row.approvedcount,
            ),

          RejectedCount:
            Number(
              row.rejectedcount,
            ),

          ReturnedCount:
            Number(
              row.returnedcount,
            ),

          ARCreatedCount:
            Number(
              row.arcreatedcount,
            ),

          ARPendingCount:
            Number(
              row.arpendingcount,
            ),
        }),
      );

    // ============================================================
    // Pagination
    // ============================================================

    const TotalPages =
      TotalCount > 0
        ? Math.ceil(
            TotalCount /
              PageSize,
          )
        : 0;

    // ============================================================
    // Response
    // ============================================================

    return ok(
      "Company-wise Credit Application report fetched successfully.",
      {
        TotalCount,

        PageCount:
          records.length,

        CurrentPage:
          page,

        PageSize,

        TotalPages,

        data:
          records,
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch company-wise Credit Application report",
    );
  }
};
// ============================================================ORGANIZATION WISE REPORT
const getOrganizationWiseReport = async (data) => {
  try {
    // ============================================================
    // Organization
    // Optional
    // ============================================================

    const OrganizationID =
      data.OrganizationID !== undefined &&
      data.OrganizationID !== null &&
      String(data.OrganizationID).trim() !== ""
        ? Number(
            data.OrganizationID,
          )
        : null;

    if (
      OrganizationID !== null &&
      (
        !Number.isSafeInteger(
          OrganizationID,
        ) ||
        OrganizationID <= 0
      )
    ) {
      return fail(
        "Valid OrganizationID is required.",
        400,
      );
    }

    // ============================================================
    // Pagination
    // ============================================================

    const page =
      Number(data.page) || 1;

    const PageSize =
      Number(data.PageSize) || 10;

    if (
      !Number.isInteger(page) ||
      page <= 0
    ) {
      return fail(
        "page must be a positive integer.",
        400,
      );
    }

    if (
      !Number.isInteger(PageSize) ||
      PageSize <= 0 ||
      PageSize > 100
    ) {
      return fail(
        "PageSize must be between 1 and 100.",
        400,
      );
    }

    const offset =
      (page - 1) * PageSize;

    // ============================================================
    // Dates
    // ============================================================

    const FromDate =
      data.FromDate !== undefined &&
      data.FromDate !== null &&
      String(data.FromDate).trim() !== ""
        ? String(data.FromDate).trim()
        : null;

    const ToDate =
      data.ToDate !== undefined &&
      data.ToDate !== null &&
      String(data.ToDate).trim() !== ""
        ? String(data.ToDate).trim()
        : null;

    const dateFormat =
      /^\d{4}-\d{2}-\d{2}$/;

    if (
      FromDate &&
      !dateFormat.test(FromDate)
    ) {
      return fail(
        "FromDate must be in YYYY-MM-DD format.",
        400,
      );
    }

    if (
      ToDate &&
      !dateFormat.test(ToDate)
    ) {
      return fail(
        "ToDate must be in YYYY-MM-DD format.",
        400,
      );
    }

    if (
      FromDate &&
      ToDate &&
      FromDate > ToDate
    ) {
      return fail(
        "FromDate cannot be greater than ToDate.",
        400,
      );
    }

    // ============================================================
    // WHERE
    // ============================================================

    let whereClause = `
      WHERE ca.IsDeleted = FALSE
    `;

    const params = [];

    // ============================================================
    // Organization Filter
    // ============================================================

    if (
      OrganizationID !== null
    ) {
      params.push(
        OrganizationID,
      );

      whereClause += `
        AND ca.OrganizationID =
            $${params.length}
      `;
    }

    // ============================================================
    // From Date
    // ============================================================

    if (FromDate) {
      params.push(
        FromDate,
      );

      whereClause += `
        AND ca.ApplicationDate >=
            $${params.length}::date
      `;
    }

    // ============================================================
    // To Date
    // ============================================================

    if (ToDate) {
      params.push(
        ToDate,
      );

      whereClause += `
        AND ca.ApplicationDate <=
            $${params.length}::date
      `;
    }

    // ============================================================
    // Count Organizations
    // ============================================================

    const countResult =
      await pool.query(
        `
        SELECT
          COUNT(
            DISTINCT ca.OrganizationID
          )::bigint
            AS TotalCount

        FROM Credit_Application_Entry_Master ca

        ${whereClause};
        `,
        params,
      );

    const TotalCount =
      Number(
        countResult.rows[0]
          ?.totalcount || 0,
      );

    // ============================================================
    // Pagination Params
    // ============================================================

    const listParams = [
      ...params,
      PageSize,
      offset,
    ];

    const limitIndex =
      params.length + 1;

    const offsetIndex =
      params.length + 2;

    // ============================================================
    // Organization Wise Report
    // ============================================================

    const result =
      await pool.query(
        `
        SELECT
          ca.OrganizationID,

          om.OrganizationName,

          om.ShortName
            AS OrganizationShortName,

          COUNT(
            ca.CreditApplicationID
          )::bigint
            AS TotalApplications,

          COALESCE(
            SUM(
              ca.CreditAmountAllowed
            ),
            0
          )
            AS TotalCreditAmount,

          -- ======================================================
          -- Pending
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE UPPER(
              TRIM(
                COALESCE(
                  approval.FinalStatus,
                  'Pending'
                )
              )
            ) = 'PENDING'
          )::bigint
            AS PendingCount,

          -- ======================================================
          -- Approved
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE UPPER(
              TRIM(
                COALESCE(
                  approval.FinalStatus,
                  ''
                )
              )
            ) = 'APPROVED'
          )::bigint
            AS ApprovedCount,

          -- ======================================================
          -- Rejected
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE UPPER(
              TRIM(
                COALESCE(
                  approval.FinalStatus,
                  ''
                )
              )
            ) = 'REJECTED'
          )::bigint
            AS RejectedCount,

          -- ======================================================
          -- AR CREATED
          -- ARID available
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE NULLIF(
              TRIM(
                COALESCE(
                  ca.ARID,
                  ''
                )
              ),
              ''
            ) IS NOT NULL
          )::bigint
            AS ARCreatedCount,

          -- ======================================================
          -- AR PENDING
          -- ARID null / blank
          -- ======================================================

          COUNT(*) FILTER
          (
            WHERE NULLIF(
              TRIM(
                COALESCE(
                  ca.ARID,
                  ''
                )
              ),
              ''
            ) IS NULL
          )::bigint
            AS ARPendingCount

        FROM Credit_Application_Entry_Master ca

        LEFT JOIN Organization_Master om
          ON om.OrganizationID =
             ca.OrganizationID

         AND om.IsDeleted = FALSE

        LEFT JOIN Credit_Application_Approval approval
          ON approval.CreditApplicationID =
             ca.CreditApplicationID

         AND approval.IsDeleted = FALSE

        ${whereClause}

        GROUP BY
          ca.OrganizationID,
          om.OrganizationName,
          om.ShortName

        ORDER BY
          om.OrganizationName ASC,
          ca.OrganizationID ASC

        LIMIT $${limitIndex}
        OFFSET $${offsetIndex};
        `,
        listParams,
      );

    // ============================================================
    // Mapping
    // ============================================================

    const records =
      result.rows.map(
        (row) => ({
          OrganizationID:
            Number(
              row.organizationid,
            ),

          OrganizationName:
            row.organizationname,

          OrganizationShortName:
            row.organizationshortname,

          TotalApplications:
            Number(
              row.totalapplications,
            ),

          TotalCreditAmount:
            Number(
              row.totalcreditamount,
            ),

          PendingCount:
            Number(
              row.pendingcount,
            ),

          ApprovedCount:
            Number(
              row.approvedcount,
            ),

          RejectedCount:
            Number(
              row.rejectedcount,
            ),

          ARCreatedCount:
            Number(
              row.arcreatedcount,
            ),

          ARPendingCount:
            Number(
              row.arpendingcount,
            ),
        }),
      );

    // ============================================================
    // Pagination
    // ============================================================

    const TotalPages =
      TotalCount > 0
        ? Math.ceil(
            TotalCount /
              PageSize,
          )
        : 0;

    // ============================================================
    // Response
    // ============================================================

    return ok(
      "Organization-wise Credit Application report fetched successfully.",
      {
        TotalCount,

        PageCount:
          records.length,

        CurrentPage:
          page,

        PageSize,

        TotalPages,

        data:
          records,
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch organization-wise Credit Application report",
    );
  }
};
// ========================================================================PDFs
// ============================================================CREDIT APPLICATION LIST PDF
const generateCreditApplicationListPdf = async (data) => {
  try {
    // ============================================================
    // Prepared Rows
    // Same rows fetched from getCreditApplicationList
    // ============================================================

    let creditApplicationRows =
      Array.isArray(data.PreparedRows)
        ? data.PreparedRows
        : null;

    // PDF aur list API ko ek hi source of truth par rakho. Isse role-based
    // visibility, Status/Date filters, GM access aur FC ARID-pending state
    // dono responses mein exactly same rahenge.
    if (!creditApplicationRows) {
      creditApplicationRows = [];

      const firstPageResult =
        await getCreditApplicationList({
          ...data,
          page: 1,
          PageSize: 100,
        });

      if (!firstPageResult.success) {
        return firstPageResult;
      }

      creditApplicationRows.push(
        ...(firstPageResult.data?.data || []),
      );

      const totalPages = Number(
        firstPageResult.data?.TotalPages || 0,
      );

      for (let page = 2; page <= totalPages; page += 1) {
        const pageResult =
          await getCreditApplicationList({
            ...data,
            page,
            PageSize: 100,
          });

        if (!pageResult.success) {
          return pageResult;
        }

        creditApplicationRows.push(
          ...(pageResult.data?.data || []),
        );
      }
    }

    // ============================================================
    // Organization
    // ============================================================

    const organizationId =
      Number(data.OrganizationID) ||
      creditApplicationRows[0]?.OrganizationID ||
      null;

    // ============================================================
    // Organization Name
    // ============================================================

    let organizationName = null;

    if (organizationId) {
      const organizationResult =
        await pool.query(
          `
          SELECT
            OrganizationName

          FROM Organization_Master

          WHERE OrganizationID = $1
            AND IsDeleted = FALSE

          LIMIT 1;
          `,
          [
            organizationId,
          ],
        );

      organizationName =
        organizationResult.rows[0]
          ?.organizationname ||
        null;
    }

    organizationName ||=
      creditApplicationRows[0]
        ?.OrganizationShortName ||
      "All Organizations";

    // ============================================================
    // Serial Number
    // ============================================================

    const pdfRows =
      creditApplicationRows.map(
        (row, index) => ({
          ...row,

          ExportSerialNumber:
            index + 1,
        }),
      );

    // ============================================================
    // Approval Status Helper
    //
    // FC column:
    // supports FC / FINANCE role name
    // ============================================================

    const approvalStatus = (
      row,
      roles,
    ) => {
      const normalizedRoles =
        roles.map(
          (role) =>
            String(role)
              .trim()
              .toUpperCase(),
        );

      const approval =
        (row.Approvals || []).find(
          (item) =>
            normalizedRoles.includes(
              String(
                item.ApprovalRole ||
                  "",
              )
                .trim()
                .toUpperCase(),
            ),
        );

      return (
        approval?.Status ||
        "Pending"
      );
    };

    // ============================================================
    // PDF Columns
    //
    // Same Fields As Credit Approval List UI
    // ============================================================

    const columns = [
      {
        header: "#Sr",

        value: (row) =>
          row.ExportSerialNumber,

        width: 30,

        align: "center",
      },

      {
        header: "DATE",

        value: (row) =>
          row.ApplicationDate,

        width: 65,
      },

      {
        header: "COMPANY / FIRM NAME",

        value: (row) =>
          row.CompanyName,

        width: 155,
      },

      {
        header: "POSITION",

        value: (row) =>
          row.Position,

        width: 95,
      },

      {
        header:
          "CREDIT & REFERENCE CHECKED BY",

        value: (row) =>
          row.CreditReferenceCheckedBy,

        width: 155,
      },

      {
        header: "FC STATUS",

        value: (row) =>
          approvalStatus(
            row,
            [
              "FC",
              "FINANCE",
            ],
          ),

        width: 70,
      },

      {
        header: "GM STATUS",

        value: (row) =>
          approvalStatus(
            row,
            [
              "GM",
            ],
          ),

        width: 70,
      },

      {
        header: "ARID",

        value: (row) =>
          row.ARID,

        width: 80,
      },

    ];

    // ============================================================
    // Metadata
    // Same Filters As GET API
    // ============================================================

    const metadata = [
      {
        label: "Organization",
        value:
          organizationName,
      },

      {
        label: "Company",
        value:
          data.CompanyName ||
          "All",
      },

      {
        label: "Status",
        value:
          data.Status ||
          "All",
      },

      {
        label: "From Date",
        value:
          data.FromDate
            ? formatDate(
                data.FromDate,
              )
            : "All",
      },

      {
        label: "To Date",
        value:
          data.ToDate
            ? formatDate(
                data.ToDate,
              )
            : "All",
      },

      {
        label: "Total Records",
        value:
          creditApplicationRows.length,
      },
    ];

    // ============================================================
    // Generate PDF
    // ============================================================

    const pdfBuffer =
      await generatePdf({
        title:
          "CREDIT APPROVAL LIST",

        reportName:
          "Credit Approval List",

        organizationId,

        logoUrl:
          data.logoUrl,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          pdfRows,

        pageMargins: [
          20,
          25,
          20,
          35,
        ],
      });

    // ============================================================
    // Response
    // ============================================================

    return {
      success: true,

      message:
        "Credit Application list PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Credit_Approval_List_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {
    console.error(
      "Generate Credit Application List PDF Document Error:",
      error.message,
    );

    return fail(
      "Unable to generate Credit Application list PDF.",
      503,
    );
  }
};
// ============================================================COMPANY WISE REPORT PDf
const generateCompanyWiseReportPdf = async (data) => {
  try {
    // ============================================================
    // GET ALL RECORDS FROM SAME GET API
    // ============================================================

    const rows = [];

    const exportPageSize = 100;

    let page = 1;
    let totalPages = 1;

    do {
      const result =
        await getCompanyWiseReport({
          OrganizationID:
            data.OrganizationID,

          CompanyName:
            data.CompanyName,

          FromDate:
            data.FromDate,

          ToDate:
            data.ToDate,

          page,

          PageSize:
            exportPageSize,
        });

      if (!result.success) {
        return result;
      }

      const pageRows =
        Array.isArray(
          result.data?.data,
        )
          ? result.data.data
          : [];

      rows.push(
        ...pageRows,
      );

      totalPages =
        Number(
          result.data?.TotalPages,
        ) || 0;

      page += 1;

    } while (
      page <= totalPages
    );

    // ============================================================
    // ORGANIZATION FULL NAME
    // ============================================================

    const organizationResult = await pool.query(
      `
      SELECT OrganizationName
      FROM Organization_Master
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
      LIMIT 1;
      `,
      [Number(data.OrganizationID)],
    );

    const organizationName =
      organizationResult.rows[0]?.organizationname || "-";

    // ============================================================
    // PDF ROWS
    // ============================================================

    const pdfRows =
      rows.map(
        (row, index) => ({
          ...row,

          SerialNumber:
            index + 1,
        }),
      );

    // ============================================================
    // PDF COLUMNS
    // SAME DATA AS GET API
    // ============================================================

    const columns = [
      {
        header: "#",
        value: (row) =>
          row.SerialNumber,
        width: 30,
        align: "center",
      },

      {
        header: "COMPANY NAME",
        value: (row) =>
          row.CompanyName,
        width: "*",
      },

      {
        header: "TOTAL AMOUNT",
        value: (row) =>
          Number(
            row.TotalCreditAmount || 0,
          ).toLocaleString(
            "en-IN",
            {
              maximumFractionDigits: 2,
            },
          ),
        width: 80,
      },

      {
        header: "TOTAL",
        value: (row) =>
          row.TotalApplications,
        width: 65,
        align: "center",
      },

      {
        header: "PENDING",
        value: (row) =>
          row.PendingCount,
        width: 48,
        align: "center",
      },

      {
        header: "APPROVED",
        value: (row) =>
          row.ApprovedCount,
        width: 48,
        align: "center",
      },

      {
        header: "REJECTED",
        value: (row) =>
          row.RejectedCount,
        width: 48,
        align: "center",
      },

      {
        header: "RETURNED",
        value: (row) =>
          row.ReturnedCount,
        width: 48,
        align: "center",
      },

      {
        header: "AR CREATED",
        value: (row) =>
          row.ARCreatedCount,
        width: 50,
        align: "center",
      },

      {
        header: "AR PENDING",
        value: (row) =>
          row.ARPendingCount,
        width: 50,
        align: "center",
      },
    ];

    // ============================================================
    // METADATA
    // SAME FILTERS
    // ============================================================

    const metadata = [
      {
        label: "Organization",
        value:
          organizationName,
      },

      {
        label: "Company",
        value:
          data.CompanyName ||
          "All",
      },

      {
        label: "From Date",
        value:
          data.FromDate
            ? formatDate(
                data.FromDate,
              )
            : "All",
      },

      {
        label: "To Date",
        value:
          data.ToDate
            ? formatDate(
                data.ToDate,
              )
            : "All",
      },

    ];

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer =
      await generatePdf({
        title:
          "COMPANY WISE CREDIT APPLICATION REPORT",

        reportName:
          "Company Wise Credit Application Report",

        organizationId:
          Number(
            data.OrganizationID,
          ) || null,

        logoUrl:
          data.logoUrl,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          pdfRows,

        pageMargins: [
          18,
          25,
          18,
          35,
        ],
      });

    // ============================================================
    // RESPONSE
    // ============================================================

    return {
      success: true,

      message:
        "Company-wise Credit Application PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Company_Wise_Credit_Application_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {
    console.error(
      "Generate Company Wise Credit Application PDF Error:",
      error.message,
    );

    return fail(
      "Unable to generate Company-wise Credit Application PDF.",
      503,
    );
  }
};
// ============================================================ORGANIZATION WISE REPORT PDF
const generateOrganizationWiseReportPdf = async (data) => {
  try {
    // ============================================================
    // GET ALL RECORDS FROM SAME GET API
    // ============================================================

    const rows = [];

    // getOrganizationWiseReport max PageSize = 100
    const exportPageSize = 100;

    let page = 1;
    let totalPages = 1;

    do {
      const result =
        await getOrganizationWiseReport({
          OrganizationID:
            data.OrganizationID,

          FromDate:
            data.FromDate,

          ToDate:
            data.ToDate,

          page,

          PageSize:
            exportPageSize,
        });

      if (!result.success) {
        return result;
      }

      const pageRows =
        Array.isArray(
          result.data?.data,
        )
          ? result.data.data
          : [];

      rows.push(
        ...pageRows,
      );

      totalPages =
        Number(
          result.data?.TotalPages,
        ) || 0;

      page += 1;

    } while (
      page <= totalPages
    );

    // ============================================================
    // PDF ROWS
    // ============================================================

    const pdfRows =
      rows.map(
        (row, index) => ({
          ...row,

          SerialNumber:
            index + 1,
        }),
      );

    // ============================================================
    // PDF COLUMNS
    // SAME FIELDS AS GET API
    // ============================================================

    const columns = [
      {
        header: "#",
        value: (row) =>
          row.SerialNumber,
        width: 30,
        align: "center",
      },

      {
        header: "HTL",
        value: (row) =>
          row.OrganizationShortName,
        width: 120,
        align: "left",
      },

      {
        header: "TOTAL AMOUNT",
        value: (row) =>
          Number(
            row.TotalCreditAmount || 0,
          ).toLocaleString(
            "en-IN",
            {
              maximumFractionDigits: 2,
            },
          ),
        width: 130,
        align: "center",
      },

      {
        header: "TOTAL",
        value: (row) =>
          row.TotalApplications,
        width: 85,
        align: "center",
      },

      {
        header: "PENDING",
        value: (row) =>
          row.PendingCount,
        width: 70,
        align: "center",
      },

      {
        header: "APPROVED",
        value: (row) =>
          row.ApprovedCount,
        width: 70,
        align: "center",
      },

      {
        header: "REJECTED",
        value: (row) =>
          row.RejectedCount,
        width: 70,
        align: "center",
      },

      {
        header: "AR CREATED",
        value: (row) =>
          row.ARCreatedCount,
        width: 80,
        align: "center",
      },

      {
        header: "AR PENDING",
        value: (row) =>
          row.ARPendingCount,
        width: 80,
        align: "center",
      },
    ];

    // ============================================================
    // ORGANIZATION
    // Same GET data se
    // ============================================================

    const organizationId =
      data.OrganizationID !== undefined &&
      data.OrganizationID !== null &&
      String(
        data.OrganizationID,
      ).trim() !== ""
        ? Number(
            data.OrganizationID,
          )
        : null;

    const organizationName =
      organizationId
        ? (
            rows[0]?.OrganizationName ||
            rows[0]?.OrganizationShortName ||
            "-"
          )
        : "All Organizations";

    // ============================================================
    // METADATA
    // SAME FILTERS AS GET API
    // ============================================================

    const metadata = [
      {
        label: "Organization",
        value:
          organizationName,
      },

      {
        label: "From Date",
        value:
          data.FromDate
            ? formatDate(
                data.FromDate,
              )
            : "All",
      },

      {
        label: "To Date",
        value:
          data.ToDate
            ? formatDate(
                data.ToDate,
              )
            : "All",
      },

      {
        label: "Total Organizations",
        value:
          rows.length,
      },
    ];

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer =
      await generatePdf({
        title:
          "ORGANIZATION WISE CREDIT APPLICATION REPORT",

        reportName:
          "Organization Wise Credit Application Report",

        organizationId,

        logoUrl:
          data.logoUrl,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          pdfRows,

        pageMargins: [
          20,
          25,
          20,
          35,
        ],
      });

    // ============================================================
    // RESPONSE
    // ============================================================

    return {
      success: true,

      message:
        "Organization-wise Credit Application PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Organization_Wise_Credit_Application_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {
    console.error(
      "Generate Organization Wise Credit Application PDF Error:",
      error.message,
    );

    return fail(
      "Unable to generate Organization-wise Credit Application PDF.",
      503,
    );
  }
};
// ============================================================CREDIT APPLICATION Details  PDF
const generateCreditApplicationDetailPdf = async (data) => {
  try {
    // ============================================================
    // Validate ID
    // ============================================================

    const CreditApplicationID =
      Number(
        data.CreditApplicationID,
      );

    if (
      !Number.isSafeInteger(
        CreditApplicationID,
      ) ||
      CreditApplicationID <= 0
    ) {
      return fail(
        "Valid CreditApplicationID is required.",
        400,
      );
    }

    // ============================================================
    // SAME GET BY ID API
    // ============================================================

    const result =
      await getCreditApplicationById({
        CreditApplicationID,

        UserID:
          data.UserID,

        UserType:
          data.UserType,

        DepartmentName:
          data.DepartmentName,

        LoginType:
          data.LoginType,

        AllOrganizationAccess:
          data.AllOrganizationAccess,
      });

    if (!result.success) {
      return result;
    }

    const detail =
      result.data;

    if (!detail) {
      return fail(
        "Credit Application record not found.",
        404,
      );
    }

    const organizationID =
      Number(
        detail.OrganizationID,
      );

    // ============================================================
    // PDF COLORS
    // SAME AMC STYLE
    // ============================================================

    const COLORS = {
      navy: "#082B5C",

      label:
        "#082B5C",

      text:
        "#172033",

      muted:
        "#64748B",

      border:
        "#CFD7E3",

      labelBackground:
        "#F4F6F9",
    };

    // ============================================================
    // Display Helper
    // ============================================================

    const displayValue = (value) =>
      value === null ||
      value === undefined ||
      String(value).trim() === ""
        ? "-"
        : String(value);

    // ============================================================
    // Canvas Helpers
    // ============================================================

    const line = (
      x1,
      y1,
      x2,
      y2,
      lineWidth = 1.1,
    ) => ({
      type: "line",

      x1,
      y1,
      x2,
      y2,

      lineWidth,

      lineColor:
        COLORS.navy,
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

      lineWidth: 1.1,

      lineColor:
        COLORS.navy,
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

      lineWidth: 1.1,

      lineColor:
        COLORS.navy,
    });

    // ============================================================
    // Icons
    // ============================================================

    const fieldIcon = (type) => {
      const icons = {
        organization: [
          rect(4, 2, 10, 15, 1),
          line(1, 17, 17, 17),
          line(7, 6, 7, 8),
          line(11, 6, 11, 8),
          line(7, 11, 7, 13),
          line(11, 11, 11, 13),
        ],

        company: [
          rect(2, 4, 14, 12, 1),
          line(5, 7, 5, 13),
          line(9, 7, 9, 13),
          line(13, 7, 13, 13),
          line(1, 17, 17, 17),
        ],

        calendar: [
          rect(1, 4, 16, 13, 1),
          line(1, 8, 17, 8),
          line(5, 2, 5, 6),
          line(13, 2, 13, 6),
        ],

        person: [
          ellipse(9, 5, 3),

          {
            type:
              "polyline",

            points: [
              {
                x: 2,
                y: 17,
              },
              {
                x: 3,
                y: 13,
              },
              {
                x: 6,
                y: 11,
              },
              {
                x: 12,
                y: 11,
              },
              {
                x: 15,
                y: 13,
              },
              {
                x: 16,
                y: 17,
              },
            ],

            lineWidth:
              1.1,

            lineColor:
              COLORS.navy,
          },
        ],

        location: [
          ellipse(
            9,
            7,
            5,
          ),

          ellipse(
            9,
            7,
            1.5,
          ),

          {
            type:
              "polyline",

            points: [
              {
                x: 5,
                y: 10,
              },
              {
                x: 9,
                y: 18,
              },
              {
                x: 13,
                y: 10,
              },
            ],

            lineWidth:
              1.1,

            lineColor:
              COLORS.navy,
          },
        ],

        money: [
          ellipse(
            9,
            9,
            7,
          ),

          line(
            9,
            4,
            9,
            14,
          ),

          line(
            6,
            6,
            12,
            6,
          ),

          line(
            6,
            12,
            12,
            12,
          ),
        ],

        status: [
          ellipse(
            9,
            9,
            7,
          ),

          line(
            5,
            9,
            8,
            12,
          ),

          line(
            8,
            12,
            14,
            6,
          ),
        ],

        email: [
          rect(
            1,
            4,
            16,
            11,
            1,
          ),

          line(
            1,
            5,
            9,
            11,
          ),

          line(
            17,
            5,
            9,
            11,
          ),
        ],

        phone: [
          {
            type:
              "polyline",

            points: [
              {
                x: 4,
                y: 2,
              },
              {
                x: 7,
                y: 6,
              },
              {
                x: 5,
                y: 8,
              },
              {
                x: 10,
                y: 13,
              },
              {
                x: 12,
                y: 11,
              },
              {
                x: 16,
                y: 14,
              },
              {
                x: 14,
                y: 17,
              },
              {
                x: 10,
                y: 16,
              },
              {
                x: 5,
                y: 12,
              },
              {
                x: 2,
                y: 7,
              },
              {
                x: 2,
                y: 4,
              },
              {
                x: 4,
                y: 2,
              },
            ],

            lineWidth:
              1.1,

            lineColor:
              COLORS.navy,
          },
        ],

        document: [
          rect(
            3,
            1,
            12,
            16,
            1,
          ),

          line(
            6,
            6,
            12,
            6,
          ),

          line(
            6,
            9,
            12,
            9,
          ),

          line(
            6,
            12,
            11,
            12,
          ),
        ],
      };

      const iconScale =
        0.82;

      return (
        icons[type] ||
        icons.company
      ).map(
        (shape) => {
          const scaledShape = {
            ...shape,

            lineWidth:
              (shape.lineWidth || 1) *
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
              ] === "number"
            ) {
              scaledShape[
                coordinate
              ] *= iconScale;
            }
          }

          if (
            Array.isArray(
              scaledShape.points,
            )
          ) {
            scaledShape.points =
              scaledShape.points.map(
                (point) => ({
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

    // ============================================================
    // Cell Helpers
    // ============================================================

    const labelCell = (
      label,
      icon,
    ) => ({
      columns: [
        {
          width: 22,

          canvas:
            fieldIcon(icon),
        },

        {
          width:
            "*",

          text:
            label,

          style:
            "fieldLabel",

          margin: [
            2,
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
        5,
        6,
      ],
    });

    const valueCell = (
      value,
    ) => ({
      text:
        displayValue(
          value,
        ),

      style:
        "fieldValue",

      margin: [
        9,
        8,
        7,
        7,
      ],
    });

    const tableLayout = {
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

    const sectionHeading = (
      title,
    ) => ({
      text:
        title,

      fontSize:
        11,

      bold:
        true,

      color:
        COLORS.navy,

      margin: [
        0,
        4,
        0,
        7,
      ],
    });

    // ============================================================
    // Logo
    // SAME AMC PATTERN
    // ============================================================

    const logo =
      await loadLogo(
        organizationID,
        data.logoUrl,
      );

    const generatedOn =
      formatDate(
        new Date(),
        "DD MMM YYYY hh:mm A",
      );

    // ============================================================
    // Amount Values
    // ============================================================

    const creditAmount =
      detail.CreditAmountAllowed !==
        null &&
      detail.CreditAmountAllowed !==
        undefined
        ? Number(
            detail.CreditAmountAllowed,
          ).toLocaleString(
            "en-IN",
            {
              maximumFractionDigits: 2,
            },
          )
        : null;

    const expectedBusinessFY =
      detail.ExpectedBusinessFY !==
        null &&
      detail.ExpectedBusinessFY !==
        undefined
        ? Number(
            detail.ExpectedBusinessFY,
          ).toLocaleString(
            "en-IN",
            {
              maximumFractionDigits: 2,
            },
          )
        : null;

    // ============================================================
    // Approval Table
    // SAME Approval Array From GET
    // ============================================================

    const approvals =
      Array.isArray(
        detail.Approvals,
      )
        ? detail.Approvals
        : [];

    const approvalBody = [
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
            "Remarks",

          style:
            "tableHeader",
        },
      ],
    ];

    approvals.forEach(
      (approval) => {
        approvalBody.push([
          {
            text:
              displayValue(
                approval.ApprovalRole,
              ),

            style:
              "tableValue",
          },

          {
            text:
              displayValue(
                approval.Status,
              ),

            style:
              "tableValue",
          },

          {
            text:
              displayValue(
                approval.Remarks,
              ),

            style:
              "tableValue",
          },
        ]);
      },
    );

    if (
      approvals.length === 0
    ) {
      approvalBody.push([
        {
          text:
            "No approval data found.",

          colSpan:
            3,

          alignment:
            "center",

          style:
            "tableValue",
        },

        {},
        {},
      ]);
    }

    // ============================================================
    // Document Definition
    // SAME AMC STYLE
    // ============================================================

    const documentDefinition = {
      pageSize:
        "A4",

      pageOrientation:
        "portrait",

      pageMargins: [
        22,
        26,
        22,
        72,
      ],

      defaultStyle: {
        font:
          "Roboto",

        fontSize:
          9,

        color:
          COLORS.text,
      },

      content: [
        // ========================================================
        // Header
        // ========================================================

        {
          table: {
            widths: [
              130,
              "*",
              80,
            ],

            body: [
              [
                logo
                  ? {
                      image:
                        logo,

                      fit: [
                        88,
                        50,
                      ],

                      border: [
                        false,
                        false,
                        false,
                        false,
                      ],
                    }
                  : {
                      text:
                        "",

                      border: [
                        false,
                        false,
                        false,
                        false,
                      ],
                    },

                {
                  text:
                    "Credit Application Detail",

                  style:
                    "title",

                  alignment:
                    "center",

                  margin: [
                    0,
                    18,
                    0,
                    0,
                  ],

                  border: [
                    false,
                    false,
                    false,
                    false,
                  ],
                },

                {
                  text:
                    "",

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

        {
          canvas: [
            {
              type:
                "line",

              x1:
                0,

              y1:
                0,

              x2:
                551,

              y2:
                0,

              lineWidth:
                0.8,

              lineColor:
                COLORS.navy,
            },
          ],

          margin: [
            0,
            7,
            0,
            14,
          ],
        },

        // ========================================================
        // Company Details
        // ========================================================

        sectionHeading(
          "Company Details",
        ),

        {
          table: {
            widths: [
              115,
              "*",
              115,
              "*",
            ],

            body: [
              [
                labelCell(
                  "Organization",
                  "organization",
                ),

                valueCell(
                  detail
                    .OrganizationShortName ||
                    detail
                      .OrganizationName,
                ),

                labelCell(
                  "Application Date",
                  "calendar",
                ),

                valueCell(
                  detail.ApplicationDate,
                ),
              ],

              [
                labelCell(
                  "Company / Firm",
                  "company",
                ),

                valueCell(
                  detail.CompanyName,
                ),

                labelCell(
                  "GSTIN",
                  "document",
                ),

                valueCell(
                  detail.CompanyGSTIN,
                ),
              ],

              [
                labelCell(
                  "MSME",
                  "status",
                ),

                valueCell(
                  detail.MSME,
                ),

                labelCell(
                  "Financial Year",
                  "calendar",
                ),

                valueCell(
                  detail.FinancialYear,
                ),
              ],

              [
                {
                  ...labelCell(
                    "Business Address",
                    "location",
                  ),
                },

                {
                  text:
                    displayValue(
                      detail.BusinessAddress,
                    ),

                  style:
                    "fieldValue",

                  colSpan:
                    3,

                  margin: [
                    9,
                    8,
                    7,
                    7,
                  ],
                },

                {},
                {},
              ],

              [
                {
                  ...labelCell(
                    "Billing Address",
                    "location",
                  ),
                },

                {
                  text:
                    displayValue(
                      detail.BillingAddress,
                    ),

                  style:
                    "fieldValue",

                  colSpan:
                    3,

                  margin: [
                    9,
                    8,
                    7,
                    7,
                  ],
                },

                {},
                {},
              ],
            ],
          },

          layout:
            tableLayout,

          margin: [
            0,
            0,
            0,
            15,
          ],
        },

        // ========================================================
        // Authorised Person
        // ========================================================

        sectionHeading(
          "Authorised Person Details",
        ),

        {
          table: {
            widths: [
              115,
              "*",
              115,
              "*",
            ],

            body: [
              [
                labelCell(
                  "Name / Position",
                  "person",
                ),

                valueCell(
                  detail
                    .AuthorisedPersonNamePosition,
                ),

                labelCell(
                  "Mobile Number",
                  "phone",
                ),

                valueCell(
                  detail
                    .AuthorisedPersonMobileNo,
                ),
              ],

              [
                labelCell(
                  "Email",
                  "email",
                ),

                {
                  text:
                    displayValue(
                      detail
                        .AuthorisedPersonEmail,
                    ),

                  style:
                    "fieldValue",

                  colSpan:
                    3,

                  margin: [
                    9,
                    8,
                    7,
                    7,
                  ],
                },

                {},
                {},
              ],
            ],
          },

          layout:
            tableLayout,

          margin: [
            0,
            0,
            0,
            15,
          ],
        },

        // ========================================================
        // Accounts Contact
        // ========================================================

        sectionHeading(
          "Accounts Contact Details",
        ),

        {
          table: {
            widths: [
              115,
              "*",
              115,
              "*",
            ],

            body: [
              [
                labelCell(
                  "Name / Position",
                  "person",
                ),

                valueCell(
                  detail
                    .AccountsContactNamePosition,
                ),

                labelCell(
                  "Mobile Number",
                  "phone",
                ),

                valueCell(
                  detail
                    .AccountsContactMobileNo,
                ),
              ],

              [
                labelCell(
                  "Email",
                  "email",
                ),

                {
                  text:
                    displayValue(
                      detail
                        .AccountsContactEmail,
                    ),

                  style:
                    "fieldValue",

                  colSpan:
                    3,

                  margin: [
                    9,
                    8,
                    7,
                    7,
                  ],
                },

                {},
                {},
              ],
            ],
          },

          layout:
            tableLayout,

          margin: [
            0,
            0,
            0,
            15,
          ],
        },

        // ========================================================
        // Credit Details
        // ========================================================

        sectionHeading(
          "Credit Details",
        ),

        {
          table: {
            widths: [
              115,
              "*",
              115,
              "*",
            ],

            body: [
              [
                labelCell(
                  "Recommended By",
                  "person",
                ),

                valueCell(
                  detail.RecommendedBy,
                ),

                labelCell(
                  "Position",
                  "person",
                ),

                valueCell(
                  detail.Position,
                ),
              ],

              [
                labelCell(
                  "Reference Checked By",
                  "person",
                ),

                valueCell(
                  detail
                    .CreditReferenceCheckedBy,
                ),

                labelCell(
                  "Reference Date",
                  "calendar",
                ),

                valueCell(
                  detail
                    .CreditReferenceCheckedDate,
                ),
              ],

              [
                labelCell(
                  "Credit Amount",
                  "money",
                ),

                valueCell(
                  creditAmount,
                ),

                labelCell(
                  "Expected Business FY",
                  "money",
                ),

                valueCell(
                  expectedBusinessFY,
                ),
              ],

              [
                labelCell(
                  "AR ID",
                  "document",
                ),

                valueCell(
                  detail.ARID,
                ),

                labelCell(
                  "Created Date",
                  "calendar",
                ),

                valueCell(
                  detail.CreatedDate,
                ),
              ],
            ],
          },

          layout:
            tableLayout,

          margin: [
            0,
            0,
            0,
            15,
          ],
        },

        // ========================================================
        // Approval Details
        // ========================================================

        sectionHeading(
          "Approval Details",
        ),

        {
          table: {
            headerRows:
              1,

            widths: [
              90,
              90,
              "*",
            ],

            body:
              approvalBody,
          },

          layout: {
            hLineColor: () =>
              COLORS.border,

            vLineColor: () =>
              COLORS.border,

            hLineWidth: () =>
              0.7,

            vLineWidth: () =>
              0.7,

            paddingLeft: () =>
              7,

            paddingRight: () =>
              7,

            paddingTop: () =>
              6,

            paddingBottom: () =>
              6,
          },

          margin: [
            0,
            0,
            0,
            15,
          ],
        },

      ],

      // ==========================================================
      // Footer
      // ==========================================================

      footer: () => ({
        margin: [
          22,
          8,
          22,
          0,
        ],

        stack: [
          {
            canvas: [
              {
                type:
                  "line",

                x1:
                  0,

                y1:
                  0,

                x2:
                  551,

                y2:
                  0,

                lineWidth:
                  0.7,

                lineColor:
                  COLORS.navy,
              },
            ],

            margin: [
              0,
              0,
              0,
              8,
            ],
          },

          {
            columns: [
              {
                stack: [
                  {
                    text:
                      "Powered by HotelOps",

                    bold:
                      true,

                    color:
                      COLORS.navy,

                    fontSize:
                      8,
                  },
                ],
              },

              {
                width:
                  150,

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

      // ==========================================================
      // Styles
      // ==========================================================

      styles: {
        title: {
          fontSize:
            18,

          bold:
            true,

          color:
            COLORS.navy,
        },

        fieldLabel: {
          fontSize:
            8.5,

          bold:
            true,

          color:
            COLORS.label,
        },

        fieldValue: {
          fontSize:
            9,

          color:
            COLORS.text,
        },

        tableHeader: {
          fontSize:
            8.5,

          bold:
            true,

          color:
            COLORS.navy,

          fillColor:
            COLORS.labelBackground,
        },

        tableValue: {
          fontSize:
            8.5,

          color:
            COLORS.text,
        },
      },
    };

    // ============================================================
    // Generate PDF
    // Direct PdfPrinter
    // Same AMC Pattern
    // ============================================================

    const pdfBuffer =
      await new Promise(
        (
          resolve,
          reject,
        ) => {
          try {
            const pdfDocument =
              new PdfPrinter(
                EQUIPMENT_DETAIL_PDF_FONTS,
              )
                .createPdfKitDocument(
                  documentDefinition,
                );

            const chunks = [];

            pdfDocument.on(
              "data",
              (chunk) =>
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

    // ============================================================
    // Response
    // ============================================================

    const fileName =
      `Credit-Application-Detail-${CreditApplicationID}.pdf`;

    return {
      success:
        true,

      message:
        "Credit Application detail PDF generated successfully.",

      data:
        pdfBuffer,

      fileName,

      contentType:
        "application/pdf",
    };

  } catch (error) {
    console.error(
      "Generate Credit Application detail PDF error:",
      error,
    );

    return databaseFailure(
      error,
      "Generate Credit Application detail PDF",
    );
  }
};
// ============================================================
// Exports
// ============================================================
module.exports = {
  createCreditApplication,
  getCreditApplicationList,
  getCreditApplicationById,
  updateCreditApplication,
  deleteCreditApplication,
  processCreditApplicationApproval,
  updateCreditApplicationARID,
  createCreditApplicationApprovalConfig,
  getCreditApplicationApprovalConfigList,
  deleteCreditApplicationApprovalConfig,
  getCompanyWiseReport,
  getOrganizationWiseReport,
  generateCreditApplicationListPdf,
  generateCompanyWiseReportPdf,
  generateOrganizationWiseReportPdf,
  generateCreditApplicationDetailPdf
};
