const {
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions
} = require("@azure/storage-blob");

const accountName = "hotelopsdevstorage";
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;

const containerName = "doc";

const sharedKeyCredential = new StorageSharedKeyCredential(
  accountName,
  accountKey
);

const safeFileName = (value) => String(value || "guest-glitch-attachment")
  .replace(/[\r\n"\\/]/g, "_").slice(0, 180);

function generateUrl(blobName, options = {}) {
  const disposition = options.disposition === "attachment" ? "attachment" : "inline";
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      expiresOn: new Date(Date.now() + 60 * 60 * 1000),
      contentDisposition: `${disposition}; filename="${safeFileName(options.filename)}"`,
    },
    sharedKeyCredential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
}

module.exports = generateUrl;
