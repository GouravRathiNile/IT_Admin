//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Azur
const uploadToAzure = require("../../AzurConfigration/CreditApplication/AzureUpload");
// =========================================================Get Data From service
const CreditApplicationService = require("../../services/CreditApplicationService/CreditApplicationService");

// ============================ Queue Helper
const sendQueueResponse = async (
  req,
  res,
  action,
  data,
  successCode = STATUS_CODES.SUCCESS,
) => {
  try {
    const response = await producer.sendMessage(
      QUEUE.CREDIT_APPLICATION.REQUEST,
      QUEUE.CREDIT_APPLICATION.RESPONSE,
      {
        action,

        data: {
          ...data,

          // =====================================================
          // Trusted JWT Fields
          // Frontend se trust nahi karne hain
          // =====================================================
          UserID: req.user.UserID,
          UserType: req.user.UserType,
          DepartmentName: req.user.DepartmentName,
          LoginType: req.user.LoginType,
          AllOrganizationAccess: req.user.AllOrganizationAccess,
        },
      },
    );

    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to process Credit Application request.",
        response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }

    return res
      .status(response.queued ? 202 : successCode)
      .json(response);
  } catch (error) {
    if (
      [
        "Response Timeout",
        "RabbitMQ Channel Not Initialized",
      ].includes(error.message)
    ) {
      return handleError(
        new AppError(
          "Credit Application service is temporarily unavailable.",
          STATUS_CODES.SERVICE_UNAVAILABLE,
        ),
        res,
      );
    }

    return handleError(error, res);
  }
};
// ============================ Date Validation Helper
const validateDateFormat = (value, fieldName) => {
  if (!value) return;

  const dateFormat = /^\d{4}-\d{2}-\d{2}$/;

  if (!dateFormat.test(value)) {
    throw new AppError(
      `${fieldName} must be in YYYY-MM-DD format`,
      STATUS_CODES.BAD_REQUEST,
    );
  }
};

