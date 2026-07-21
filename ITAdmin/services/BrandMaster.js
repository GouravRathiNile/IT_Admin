const { pool } = require("../db");


//=========================================== Create Brand
const createBrand = async (data) => {
        console.log('Enter Database successfully')
    const {
        BrandCode,
        BrandName,
        ShortName,
        BrandLogo,
        Website,
        IsActive,
        CreatedBy,
        IsDeleted
    } = data;

    const query = `
        INSERT INTO Brand_Master
        (
            BrandCode,
            BrandName,
            ShortName,
            BrandLogo,
            Website,
            IsActive,
            CreatedBy,
            IsDeleted
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *;
    `;

    const values = [
        BrandCode,
        BrandName,
        ShortName,
        BrandLogo,
        Website,
        IsActive,
        CreatedBy,
        IsDeleted
    ];

    const result = await pool.query(query, values);

    return {
        success: true,
        message: "Brand Created Successfully",
    };

};

// ===============================
// Get All Brands
// ===============================
const getAllBrands = async () => {

    const query = `
        SELECT *
        FROM Brand_Master
        WHERE IsDeleted = FALSE
        ORDER BY BrandID DESC;
    `;

    const result = await pool.query(query);

    return {
        success: true,
        data: result.rows
    };

};

// ===============================
// Get Brand By Id
// ===============================
const getBrandById = async (BrandID) => {

    const query = `
        SELECT *
        FROM Brand_Master
        WHERE BrandID = $1
        AND IsDeleted = FALSE;
    `;

    const result = await pool.query(query, [BrandID]);

    if (result.rows.length === 0) {

        return {
            success: false,
            message: "Brand Not Found"
        };

    }

    return {
        success: true,
        data: result.rows[0]
    };

};

// ===============================
// Update Brand
// ===============================
const updateBrand = async (data) => {

    const {

        BrandID,
        BrandCode,
        BrandName,
        ShortName,
        BrandLogo,
        Website,
        IsActive,
        ModifiedBy

    } = data;

    const query = `
        UPDATE Brand_Master
        SET
            BrandCode=$1,
            BrandName=$2,
            ShortName=$3,
            BrandLogo=$4,
            Website=$5,
            IsActive=$6,
            ModifiedBy=$7,
            ModifiedDateTime=NOW()
        WHERE BrandID=$8
        AND IsDeleted=FALSE
        RETURNING *;
    `;

    const values = [

        BrandCode,
        BrandName,
        ShortName,
        BrandLogo,
        Website,
        IsActive,
        ModifiedBy,
        BrandID

    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {

        return {

            success: false,
            message: "Brand Not Found"

        };

    }

    return {

        success: true,
        message: "Brand Updated Successfully",
        data: result.rows[0]

    };

};

// ===============================
// Delete Brand
// ===============================
const deleteBrand = async (BrandID, DeletedBy) => {

    const query = `
        UPDATE Brand_Master
        SET
            IsDeleted=TRUE,
            DeletedBy=$1,
            DeletedDateTime=NOW()
        WHERE BrandID=$2
        RETURNING *;
    `;

    const result = await pool.query(query, [

        DeletedBy,
        BrandID

    ]);

    if (result.rows.length === 0) {

        return {

            success: false,
            message: "Brand Not Found"

        };

    }

    return {

        success: true,
        message: "Brand Deleted Successfully"

    };

};

module.exports = {

    createBrand,
    getAllBrands,
    getBrandById,
    updateBrand,
    deleteBrand

};