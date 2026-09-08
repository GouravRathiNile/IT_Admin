require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../../routes/GuestGlitchRoutes/GuestGlitchRoutes");
const validator = require("../../validators/GuestGlitchValidator");
const { compactReportDTO, completeReportDTO } = require("../../dto/GuestGlitchReportDTO");
const { generatePdf } = require("../../utils/pdfHelper");

test("remaining API routes expose approved methods", () => {
  const routes = router.stack.filter((layer) => layer.route).map((layer) => [layer.route.path, layer.route.methods]);
  const has = (path, method) => routes.some(([routePath, methods]) => routePath === path && methods[method]);
  for (const [path, method] of [["/report", "get"], ["/report/:id", "get"], ["/master-report", "get"], ["/master-report/:id/pdf", "get"], ["/gm/:id", "get"], ["/gm-action", "patch"], ["/attachment/:id", "get"]]) assert.ok(has(path, method));
});

test("GM action validates required comment and ID", () => {
  assert.equal(validator.validateGMAction({ ID: 1 })[0].message, "GMComment is required");
  assert.deepEqual(validator.validateGMAction({ ID: 1, GMComment: "Reviewed" }), []);
});

test("report DTOs omit physical attachment storage paths", () => {
  const row = { id: 1, organizationid: 10, hotel: "Hotel", attachment: "private/blob.pdf", attachmenttitle: "Evidence.pdf", departmentids: [], receivedbyids: [], informedtoids: [] };
  const compact = compactReportDTO(row);
  const complete = completeReportDTO(row, {});
  assert.equal(compact.Attachment, undefined);
  assert.deepEqual(complete.Attachment, { Title: "Evidence.pdf", Available: true });
  assert.equal(JSON.stringify(complete).includes("private/blob.pdf"), false);
});

test("PDF service returns a valid PDF buffer", async () => {
  const pdf = await generatePdf({ title: "Guest Glitch Master Report", reportName: "Guest Glitch Master Report", metadata: [{ label: "Record ID", value: 1 }] });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});

test("single-record PDF helper supports light headers and wrapping full-width narrative rows", async () => {
  const longText = "Long Guest Glitch narrative content. ".repeat(180);
  const pdf = await generatePdf({
    title: "Guest Glitch", reportName: "Guest Glitch",
    sections: [
      { title: "Complaint", lightHeader: true, value: longText },
      { title: "Detailed Investigation", lightHeader: true, value: longText },
      { title: "Service Recovery", lightHeader: true, value: longText },
    ],
  });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 1000);
});

test("report-only PDF table renders zero, one and many sequential rows", async () => {
  const columns = [
    { header: "SR#", key: "Serial", width: 30, align: "center" },
    { header: "Guest Name", key: "GuestName", width: "*" },
  ];
  for (const count of [0, 1, 25]) {
    const rows = Array.from({ length: count }, (_, index) => ({ Serial: index + 1, GuestName: `Guest ${index + 1}` }));
    const pdf = await generatePdf({ title: "Guest Glitch Report", reportName: "Guest Glitch Report", orientation: "landscape", columns, rows });
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  }
});

test("attachment disposition is allowlisted", () => {
  assert.deepEqual(validator.validateDisposition("inline"), []);
  assert.deepEqual(validator.validateDisposition("attachment"), []);
  assert.equal(validator.validateDisposition("javascript")[0].field, "disposition");
});
