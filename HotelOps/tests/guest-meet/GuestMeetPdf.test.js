const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../../db");
const GuestMeetService = require("../../services/GuestMeetService/GuestMeetService");
const GuestMeetController = require("../../controllers/GuestMeetController/GuestMeetController");

test("Guest detail PDF service returns the standard binary response", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    if (/FROM GuestMeet_Daily_Entry_Details d/.test(sql)) {
      return {
        rows: [{
          gmdetailid: 8,
          organizationid: 20,
          gmmasterid: 2,
          guestname: "Test Guest",
          roomno: "101",
          bookingsource: "Direct",
          arrival: "2026-09-01",
          departure: "2026-09-03",
          feedback: "Good",
          actiontaken: "None",
          metby: 1,
          meton: "Lobby",
          feedbacktype: "Positive",
          gueststatus: "In House",
          createddate: "2026-09-01",
          entrydate: "2026-09-01",
          organizationname: "Hotel Test",
          organizationshortname: "HTL",
          metbyname: "Manager",
        }],
      };
    }
    return { rows: [] };
  };

  try {
    const response = await GuestMeetService.generateGuestDetailPdf({
      OrganizationID: 20,
      GMDetailID: 8,
    });
    assert.equal(response.success, true);
    assert.equal(response.contentType, "application/pdf");
    assert.equal(response.fileName, "Guest-Detail-8.pdf");
    assert.equal(Buffer.isBuffer(response.data), true);
    assert.equal(response.data.subarray(0, 4).toString(), "%PDF");
  } finally {
    pool.query = originalQuery;
  }
});

test("Guest detail PDF controller sends standard and legacy service payloads", { concurrency: false }, async () => {
  const originalGenerate = GuestMeetService.generateGuestDetailPdf;

  const runController = async (serviceResponse) => {
    GuestMeetService.generateGuestDetailPdf = async () => serviceResponse;
    const headers = {};
    let body;
    const res = {
      setHeader: (name, value) => { headers[name] = value; },
      status: () => res,
      json: (value) => { body = value; return res; },
      end: (value) => { body = value; return res; },
    };
    await GuestMeetController.generateGuestDetailPdf(
      { query: { OrganizationID: "20" }, params: { id: "8" }, user: { UserID: 1 } },
      res,
    );
    return { headers, body };
  };

  try {
    const standard = await runController({
      success: true,
      data: Buffer.from("%PDF-standard"),
      fileName: "standard.pdf",
      contentType: "application/pdf",
    });
    assert.equal(Buffer.isBuffer(standard.body), true);
    assert.equal(standard.headers["Content-Type"], "application/pdf");

    const legacy = await runController({
      success: true,
      data: {
        FileName: "legacy.pdf",
        MimeType: "application/pdf",
        FileData: Buffer.from("%PDF-legacy").toString("base64"),
      },
    });
    assert.equal(legacy.body.toString(), "%PDF-legacy");
    assert.match(legacy.headers["Content-Disposition"], /legacy\.pdf/);
  } finally {
    GuestMeetService.generateGuestDetailPdf = originalGenerate;
  }
});

test("Guest feedback report returns feedback labels as JSON keys", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  let reportQuery;
  pool.query = async (sql) => {
    reportQuery = sql;
    return {
      rows: [{
        organizationid: "20",
        shortname: "HTL",
        feedbackdata: [
          { "Negative Feedback": 1 },
          { "Positive Feedback": 1 },
        ],
      }],
    };
  };

  try {
    const response = await GuestMeetService.getFeedbackReport({
      OrganizationID: 20,
    });
    assert.equal(response.success, true);
    assert.deepEqual(response.data[0].FeedbackData, [
      { "Negative Feedback": 1 },
      { "Positive Feedback": 1 },
    ]);
    assert.match(
      reportQuery,
      /JSON_BUILD_OBJECT\(\s*FeedbackType \|\| ' Feedback',\s*TotalGuests/,
    );
    assert.doesNotMatch(reportQuery, /'FeedbackType',\s*FeedbackType/);
  } finally {
    pool.query = originalQuery;
  }
});
