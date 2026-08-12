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
    `UserProfile/${crypto.randomUUID()}${extension}`;
// console.log("Original Name :", file.originalname);
// console.log("Blob Name :", blobName);
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

  const exists =
    await blockBlobClient.exists();

  // console.log("================================");
  // console.log("✅ Blob Uploaded");
  // console.log("Blob Exists:", exists);
  // console.log("Blob Name:", blobName);
  // console.log("Blob URL:", blockBlobClient.url);
  // console.log("================================");

  return blobName;
};


module.exports = uploadToAzure;     