const { pool } = require("../db");
const generateUrl = require("../AzurConfigration/OrganizationMaster/AzureGetData");
const moment = require("moment");
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

    const OrganizationID = Number(lastIdResult.rows[0].lastid) + 10;
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
          [OrganizationID, logo.LogoType, logo.LogoName, CreatedBy, false],
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
// ========================================== Get All Organizations
const getAllOrganizations = async () => {
  try {
    const query = `
      SELECT
        om.OrganizationID,
        om.OrganizationName,
        om.OrganizationCode,
        om.ShortName,
        om.Country,
        om.State,
        om.City,
        om.Address,
        om.Currency,
        om.TimeZone,
        om.Email,
        om.AlternativeEmail,
        om.Phone,
        om.AlternativePhone,
        om.Website,
        om.TaxNumber,
        om.PolicyDetails,
        om.ActivationStatus,
        om.IsActive,
        om.FinancialYearStart,
        om.FinanceModule,
        om.PostalCode,
        om.PMS,
        om.PMSIDCode,
        om.LegalName,
        om.ReviewSoftware,
        om.FinanceModuleCode,
        om.PosModule,
        om.BrandID,
        om.CreatedBy,
        om.CreatedDateTime,
        om.ModifiedBy,
        om.ModifiedDateTime,
        om.DeletedBy,
        om.DeletedDateTime,

        ol.LogoID,
        ol.LogoType,
        ol.LogoName

      FROM Organization_Master om

      LEFT JOIN Organization_Master_Logo ol
      ON om.OrganizationID = ol.OrganizationID
      AND ol.IsDeleted = FALSE

      WHERE om.IsDeleted = FALSE
      AND om.IsActive = TRUE

      ORDER BY om.OrganizationName ASC;
    `;

    const result = await pool.query(query);

    const organizations = {};

    result.rows.forEach((row) => {
      if (!organizations[row.organizationid]) {
        organizations[row.organizationid] = {
          OrganizationID: row.organizationid,
          OrganizationName: row.organizationname,
          OrganizationCode: row.organizationcode,
          ShortName: row.shortname,

          Country: row.country,
          State: row.state,
          City: row.city,
          Address: row.address,

          Currency: row.currency,
          TimeZone: row.timezone,

          Email: row.email,
          AlternativeEmail: row.alternativeemail,

          Phone: row.phone,
          AlternativePhone: row.alternativephone,

          Website: row.website,
          TaxNumber: row.taxnumber,

          PolicyDetails: row.policydetails,

          ActivationStatus: row.activationstatus,
          IsActive: row.isactive,

          FinancialYearStart: row.financialyearstart
            ? moment()
                .month(row.financialyearstart - 1)
                .format("MMM")
            : null,

          FinanceModule: row.financemodule,
          PostalCode: row.postalcode,

          PMS: row.pms,
          PMSIDCode: row.pmsidcode,

          LegalName: row.legalname,

          ReviewSoftware: row.reviewsoftware,
          FinanceModuleCode: row.financemodulecode,
          PosModule: row.posmodule,

          BrandID: row.brandid,

          CreatedBy: row.createdby,
          CreatedDateTime: row.createddatetime
            ? moment(row.createddatetime).format("DD MMM YYYY")
            : null,

          ModifiedBy: row.modifiedby,
          ModifiedDateTime: row.modifieddatetime
            ? moment(row.modifieddatetime).format("DD MMM YYYY")
            : null,

          DeletedBy: row.deletedby,
          DeletedDateTime: row.deleteddatetime
            ? moment(row.deleteddatetime).format("DD MMM YYYY")
            : null,

          Logos: [],
        };
      }

      if (row.logoid) {
        organizations[row.organizationid].Logos.push({
          LogoID: row.logoid,
          LogoType: row.logotype,
          LogoName: generateUrl(row.logoname),
        });
      }
    });

    return {
      success: true,
      message: "Organizations fetched successfully",
      data: Object.values(organizations),
    };
  } catch (error) {
    console.log("Get Organization Error :", error.message);

    return {
      success: false,
      message: error.message,
    };
  }
};
// ========================================= Update Organization
const updateOrganization = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
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

      ModifiedBy,

      Logos,
    } = data;

    // ================= Organization Update =================

    const organizationQuery = `
      UPDATE Organization_Master
      SET
        OrganizationName = $1,
        OrganizationCode = $2,
        ShortName = $3,

        Country = $4,
        State = $5,
        City = $6,
        Address = $7,

        Currency = $8,
        TimeZone = $9,

        Email = $10,
        AlternativeEmail = $11,

        Phone = $12,
        AlternativePhone = $13,

        Website = $14,
        TaxNumber = $15,

        PolicyDetails = $16,

        FinancialYearStart = $17,

        FinanceModule = $18,

        PostalCode = $19,

        PMS = $20,
        PMSIDCode = $21,

        LegalName = $22,

        ReviewSoftware = $23,

        FinanceModuleCode = $24,

        PosModule = $25,

        BrandID = $26,

        ModifiedBy = $27,
        ModifiedDateTime = NOW()

      WHERE OrganizationID = $28
        AND IsDeleted = FALSE

      RETURNING *;
    `;

    const values = [
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

      ModifiedBy,

      OrganizationID,
    ];

    const result = await client.query(organizationQuery, values);

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return {
        success: false,
        message: "Organization Not Found",
      };
    }

    // ================= Update Logos =================

    if (Logos && Logos.length > 0) {
      for (const logo of Logos) {
        await client.query(
          `
          UPDATE Organization_Master_Logo
          SET
              LogoName = $1,
              ModifiedBy = $2,
              ModifiedDateTime = NOW()
          WHERE OrganizationID = $3
            AND LogoType = $4
            AND IsDeleted = FALSE
          `,
          [logo.LogoName, ModifiedBy, OrganizationID, logo.LogoType],
        );
      }
    }

    await client.query("COMMIT");

    return {
      success: true,
      message: "Organization Updated Successfully",
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.log("Update Organization Error :", error.message);

    return {
      success: false,
      message: error.message,
    };
  } finally {
    client.release();
  }
};
// ========================================= Delete Organization
const deleteOrganization = async (data) => {

    const client = await pool.connect();

    try {

        await client.query("BEGIN");

        const { OrganizationID, DeletedBy } = data;

        // Soft Delete Organization
        const organizationResult = await client.query(
            `
            UPDATE Organization_Master
            SET
                IsDeleted = TRUE,
                DeletedBy = $1,
                DeletedDateTime = NOW()
            WHERE OrganizationID = $2
              AND IsDeleted = FALSE
            RETURNING *;
            `,
            [DeletedBy, OrganizationID]
        );

        if (organizationResult.rows.length === 0) {

            await client.query("ROLLBACK");

            return {
                success: false,
                message: "Organization Not Found"
            };

        }

        // Soft Delete Organization Logos
        await client.query(
            `
            UPDATE Organization_Master_Logo
            SET
                IsDeleted = TRUE,
                DeletedBy = $1,
                DeletedDateTime = NOW()
            WHERE OrganizationID = $2
              AND IsDeleted = FALSE;
            `,
            [DeletedBy, OrganizationID]
        );

        await client.query("COMMIT");

        return {
            success: true,
            message: "Organization Deleted Successfully"
        };

    } catch (error) {

        await client.query("ROLLBACK");

        console.log("Delete Organization Error :", error.message);

        return {
            success: false,
            message: error.message
        };

    } finally {

        client.release();

    }

};
// ==========================================Get OrganizationList for Dropdown
const getOrganizationsDropdown = async () => {
  try {
    const query = `
      SELECT
        om.OrganizationID,
        om.OrganizationName,
        om.OrganizationCode,
        om.ShortName,

        ol.LogoID,
        ol.LogoType,
        ol.LogoName

      FROM Organization_Master om

      LEFT JOIN Organization_Master_Logo ol
        ON om.OrganizationID = ol.OrganizationID
       AND ol.IsDeleted = FALSE

      WHERE om.IsDeleted = FALSE
        AND om.IsActive = TRUE

      ORDER BY om.OrganizationName ASC;
    `;

    const result = await pool.query(query);

    const organizations = {};

    result.rows.forEach((row) => {

      if (!organizations[row.organizationid]) {
        organizations[row.organizationid] = {
          OrganizationID: row.organizationid,
          OrganizationName: row.organizationname,
          OrganizationCode: row.organizationcode,
          ShortName: row.shortname,
          Logos: [],
        };
      }

      if (row.logoid) {
        organizations[row.organizationid].Logos.push({
          LogoID: row.logoid,
          LogoType: row.logotype,
          LogoName: row.logoname
            ? generateUrl(row.logoname)
            : null,
        });
      }
    });

    return {
      success: true,
      message: "Organizations fetched successfully",
      data: Object.values(organizations),
    };

  } catch (error) {

    console.log("Get Organization Dropdown Error :", error.message);

    return {
      success: false,
      message: error.message,
    };

  }
};

module.exports = {
  createOrganization,
  getAllOrganizations,
  updateOrganization,
  deleteOrganization,
  getOrganizationsDropdown
};
