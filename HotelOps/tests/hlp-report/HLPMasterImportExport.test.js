const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const service = require("../../services/HLPReportService/HLPReportService");
const { pool } = require("../../db");
const express = require("express");
const upload = require("../../middleware/upload");

const root = path.resolve(__dirname, "../..");

test("bulk master create validates duplicate titles before database access", async () => {
  const response = await service.createMasterField({
    UserID: 1,
    OrganizationID: 10,
    Fields: [{ Title: "Rooms" }, { Title: " rooms " }],
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.message, /Duplicate master field Title/);
});

test("bulk master create appends sequential order in one transaction", async () => {
  const originalConnect = pool.connect;
  const inserted = [];
  try {
    pool.connect = async () => ({
      query: async (sql, values = []) => {
        if (/FROM user_org_mapping/.test(sql)) return { rowCount: 1, rows: [{}] };
        if (/SELECT title FROM hlpreport_master_list/.test(sql)) return { rowCount: 0, rows: [] };
        if (/MAX\(orderby\)/.test(sql)) return { rows: [{ orderby: 4 }] };
        if (/INSERT INTO hlpreport_master_list/.test(sql)) {
          inserted.push(values);
          return { rows: [{ ID: String(inserted.length + 10), Title: values[1], OrderBy: values[2] }] };
        }
        return { rowCount: 0, rows: [] };
      },
      release() {},
    });
    const response = await service.createMasterField({
      UserID: 7, OrganizationID: 10,
      Fields: [{ Title: "Revenue" }, { Title: "Occupancy" }],
    });
    assert.equal(response.success, true);
    assert.deepEqual(inserted.map((values) => values.slice(0, 3)), [
      [10, "Revenue", 4], [10, "Occupancy", 5],
    ]);
  } finally { pool.connect = originalConnect; }
});

test("master import skips existing titles and creates only new fields", async () => {
  const originalConnect = pool.connect;
  const inserted = [];
  try {
    pool.connect = async () => ({
      query: async (sql, values = []) => {
        if (/FROM user_org_mapping/.test(sql)) return { rowCount: 1, rows: [{}] };
        if (/SELECT title FROM hlpreport_master_list/.test(sql)) {
          return { rowCount: 1, rows: [{ title: "Rooms Occupied" }] };
        }
        if (/MAX\(orderby\)/.test(sql)) return { rows: [{ orderby: 3 }] };
        if (/INSERT INTO hlpreport_master_list/.test(sql)) {
          inserted.push(values);
          return { rows: [{ ID: "12", Title: values[1], OrderBy: values[2] }] };
        }
        return { rowCount: 0, rows: [] };
      },
      release() {},
    });
    const csv = "Title,OrderBy\r\nRooms Occupied,1\r\nRevenue,2";
    const response = await service.importMasterFields({
      UserID: 7,
      OrganizationID: 10,
      File: {
        originalname: "master.csv",
        mimetype: "text/csv",
        bufferBase64: Buffer.from(csv).toString("base64"),
      },
    });
    assert.equal(response.success, true);
    assert.equal(response.message, "HLP master fields imported successfully. 1 added, 1 skipped.");
    assert.deepEqual(inserted.map((values) => values.slice(0, 3)), [[10, "Revenue", 3]]);
  } finally { pool.connect = originalConnect; }
});

test("master CSV export contains only Title and OrderBy for authorized organization", async () => {
  const originalConnect = pool.connect;
  try {
    pool.connect = async () => ({
      query: async (sql) => /FROM user_org_mapping/.test(sql)
        ? ({ rowCount: 1, rows: [{}] })
        : ({ rows: [{ ID: "9", Title: "Rooms Occupied", OrderBy: 1 }] }),
      release() {},
    });
    const response = await service.exportMasterFields({ UserID: 7, OrganizationID: 10, Format: "csv" });
    assert.equal(response.success, true);
    assert.equal(Buffer.from(response.fileBase64, "base64").toString("utf8"), "\uFEFFTitle,OrderBy\r\nRooms Occupied,1");
  } finally { pool.connect = originalConnect; }
});

test("organization migration preserves legacy rows and repoints existing details", () => {
  const sql = fs.readFileSync(path.join(root, "docs/hlp-master-organization-migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS organizationid BIGINT/);
  assert.match(sql, /UPDATE hlpreport_entry_details detail[\s\S]*SET masterid = mapping\.new_id/);
  assert.match(sql, /UPDATE hlpreport_master_list[\s\S]*SET isactive = FALSE, orderby = NULL[\s\S]*WHERE organizationid IS NULL/);
  assert.match(sql, /ux_hlp_master_org_active_title/);
  assert.match(sql, /ux_hlp_master_org_active_order/);
});

test("HLP import middleware accepts the exact File CSV field and rejects missing multipart boundary", { concurrency: false }, async () => {
  const app = express();
  app.post("/import", upload.hlpMasterImportUpload, (req, res) => res.json({
    success: true,
    filename: req.file?.originalname,
    organizationID: req.body?.OrganizationID,
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const address = server.address();
    const form = new FormData();
    form.append("OrganizationID", "10");
    form.append("File", new Blob(["Title,OrderBy\r\nRooms,1"], { type: "text/csv" }), "master.csv");
    const accepted = await fetch(`http://127.0.0.1:${address.port}/import`, { method: "POST", body: form });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { success: true, filename: "master.csv", organizationID: "10" });

    const malformed = await fetch(`http://127.0.0.1:${address.port}/import`, {
      method: "POST", headers: { "Content-Type": "multipart/form-data" }, body: "invalid",
    });
    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).message, /multipart boundary/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
