//==================================================RabbitMq
const producer = require("../producer/producer");
const QUEUE = require("../config/queue");
//==================================================Azur
const uploadToAzure = require("../AzurConfigration/OrganizationMaster/AzureUpload");
//==================================================Error Handling
const STATUS_CODES = require("../utils/statusCodes");
const AppError = require("../utils/AppError");
const handleError = require("../utils/errorHandler");
//==================================================Get Funcation from Serive

// ===================================================Create Organization
exports.createOrganization = async (req, res) => {
  try {
    console.log("Enter Organization Controller");
    const {
      OrganizationName,
      OrganizationCode,
      ShortName,
      Country,
      State,
      City,
      Address,
      Currency,
      TimeZone,
      Email,
      AlternativeEmail,
      Phone,
      AlternativePhone,
      Website,
      TaxNumber,
      PolicyDetails,
      ActivationStatus,
      FinancialYearStart,
      FinanceModule,
      PostalCode,
      PMS,
      PMSIDCode,
      LegalName,
      ReviewSoftware,
      FinanceModuleCode,
      PosModule,
      BrandID,
      CreatedBy,
    } = req.body;

    if (!OrganizationName) {
      throw new AppError(
        "Organization Name is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!OrganizationCode) {
      throw new AppError(
        "Organization Code is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

     if (!ShortName) {
      throw new AppError(
        "Organization Code is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }
    if (!BrandID) {
      throw new AppError("Brand is required", STATUS_CODES.BAD_REQUEST);
    }
// console.log("LogoType:", req.body.LogoType);
// console.log("Files:", req.files.length);
// console.log("Files:", req.files.map(f => f.originalname));
    const logoTypes = Array.isArray(req.body.LogoType)
      ? req.body.LogoType
      : [req.body.LogoType];

    let logos = [];

    for (let i = 0; i < req.files.length; i++) {
      const blobName = await uploadToAzure(req.files[i]);

      logos.push({
        LogoType: logoTypes[i],
        LogoName: blobName,
      });
    }
// console.log(logos);
    const response = await producer.sendMessage(
      QUEUE.ORGANIZATION.REQUEST,
      QUEUE.ORGANIZATION.RESPONSE,

      {
        action: "CREATE_ORGANIZATION",

        data: {

          OrganizationName,
          OrganizationCode,
          ShortName,

          Country,
          State,
          City,
          Address,

          Currency,
          TimeZone,

          Email,
          AlternativeEmail,

          Phone,
          AlternativePhone,

          Website,
          TaxNumber,

          PolicyDetails,

          ActivationStatus: true,
          IsActive: true,
          IsDeleted: false,

          FinancialYearStart,

          FinanceModule,

          PostalCode,

          PMS,
          PMSIDCode,

          LegalName,

          ReviewSoftware,

          FinanceModuleCode,

          PosModule,

          BrandID,

          CreatedBy,

          Logos: logos,
        },
      },
    );

    if (!response.success) {
      throw new AppError(
        response.message,

        STATUS_CODES.BAD_REQUEST,
      );
    }

    return res.status(STATUS_CODES.CREATED).json(response);
  } catch (error) {
    handleError(error, res);
  }
};
