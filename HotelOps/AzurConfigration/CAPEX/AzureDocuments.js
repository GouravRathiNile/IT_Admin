const path = require("path");
const crypto = require("crypto");
const {
  containerClient,
} = require("../ITAdmin/UserMaster/AzurContainer");

const uploadDocument = async (file) => {
  const extension = path.extname(file.originalname || "");
  const blobName = `CAPEX/${crypto.randomUUID()}${extension}`;
  const blobClient = containerClient.getBlockBlobClient(blobName);

  await blobClient.uploadData(file.buffer, {
    blobHTTPHeaders: {
      blobContentType: file.mimetype || "application/octet-stream",
    },
  });

  return {
    FileName: file.originalname,
    FilePath: blobName,
    FileType: file.mimetype || "application/octet-stream",
    FileSize: file.size,
  };
};

const deleteDocuments = async (documents = []) => {
  await Promise.allSettled(
    documents
      .filter((document) => document?.FilePath)
      .map((document) => containerClient
        .getBlockBlobClient(document.FilePath)
        .deleteIfExists())
  );
};

const uploadDocuments = async (files = []) => {
  const uploaded = [];

  try {
    for (const file of files) {
      uploaded.push(await uploadDocument(file));
    }

    return uploaded;
  } catch (error) {
    await deleteDocuments(uploaded);
    throw error;
  }
};

module.exports = {
  uploadDocuments,
  deleteDocuments,
};
