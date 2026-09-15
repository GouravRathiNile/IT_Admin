const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const express = require("express");
const QRCode = require("qrcode");
const sharp = require("sharp");
const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("QR GET returns PNG by default and preserves optional JSON", async () => {
  const source = read("services/EngineeringService/EngineeringService.js");
  const start = source.indexOf("const generateEquipmentQRCode =");
  const end = source.indexOf("// ============================================================EXPORTS", start);
  let encodedURL;
  const context = {
    Buffer, URL, console, sharp,
    process: { env: { PUBLIC_EQUIPMENT_URL: "https://example.test/public/Equipment?source=qr" } },
    QRCode: { toBuffer: (url, options) => { encodedURL = url; return QRCode.toBuffer(url, options); } },
    pool: { query: async () => ({ rows: [{ description: "Kitchen <range>", area: "Kitchen", organizationshortname: "HJU" }] }) },
    loadLogo: async () => null,
    ok: (message, data) => ({ success: true, message, data }),
    fail: (message, statusCode) => ({ success: false, message, statusCode }),
    retryableDatabaseResponse: () => null,
    databaseFailure: () => { throw new Error("QR generation failed"); },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + "\nthis.generate = generateEquipmentQRCode;", context);
  const result = await context.generate({ OrganizationID: 20, EquipmentID: 2 });
  assert.equal(result.success, true);
  const url = new URL(encodedURL);
  assert.equal(url.searchParams.get("EquipmentID"), "2");
  assert.equal(url.searchParams.get("source"), "qr");
  const png = Buffer.from(result.data.QRCode.split(",")[1], "base64");
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 900);

  const controller = read("controllers/EngineeringController/EngineeringController.js");
  const scope = { exports: {}, Buffer,
    EngineeringService: { generateEquipmentQRCode: async () => result },
    handleError: (error) => { throw error; },
  };
  vm.runInNewContext(controller.slice(controller.indexOf("exports.generateEquipmentQRCode =")), scope);
  let body, contentType;
  const response = { set() { return this; }, status() { return this; },
    type(type) { contentType = type; return this; },
    send(value) { body = value; }, json(value) { body = value; } };
  await scope.exports.generateEquipmentQRCode({ query: { EquipmentID: "2" } }, response);
  assert.equal(contentType, "png");
  assert.deepEqual(body, png);
  await scope.exports.generateEquipmentQRCode({ query: { format: "json" } }, response);
  assert.equal(body, result);
});

test("public scan page shows limited equipment/maintenance data and handles errors", async () => {
  let rows = [{ description: '<script>alert(1)</script>', departmentname: "Engineering",
    warrantystatus: "Expired", amcstatus: "Active", maintenanceid: 1,
    maintenance: "Routine service", maintenancedate: "2026-09-01", scheduleofservicing: "Monthly",
    maintenanceby: "Maintenance team", engineername: "Engineer", vendorname: "PRIVATE-VENDOR" }];
  let calls = 0;
  const scope = { module: { exports: {} }, console, require(name) {
    if (name === "express") return express;
    if (name === "../../db") return { pool: { query: async (sql, values) => {
      calls++;
      assert.deepEqual(Array.from(values), [20, 2]);
      assert.match(sql, /ORDER BY m.MaintenanceDate DESC NULLS LAST, m.MaintenanceID DESC/);
      assert.match(sql, /m.IsDeleted = FALSE/);
      return { rows };
    } } };
    if (name === "../../utils/dateFormatter") return { formatDate: (value) => value };
    throw new Error(name);
  } };
  vm.runInNewContext(read("routes/EngineeringRoutes/PublicEquipmentRoutes.js"), scope);
  const app = express();
  app.use("/public", scope.module.exports);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/public/Equipment`;
  try {
    let response = await fetch(`${base}?OrganizationID=20&EquipmentID=2`);
    let html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Last Maintenance Detail/);
    assert.match(html, /Monthly/);
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("PRIVATE-VENDOR"));
    rows = [{ description: "Range" }];
    html = await (await fetch(`${base}?OrganizationID=20&EquipmentID=2`)).text();
    assert.match(html, /No maintenance records available/);
    rows = [];
    response = await fetch(`${base}?OrganizationID=20&EquipmentID=2`);
    assert.equal(response.status, 404);
    const previous = calls;
    response = await fetch(`${base}?OrganizationID=20&EquipmentID=bad`);
    assert.equal(response.status, 400);
    assert.equal(calls, previous);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
