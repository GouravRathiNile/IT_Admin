const { pool } = require("../db");

// =========================================Create Organization
const createOrganization = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
// Last OrganizationID fetch
const lastIdResult = await client.query(`
    SELECT COALESCE(MAX(OrganizationID), 0) AS LastID
    FROM Organization_Master
`);

const OrganizationID =
    Number(lastIdResult.rows[0].lastid) + 10;
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
      IsActive,
      IsDeleted,

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

      Logos,
    } = data;

    //================ Organization Insert =================

    const organizationQuery = `

            INSERT INTO Organization_Master
            (

                OrganizationID,
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
                IsActive,
IsDeleted,
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

                CreatedBy

            )

            VALUES
            (

                $1,$2,$3,$4,
                $5,$6,$7,$8,
                $9,$10,
                $11,$12,
                $13,$14,
                $15,$16,
                $17,
                $18,$19,
                $20,
                $21,
                $22,
                $23,$24,
                $25,
                $26,
                $27,
                $28,
                $29,
                $30,
                $31

            )

            RETURNING *;

        `;

    const organizationValues = [
      OrganizationID,
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
      IsActive,
      IsDeleted,
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
    ];

    const organizationResult = await client.query(
      organizationQuery,
      organizationValues,
    );

    //================ Logo Insert =================

    if (Logos && Logos.length > 0) {
      for (const logo of Logos) {
        await client.query(
          `
            INSERT INTO Organization_Master_Logo
            (
                OrganizationID,
                LogoType,
                LogoName,
                CreatedBy,
                IsDeleted
            )
            VALUES ($1,$2,$3,$4,$5)
            `,
          [OrganizationID, logo.LogoType, logo.LogoName, CreatedBy,false],
        );
      }
    }
    await client.query("COMMIT");

    return {
      success: true,
      message: "Organization Created Successfully",
      // data: organizationResult.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.log(error);

    return {
      success: false,
      message: error.message,
    };
  } finally {
    client.release();
  }
};

module.exports = {
  createOrganization,
};
