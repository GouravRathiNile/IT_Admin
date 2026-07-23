const BrandMaster = require("../services/BrandMaster");

const BrandMasterConsumer = async (payload) => {
    try {
        const { action, data } = payload;
        switch (action) {
            // ======================================Create Brand
            case "CREATE_BRAND":
                return await BrandMaster.createBrand(data);
            // ==========================
            // Get All Brands
            // ==========================
            case "GET_ALL_BRANDS":

                return await BrandMaster.getAllBrands();

            // ==========================
            // Update Brand
            // ==========================
            case "UPDATE_BRAND":

                return await BrandMaster.updateBrand(data);

            // ==========================
            // Delete Brand
            // ==========================
            case "DELETE_BRAND":

                return await BrandMaster.deleteBrand(
                    data.BrandID,
                    data.DeletedBy
                );

            default:

                return {
                    success: false,
                    message: "Invalid Action"
                };

        }

    } catch (error) {

        return {

            success: false,
            message: error.message

        };

    }

};

module.exports = BrandMasterConsumer;