// ============================================================CREATE CREDIT APPLICATION
exports.createCreditApplication = async (req, res) => {
  try {
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

      DocumentTypes,
    } = req.body || {};

    // ============================================================
    // CREATE PERMISSION
    //
    // Credit Application sirf:
    // Sales
    // Sales & Marketing
    //
    // DepartmentName JWT se hi lena hai.
    // ============================================================

    const departmentName = String(
      req.user?.DepartmentName || "",
    )
      .trim()
      .toUpperCase();

    if (
      ![
        "SALES",
        "SALES & MARKETING",
      ].includes(departmentName)
    ) {
      throw new AppError(
        "Only Sales or Sales & Marketing department can create a Credit Application.",
        STATUS_CODES.FORBIDDEN,
      );
    }

    // ============================================================
    // Organization Validation
    // ============================================================

    if (!OrganizationID) {
      throw new AppError(
        "Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

   

    // ============================================================
    // Required Fields
    // ============================================================

    if (!ApplicationDate) {
      throw new AppError(
        "Application Date is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!CompanyName || !String(CompanyName).trim()) {
      throw new AppError(
        "Company Name is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

   

    // ============================================================
    // Authorised Person
    // ============================================================

    if (
      !AuthorisedPersonNamePosition ||
      !String(AuthorisedPersonNamePosition).trim()
    ) {
      throw new AppError(
        "Authorised Person Name & Position is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !AuthorisedPersonMobileNo ||
      !String(AuthorisedPersonMobileNo).trim()
    ) {
      throw new AppError(
        "Authorised Person Mobile No is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !AuthorisedPersonEmail ||
      !String(AuthorisedPersonEmail).trim()
    ) {
      throw new AppError(
        "Authorised Person Email is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Accounts Contact
    // ============================================================

    if (
      !AccountsContactNamePosition ||
      !String(AccountsContactNamePosition).trim()
    ) {
      throw new AppError(
        "Accounts Contact Name & Position is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !AccountsContactMobileNo ||
      !String(AccountsContactMobileNo).trim()
    ) {
      throw new AppError(
        "Accounts Contact Mobile No is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !AccountsContactEmail ||
      !String(AccountsContactEmail).trim()
    ) {
      throw new AppError(
        "Accounts Contact Email is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Recommendation / Reference
    // ============================================================

    if (
      !RecommendedBy ||
      !String(RecommendedBy).trim()
    ) {
      throw new AppError(
        "Recommended By is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!Position || !String(Position).trim()) {
      throw new AppError(
        "Position is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !CreditReferenceCheckedBy ||
      !String(CreditReferenceCheckedBy).trim()
    ) {
      throw new AppError(
        "Credit Reference Checked By is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!CreditReferenceCheckedDate) {
      throw new AppError(
        "Credit Reference Checked Date is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Credit Details
    // ============================================================

    if (
      CreditAmountAllowed === undefined ||
      CreditAmountAllowed === null ||
      String(CreditAmountAllowed).trim() === ""
    ) {
      throw new AppError(
        "Credit Amount Allowed is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !Number.isFinite(Number(CreditAmountAllowed)) ||
      Number(CreditAmountAllowed) <= 0
    ) {
      throw new AppError(
        "Credit Amount Allowed must be greater than zero",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      ExpectedBusinessFY === undefined ||
      ExpectedBusinessFY === null ||
      String(ExpectedBusinessFY).trim() === ""
    ) {
      throw new AppError(
        "Expected Business FY is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !Number.isFinite(Number(ExpectedBusinessFY)) ||
      Number(ExpectedBusinessFY) <= 0
    ) {
      throw new AppError(
        "Expected Business FY must be greater than zero",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !FinancialYear ||
      !String(FinancialYear).trim()
    ) {
      throw new AppError(
        "Financial Year is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Date Validation
    // ============================================================

    validateDateFormat(
      ApplicationDate,
      "Application Date",
    );

    validateDateFormat(
      CreditReferenceCheckedDate,
      "Credit Reference Checked Date",
    );

    // ============================================================
    // Document Types
    //
    // Multipart FormData:
    //
    // DocumentTypes:
    // ["GST","Cancel Cheque","Company Documents"]
    //
    // Documents:
    // file1
    // file2
    // file3
    // ============================================================

    let documentTypes = [];

    if (DocumentTypes) {
      try {
        documentTypes =
          typeof DocumentTypes === "string"
            ? JSON.parse(DocumentTypes)
            : DocumentTypes;
      } catch (_error) {
        throw new AppError(
          "DocumentTypes must be a valid JSON array",
          STATUS_CODES.BAD_REQUEST,
        );
      }

      if (!Array.isArray(documentTypes)) {
        throw new AppError(
          "DocumentTypes must be an array",
          STATUS_CODES.BAD_REQUEST,
        );
      }

      documentTypes = documentTypes.map((item) =>
        String(item || "").trim(),
      );
    }

    const files = req.files || [];

    // Sirf uploaded files save hongi. DocumentTypes mein kisi aise
    // document ka type aaya hai jiski file upload nahi hui, to uske
    // liye koi document row create nahi hogi.

    // ============================================================
    // Upload Documents To Azure
    // ============================================================

    const Documents = [];

    for (
      let index = 0;
      index < files.length;
      index += 1
    ) {
      const file = files[index];

      const filePath = await uploadToAzure(file);

      Documents.push({
        DocumentType:
          documentTypes[index] || "OTHER",

        FileName:
          file.originalname,

        FilePath:
          filePath,

        FileType:
          file.mimetype,

        FileSize:
          file.size,
      });
    }

    // ============================================================
    // Final Data
    //
    // IMPORTANT:
    // UserID/UserType/DepartmentName/LoginType frontend se nahi.
    // sendQueueResponse JWT se automatically add karega.
    //
    // ARID create ke time nahi bhejni.
    // ARID later FC update karega after FC + GM approval.
    // ============================================================

    const data = {
      OrganizationID: Number(OrganizationID),

      ApplicationDate,

      CompanyName:
        String(CompanyName).trim(),

      CompanyGSTIN:
        String(CompanyGSTIN).trim(),

      MSME:
        String(MSME).trim(),

      BusinessAddress:
        String(BusinessAddress).trim(),

      BillingAddress:
        String(BillingAddress).trim(),

      AuthorisedPersonNamePosition:
        String(
          AuthorisedPersonNamePosition,
        ).trim(),

      AuthorisedPersonMobileNo:
        String(
          AuthorisedPersonMobileNo,
        ).trim(),

      AuthorisedPersonEmail:
        String(
          AuthorisedPersonEmail,
        ).trim(),

      AccountsContactNamePosition:
        String(
          AccountsContactNamePosition,
        ).trim(),

      AccountsContactMobileNo:
        String(
          AccountsContactMobileNo,
        ).trim(),

      AccountsContactEmail:
        String(
          AccountsContactEmail,
        ).trim(),

      RecommendedBy:
        String(RecommendedBy).trim(),

      Position:
        String(Position).trim(),

      CreditReferenceCheckedBy:
        String(
          CreditReferenceCheckedBy,
        ).trim(),

      CreditReferenceCheckedDate,

      CreditAmountAllowed:
        Number(CreditAmountAllowed),

      ExpectedBusinessFY:
        Number(ExpectedBusinessFY),

      FinancialYear:
        String(FinancialYear).trim(),

      Documents,
    };

    // ============================================================
    // RabbitMQ
    // ============================================================

    return sendQueueResponse(
      req,
      res,
      "CREATE_CREDIT_APPLICATION",
      data,
      STATUS_CODES.CREATED,
    );

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================ Credit Application List
exports.getCreditApplicationList = async (req, res) => {
  try {
    const {
      OrganizationID,
      CompanyName,
      Status,
      FromDate,
      ToDate,
      page = 1,
      PageSize = 10,
    } = req.query;

    if (!OrganizationID) {
      throw new AppError(
        "Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !Number.isInteger(Number(OrganizationID)) ||
      Number(OrganizationID) <= 0
    ) {
      throw new AppError(
        "Organization ID must be a valid positive integer",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    validateDateFormat(FromDate, "From Date");
    validateDateFormat(ToDate, "To Date");

    if (FromDate && ToDate && FromDate > ToDate) {
      throw new AppError(
        "From Date cannot be greater than To Date",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    const response =
      await CreditApplicationService.getCreditApplicationList({
        OrganizationID: Number(OrganizationID),

        CompanyName:
          CompanyName?.trim() || null,

        Status:
          Status?.trim() || null,

        FromDate:
          FromDate?.trim() || null,

        ToDate:
          ToDate?.trim() || null,

        page: Number(page) || 1,
        PageSize: Number(PageSize) || 10,

        // Trusted JWT Fields
        UserID: req.user.UserID,
        UserType: req.user.UserType,
        DepartmentName: req.user.DepartmentName,
        LoginType: req.user.LoginType,
        AllOrganizationAccess:
          req.user.AllOrganizationAccess,
      });

    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to fetch Credit Applications",
        response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================ Get Credit Application By ID
exports.getCreditApplicationById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new AppError(
        "Credit Application ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !Number.isInteger(Number(id)) ||
      Number(id) <= 0
    ) {
      throw new AppError(
        "Credit Application ID must be a valid positive integer",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    const response =
      await CreditApplicationService.getCreditApplicationById({
        CreditApplicationID: Number(id),

        // Trusted JWT Fields
        UserID: req.user.UserID,
        UserType: req.user.UserType,
        DepartmentName: req.user.DepartmentName,
        LoginType: req.user.LoginType,
      });

    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to fetch Credit Application",
        response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================GET COMPANY NAMES
exports.getCompanyNames = async (
  req,
  res,
) => {
  try {
    const result =
      await CreditApplicationService
        .getCompanyNames({
          OrganizationID:
            req.query.OrganizationID,
        });

    return res
      .status(
        result.statusCode ||
          (result.success
            ? 200
            : 400),
      )
      .json(result);

  } catch (error) {
    return handleControllerError(
      error,
      res,
    );
  }
};
// ============================================================UPDATE CREDIT APPLICATION
exports.updateCreditApplication = async (req, res) => {
  try {
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

      DocumentTypes,
      DeleteDocumentIDs,
    } = req.body || {};

    // ============================================================
    // Permission
    // ============================================================

    const departmentName = String(
      req.user?.DepartmentName || "",
    )
      .trim()
      .toUpperCase();

    if (
      ![
        "SALES",
        "SALES & MARKETING",
      ].includes(departmentName)
    ) {
      throw new AppError(
        "Only Sales or Sales & Marketing department can update a Credit Application.",
        STATUS_CODES.FORBIDDEN,
      );
    }

    // ============================================================
    // IDs
    // ============================================================

    if (
      !CreditApplicationID ||
      !Number.isInteger(Number(CreditApplicationID)) ||
      Number(CreditApplicationID) <= 0
    ) {
      throw new AppError(
        "Credit Application ID must be a valid positive integer",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !OrganizationID ||
      !Number.isInteger(Number(OrganizationID)) ||
      Number(OrganizationID) <= 0
    ) {
      throw new AppError(
        "Organization ID must be a valid positive integer",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Required Fields
    // ============================================================

    if (!ApplicationDate) {
      throw new AppError(
        "Application Date is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!CompanyName || !String(CompanyName).trim()) {
      throw new AppError(
        "Company Name is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!CompanyGSTIN || !String(CompanyGSTIN).trim()) {
      throw new AppError(
        "Company GSTIN is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!MSME || !String(MSME).trim()) {
      throw new AppError(
        "MSME is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!BusinessAddress || !String(BusinessAddress).trim()) {
      throw new AppError(
        "Business Address is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!BillingAddress || !String(BillingAddress).trim()) {
      throw new AppError(
        "Billing Address is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !AuthorisedPersonNamePosition ||
      !String(AuthorisedPersonNamePosition).trim()
    ) {
      throw new AppError(
        "Authorised Person Name & Position is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!AuthorisedPersonMobileNo) {
      throw new AppError(
        "Authorised Person Mobile No is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!AuthorisedPersonEmail) {
      throw new AppError(
        "Authorised Person Email is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!AccountsContactNamePosition) {
      throw new AppError(
        "Accounts Contact Name & Position is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!AccountsContactMobileNo) {
      throw new AppError(
        "Accounts Contact Mobile No is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!AccountsContactEmail) {
      throw new AppError(
        "Accounts Contact Email is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!RecommendedBy) {
      throw new AppError(
        "Recommended By is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!Position) {
      throw new AppError(
        "Position is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!CreditReferenceCheckedBy) {
      throw new AppError(
        "Credit Reference Checked By is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!CreditReferenceCheckedDate) {
      throw new AppError(
        "Credit Reference Checked Date is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      CreditAmountAllowed === undefined ||
      CreditAmountAllowed === null ||
      String(CreditAmountAllowed).trim() === ""
    ) {
      throw new AppError(
        "Credit Amount Allowed is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      ExpectedBusinessFY === undefined ||
      ExpectedBusinessFY === null ||
      String(ExpectedBusinessFY).trim() === ""
    ) {
      throw new AppError(
        "Expected Business FY is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!FinancialYear) {
      throw new AppError(
        "Financial Year is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Date Validation
    // ============================================================

    validateDateFormat(
      ApplicationDate,
      "Application Date",
    );

    validateDateFormat(
      CreditReferenceCheckedDate,
      "Credit Reference Checked Date",
    );

    // ============================================================
    // Amount Validation
    // ============================================================

    if (
      !Number.isFinite(Number(CreditAmountAllowed)) ||
      Number(CreditAmountAllowed) <= 0
    ) {
      throw new AppError(
        "Credit Amount Allowed must be greater than zero",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      !Number.isFinite(Number(ExpectedBusinessFY)) ||
      Number(ExpectedBusinessFY) <= 0
    ) {
      throw new AppError(
        "Expected Business FY must be greater than zero",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Delete Document IDs
    // ============================================================

    let deleteDocumentIDs = [];

    if (DeleteDocumentIDs) {
      try {
        deleteDocumentIDs =
          typeof DeleteDocumentIDs === "string"
            ? JSON.parse(DeleteDocumentIDs)
            : DeleteDocumentIDs;
      } catch (_error) {
        throw new AppError(
          "DeleteDocumentIDs must be a valid JSON array",
          STATUS_CODES.BAD_REQUEST,
        );
      }

      if (!Array.isArray(deleteDocumentIDs)) {
        throw new AppError(
          "DeleteDocumentIDs must be an array",
          STATUS_CODES.BAD_REQUEST,
        );
      }

      deleteDocumentIDs =
        deleteDocumentIDs.map(Number);
    }

    // ============================================================
    // New Document Types
    // ============================================================

    let documentTypes = [];

    if (DocumentTypes) {
      try {
        documentTypes =
          typeof DocumentTypes === "string"
            ? JSON.parse(DocumentTypes)
            : DocumentTypes;
      } catch (_error) {
        throw new AppError(
          "DocumentTypes must be a valid JSON array",
          STATUS_CODES.BAD_REQUEST,
        );
      }

      if (!Array.isArray(documentTypes)) {
        throw new AppError(
          "DocumentTypes must be an array",
          STATUS_CODES.BAD_REQUEST,
        );
      }

      documentTypes = documentTypes.map((item) =>
        String(item || "").trim(),
      );
    }

    const files = req.files || [];

    // Sirf uploaded files save hongi. Extra DocumentTypes ke liye
    // koi document row create nahi hogi; missing type "OTHER" hoga.

    // ============================================================
    // Upload New Documents
    // ============================================================

    const Documents = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];

      const filePath =
        await uploadToAzure(file);

      Documents.push({
        DocumentType:
          documentTypes[index] || "OTHER",

        FileName:
          file.originalname,

        FilePath:
          filePath,

        FileType:
          file.mimetype,

        FileSize:
          file.size,
      });
    }

    // ============================================================
    // Data
    // ============================================================

    const data = {
      CreditApplicationID:
        Number(CreditApplicationID),

      OrganizationID:
        Number(OrganizationID),

      ApplicationDate,

      CompanyName:
        String(CompanyName).trim(),

      CompanyGSTIN:
        String(CompanyGSTIN).trim(),

      MSME:
        String(MSME).trim(),

      BusinessAddress:
        String(BusinessAddress).trim(),

      BillingAddress:
        String(BillingAddress).trim(),

      AuthorisedPersonNamePosition:
        String(AuthorisedPersonNamePosition).trim(),

      AuthorisedPersonMobileNo:
        String(AuthorisedPersonMobileNo).trim(),

      AuthorisedPersonEmail:
        String(AuthorisedPersonEmail).trim(),

      AccountsContactNamePosition:
        String(AccountsContactNamePosition).trim(),

      AccountsContactMobileNo:
        String(AccountsContactMobileNo).trim(),

      AccountsContactEmail:
        String(AccountsContactEmail).trim(),

      RecommendedBy:
        String(RecommendedBy).trim(),

      Position:
        String(Position).trim(),

      CreditReferenceCheckedBy:
        String(CreditReferenceCheckedBy).trim(),

      CreditReferenceCheckedDate,

      CreditAmountAllowed:
        Number(CreditAmountAllowed),

      ExpectedBusinessFY:
        Number(ExpectedBusinessFY),

      FinancialYear:
        String(FinancialYear).trim(),

      Documents,

      DeleteDocumentIDs:
        deleteDocumentIDs,
    };

    return sendQueueResponse(
      req,
      res,
      "UPDATE_CREDIT_APPLICATION",
      data,
    );

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================DELETE CREDIT APPLICATION
exports.deleteCreditApplication = async (req, res) => {
  try {
    const {
      CreditApplicationID,
    } = req.body || {};

    const departmentName = String(
      req.user?.DepartmentName || "",
    )
      .trim()
      .toUpperCase();

    if (
      ![
        "SALES",
        "SALES & MARKETING",
      ].includes(departmentName)
    ) {
      throw new AppError(
        "Only Sales or Sales & Marketing department can delete a Credit Application.",
        STATUS_CODES.FORBIDDEN,
      );
    }

    if (
      !CreditApplicationID ||
      !Number.isInteger(Number(CreditApplicationID)) ||
      Number(CreditApplicationID) <= 0
    ) {
      throw new AppError(
        "Credit Application ID must be a valid positive integer",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    return sendQueueResponse(
      req,
      res,
      "DELETE_CREDIT_APPLICATION",
      {
        CreditApplicationID:
          Number(CreditApplicationID),
      },
    );

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================CREDIT APPLICATION APPROVAL
exports.processCreditApplicationApproval = async (req, res) => {
  try {
    const {
      CreditApplicationID,
      Action,
      Remarks,
    } = req.body || {};

    // ============================================================
    // Credit Application ID
    // ============================================================

    if (
      !CreditApplicationID ||
      !Number.isInteger(Number(CreditApplicationID)) ||
      Number(CreditApplicationID) <= 0
    ) {
      throw new AppError(
        "Credit Application ID must be a valid positive integer",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Action
    // ============================================================

    const action = String(
      Action || "",
    )
      .trim()
      .toUpperCase();

    if (
      ![
        "APPROVE",
        "REJECT",
        "RETURN",
      ].includes(action)
    ) {
      throw new AppError(
        "Action must be APPROVE, REJECT, or RETURN",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Remarks
    // ============================================================

    if (
      ["REJECT", "RETURN"].includes(action) &&
      !String(Remarks || "").trim()
    ) {
      throw new AppError(
        "Remarks are required for REJECT or RETURN",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Queue
    // ============================================================

    return sendQueueResponse(
      req,
      res,
      "PROCESS_CREDIT_APPLICATION_APPROVAL",
      {
        CreditApplicationID:
          Number(CreditApplicationID),

        Action:
          action,

        Remarks:
          String(Remarks || "").trim() || null,
      },
    );

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================ UPDATE AR ID
exports.updateCreditApplicationARID = async (req, res) => {
  try {
    const {
      CreditApplicationID,
      ARID,
    } = req.body || {};

    // ============================================================
    // FC Permission
    // ============================================================

    const userType = String(
      req.user?.UserType || "",
    )
      .trim()
      .toUpperCase();

    const departmentName = String(
      req.user?.DepartmentName || "",
    )
      .trim()
      .toUpperCase();

    if (
      userType !== "HOD" ||
      !["FC", "FINANCE"].includes(departmentName)
    ) {
      throw new AppError(
        "Only FC can update AR ID.",
        STATUS_CODES.FORBIDDEN,
      );
    }

    // ============================================================
    // Credit Application ID
    // ============================================================

    if (
      !CreditApplicationID ||
      !Number.isInteger(Number(CreditApplicationID)) ||
      Number(CreditApplicationID) <= 0
    ) {
      throw new AppError(
        "Credit Application ID must be a valid positive integer",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // AR ID
    // ============================================================

    if (
      !ARID ||
      !String(ARID).trim()
    ) {
      throw new AppError(
        "AR ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Queue
    // ============================================================

    return sendQueueResponse(
      req,
      res,
      "UPDATE_CREDIT_APPLICATION_ARID",
      {
        CreditApplicationID:
          Number(CreditApplicationID),

        ARID:
          String(ARID).trim(),
      },
    );

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Create Approval Config
exports.createCreditApplicationApprovalConfig = async (
  req,
  res,
) => {
  try {
    return sendQueueResponse(
      req,
      res,
      "CREATE_CREDIT_APPLICATION_APPROVAL_CONFIG",
      {
        OrganizationID:
          req.body.OrganizationID,

        Approvals:
          req.body.Approvals,
      },
    );
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ Approval Config List
exports.getCreditApplicationApprovalConfigList = async (
  req,
  res,
) => {
  try {
    const result =
      await CreditApplicationService
        .getCreditApplicationApprovalConfigList(
          {
            OrganizationID:
              req.query.OrganizationID,
          },
        );

    return res
      .status(
        result.statusCode || 200,
      )
      .json(result);

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Delete Approval Config 
exports.deleteCreditApplicationApprovalConfig = async (
  req,
  res,
) => {
  try {
    return sendQueueResponse(
      req,
      res,
      "DELETE_CREDIT_APPLICATION_APPROVAL_CONFIG",
      {
        CreditApplicationApprovalConfigID:
          req.body
            .CreditApplicationApprovalConfigID,
      },
    );

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ========================================================================Reports
// ============================================================COMPANY WISE REPORT
exports.getCompanyWiseReport = async (
  req,
  res,
) => {
  try {
    const result =
      await CreditApplicationService
        .getCompanyWiseReport({
          OrganizationID:
            req.query.OrganizationID,

          CompanyName:
            req.query.CompanyName,

          FromDate:
            req.query.FromDate,

          ToDate:
            req.query.ToDate,

          page:
            req.query.page,

          PageSize:
            req.query.PageSize,
        });

    return res
      .status(
        result.statusCode || 200,
      )
      .json(result);

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ORGANIZATION WISE REPORT
exports.getOrganizationWiseReport = async (
  req,
  res,
) => {
  try {
    const result =
      await CreditApplicationService
        .getOrganizationWiseReport({
          OrganizationID:
            req.query.OrganizationID,

          FromDate:
            req.query.FromDate,

          ToDate:
            req.query.ToDate,

          page:
            req.query.page,

          PageSize:
            req.query.PageSize,
        });

    return res
      .status(
        result.statusCode || 200,
      )
      .json(result);

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ========================================================================Reports
// ============================================================CREDIT APPLICATION LIST PDF
exports.generateCreditApplicationListPdf = async (
  req,
  res,
) => {
  try {
    const result =
      await CreditApplicationService
        .generateCreditApplicationListPdf({
          // ======================================================
          // Same Filters As List GET
          // ======================================================

          OrganizationID:
            req.query.OrganizationID,

          CompanyName:
            req.query.CompanyName,

          Status:
            req.query.Status,

          FromDate:
            req.query.FromDate,

          ToDate:
            req.query.ToDate,

          // ======================================================
          // Same Logged-In User Context As GET
          // ======================================================

          UserID:
            req.user.UserID,

          UserType:
            req.user.UserType,

          DepartmentName:
            req.user.DepartmentName,

          LoginType:
            req.user.LoginType,

          AllOrganizationAccess:
            req.user.AllOrganizationAccess,
        });

    // ============================================================
    // Error
    // ============================================================

    if (
      !result.success
    ) {
      return res
        .status(
          result.statusCode ||
            400,
        )
        .json(result);
    }

    // ============================================================
    // PDF Headers
    // ============================================================

    res.setHeader(
      "Content-Type",
      result.contentType ||
        "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${result.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      result.data.length,
    );

    // ============================================================
    // Send PDF Buffer
    // ============================================================

    return res.send(
      result.data,
    );

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================COMPANY WISE REPORT PDf
exports.generateCompanyWiseReportPdf = async (
  req,
  res,
) => {
  try {
    const result =
      await CreditApplicationService
        .generateCompanyWiseReportPdf({
          OrganizationID:
            req.query.OrganizationID,

          CompanyName:
            req.query.CompanyName,

          FromDate:
            req.query.FromDate,

          ToDate:
            req.query.ToDate,
        });

    // ============================================================
    // ERROR
    // ============================================================

    if (
      !result.success
    ) {
      return res
        .status(
          result.statusCode ||
            400,
        )
        .json(result);
    }

    // ============================================================
    // PDF HEADERS
    // ============================================================

    res.setHeader(
      "Content-Type",
      result.contentType ||
        "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${result.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      result.data.length,
    );

    return res.send(
      result.data,
    );

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ORGANIZATION WISE REPORT PDF
exports.generateOrganizationWiseReportPdf = async (
  req,
  res,
) => {
  try {
    const result =
      await CreditApplicationService
        .generateOrganizationWiseReportPdf({
          // Same filters as GET report
          OrganizationID:
            req.query.OrganizationID,

          FromDate:
            req.query.FromDate,

          ToDate:
            req.query.ToDate,
        });

    // ============================================================
    // ERROR
    // ============================================================

    if (!result.success) {
      return res
        .status(
          result.statusCode || 400,
        )
        .json(result);
    }

    // ============================================================
    // PDF RESPONSE
    // ============================================================

    res.setHeader(
      "Content-Type",
      result.contentType ||
        "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${result.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      result.data.length,
    );

    return res.send(
      result.data,
    );

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================CREDIT APPLICATION Details  PDF
exports.generateCreditApplicationDetailPdf = async (
  req,
  res,
) => {
  try {
    const result =
      await CreditApplicationService
        .generateCreditApplicationDetailPdf({
          CreditApplicationID:
            req.params.id,

          // ======================================================
          // Same JWT context as Get By ID
          // ======================================================

          UserID:
            req.user.UserID,

          UserType:
            req.user.UserType,

          DepartmentName:
            req.user.DepartmentName,

          LoginType:
            req.user.LoginType,

          AllOrganizationAccess:
            req.user.AllOrganizationAccess,
        });

    // ============================================================
    // Error
    // ============================================================

    if (!result.success) {
      return res
        .status(
          result.statusCode ||
            400,
        )
        .json(result);
    }

    // ============================================================
    // PDF Response
    // ============================================================

    res.setHeader(
      "Content-Type",
      result.contentType ||
        "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${result.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      result.data.length,
    );

    return res.send(
      result.data,
    );

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};