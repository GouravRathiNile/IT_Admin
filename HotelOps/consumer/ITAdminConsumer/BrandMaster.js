const BrandMaster = require("../../services/ITAdminService/BrandMaster");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");

const BrandMasterConsumer = async (payload) => {
    try {
        const { action, data } = payload;
        switch (action) {
            // ======================================Create Brand
            case "CREATE_BRAND":
                return await BrandMaster.createBrand(data);

            // =======================================Update Brand
            case "UPDATE_BRAND":

                return await BrandMaster.updateBrand(data);

            // =======================================Delete Brand
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

        const retryResponse = retryableDatabaseResponse(error);
        if (retryResponse) return retryResponse;

        return {

            success: false,
            message: error.message

        };

    }

};

module.exports = BrandMasterConsumer;
