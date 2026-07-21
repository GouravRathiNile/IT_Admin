const producer = require("../producer/producer");
const QUEUE = require("../config/queue");
const uploadToAzure = require("../AzurConfigration/BrandMaster/AzureUpload");

// ====================================================Create Brand
exports.createBrand = async (req, res) => {
    try {
        console.log('Enter Controller successfully')
        const {
            BrandCode,
            BrandName,
            ShortName,
            Website,
            CreatedBy
        } = req.body;

        let BrandLogo = null;

        if (req.file) {
            BrandLogo = await uploadToAzure(req.file);
        }

        const response = await producer.sendMessage(

            QUEUE.BRAND.REQUEST,
            QUEUE.BRAND.RESPONSE,

            {
                action: "CREATE_BRAND",
                data: {
                    BrandCode,
                    BrandName,
                    ShortName,
                    BrandLogo,
                    Website,
                    IsActive: 1,
                    IsDeleted: 0,
                    CreatedBy
                }
            }
        );
        return res.status(201).json(response);
    }

    catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get All Brands
exports.getAllBrands = async (req, res) => {
    try {

        const response = await producer.sendMessage(
            QUEUE.BRAND.REQUEST,
            QUEUE.BRAND.RESPONSE,
            {
                action: "GET_ALL_BRANDS"
            }
        );

        return res.status(200).json(response);

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

// Get Brand By Id
exports.getBrandById = async (req, res) => {
    try {

        const response = await producer.sendMessage(
            QUEUE.BRAND.REQUEST,
            QUEUE.BRAND.RESPONSE,
            {
                action: "GET_BRAND_BY_ID",
                data: {
                    BrandID: req.params.id
                }
            }
        );

        return res.status(200).json(response);

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

// Update Brand
exports.updateBrand = async (req, res) => {
    try {

        const response = await producer.sendMessage(
            QUEUE.BRAND.REQUEST,
            QUEUE.BRAND.RESPONSE,
            {
                action: "UPDATE_BRAND",
                data: {
                    BrandID: req.params.id,
                    ...req.body
                }
            }
        );

        return res.status(200).json(response);

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

// Delete Brand (Soft Delete)
exports.deleteBrand = async (req, res) => {
    try {

        const response = await producer.sendMessage(
            QUEUE.BRAND.REQUEST,
            QUEUE.BRAND.RESPONSE,
            {
                action: "DELETE_BRAND",
                data: {
                    BrandID: req.params.id,
                    DeletedBy: req.body.DeletedBy
                }
            }
        );

        return res.status(200).json(response);

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }
};