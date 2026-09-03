const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const upload = require("../../middleware/upload");

const startUploadServer = async () => {
  const app = express();
  app.post("/upload", upload.array("Documents", 10), (req, res) => {
    res.json({ success: true, count: req.files.length });
  });
  app.use((error, _req, res, _next) => {
    res.status(400).json({ success: false, code: error.code, message: error.message });
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  return server;
};

const uploadFiles = async (server, count, type = "image/png") => {
  const form = new FormData();
  for (let index = 0; index < count; index += 1) {
    form.append(
      "Documents",
      new Blob([Buffer.from("test")], { type }),
      `document-${index + 1}.${type === "application/pdf" ? "pdf" : "png"}`,
    );
  }

  const address = server.address();
  const response = await fetch(
    `http://127.0.0.1:${address.port}/upload`,
    { method: "POST", body: form },
  );

  return { status: response.status, body: await response.json() };
};

test("CAPEX uploader accepts up to 10 Documents and rejects the eleventh", { concurrency: false }, async () => {
  const server = await startUploadServer();
  try {
    for (const count of [1, 2, 10]) {
      const response = await uploadFiles(server, count);
      assert.equal(response.status, 200);
      assert.equal(response.body.count, count);
    }

    const response = await uploadFiles(server, 11);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "LIMIT_FILE_COUNT");
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("shared uploader accepts image, PDF, and Excel types and rejects unsupported types", { concurrency: false }, async () => {
  const server = await startUploadServer();
  try {
    for (const type of [
      "image/webp",
      "image/svg+xml",
      "application/pdf",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "application/vnd.ms-excel.sheet.binary.macroenabled.12",
      "text/csv",
    ]) {
      const accepted = await uploadFiles(server, 1, type);
      assert.equal(accepted.status, 200, `${type} should be accepted`);
    }

    const response = await uploadFiles(server, 1, "text/plain");
    assert.equal(response.status, 400);
    assert.equal(
      response.body.message,
      "Only image, PDF, Excel, and CSV attachments are allowed.",
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("CAPEX Create and Update routes use the shared uploader", () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, "../../routes/CapexRoute/CapexRoute.js"),
    "utf8",
  );

  assert.match(routeSource, /router\.post\("\/Create",authenticateToken,upload\.array\("Documents", 10\),createCapex,/);
  assert.match(routeSource, /router\.put\( "\/Update", authenticateToken, upload\.array\("Documents", 10\),updateCapex,/);

  const uploadSource = fs.readFileSync(
    path.join(__dirname, "../../middleware/upload.js"),
    "utf8",
  );
  assert.match(uploadSource, /fileSize:\s*50 \* 1024 \* 1024/);
  assert.match(uploadSource, /files:\s*10/);
  assert.doesNotMatch(uploadSource, /capexDocumentsUpload|capexUpload/);
});
