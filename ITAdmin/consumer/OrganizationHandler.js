const OrganizationService = require("../services/OrganizationService");

const OrganizationHandler = async (message) => {

    try {

        switch (message.action) {

            //==========================================
            // Create Organization
            //==========================================
            case "CREATE_ORGANIZATION":

                console.log("Enter Organization Consumer Successfully");

                return await OrganizationService.createOrganization(
                    message.data
                );

            default:

                return {

                    success: false,
                    message: "Invalid Action"

                };

        }

    } catch (error) {

        console.log(error);

        return {

            success: false,
            message: error.message

        };

    }

};

module.exports = OrganizationHandler;