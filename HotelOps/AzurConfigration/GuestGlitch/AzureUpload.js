const path = require("path");
const crypto = require("crypto");
const { containerClient } = require("../ITAdmin/UserMaster/AzurContainer");

const uploadGuestGlitchAttachment = async (file) => {
  const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf" };
  const extension = extensions[file.mimetype] || path.extname(file.originalname).toLowerCase();
  const blobName = `GuestGlitch/${crypto.randomUUID()}${extension}`;
  const blob = containerClient.getBlockBlobClient(blobName);
  await blob.uploadData(file.buffer, { blobHTTPHeaders: { blobContentType: file.mimetype } });
  return blobName;
};

module.exports = uploadGuestGlitchAttachment;
