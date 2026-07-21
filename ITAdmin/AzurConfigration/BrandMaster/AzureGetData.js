const {
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions
} = require("@azure/storage-blob");

const accountName = "hotelopsdevstorage";
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;

const containerName = "itadmin";

const sharedKeyCredential = new StorageSharedKeyCredential(
  accountName,
  accountKey
);

function generateUrl(blobName) {
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      expiresOn: new Date(Date.now() + 60 * 60 * 1000),
    },
    sharedKeyCredential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/BrandLogo/${blobName}?${sasToken}`;
}

module.exports = generateUrl;