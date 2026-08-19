const path = require("path");
const crypto = require("crypto");

const {
  containerClient
} = require("./AzurContainer");

const uploadToAzure = async (file) => {

  const extension = path.extname(
    file.originalname
  );

  const blobName =
    `OpexDocuments/${crypto.randomUUID()}${extension}`;

  const blockBlobClient =
    containerClient.getBlockBlobClient(
      blobName
    );

  await blockBlobClient.uploadData(
    file.buffer,
    {
      blobHTTPHeaders: {
        blobContentType:
          file.mimetype
      }
    }
  );

  return blobName;
};


module.exports = uploadToAzure;
