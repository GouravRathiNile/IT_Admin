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

test("Guest Meet date-range API applies MetBy to details and TotalCount only", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/ARRAY_AGG\(m\.GMMasterID/.test(sql)) {
      return {
        rows: [{
          gmmasterids: [10],
          roomsinhouse: "20",
          guestsinhouse: "30",
          arrivals: "4",
          departures: "3",
          occupancy: "75",
          createddate: "2026-09-01",
        }],
      };
    }
    if (/COUNT\(\*\)::bigint AS TotalCount/.test(sql)) {
      return { rows: [{ totalcount: "1" }] };
    }
    return {
      rows: [{
        gmdetailid: 8,
        organizationid: 20,
        gmmasterid: 10,
        guestname: "Test Guest",
        metby: 4,
      }],
    };
  };

  try {
    const response = await GuestMeetService.getDateRangeReport({
      OrganizationID: 20,
      FromDate: "2026-09-01",
      ToDate: "2026-09-07",
      MetBy: "4",
      page: 1,
      PageSize: 10,
    });

    assert.equal(response.success, true);
    assert.equal(response.TotalCount, 1);
    assert.deepEqual(calls[0].values, [20, "2026-09-01", "2026-09-07"]);

    const detailCalls = calls.slice(1);
    assert.equal(detailCalls.length, 2);
    for (const call of detailCalls) {
      assert.match(call.sql, /\$4::bigint IS NULL OR d\.MetBy = \$4::bigint/);
      assert.equal(call.values[3], 4);
    }
    const pagedCall = detailCalls.find((call) => /LIMIT \$5 OFFSET \$6/.test(call.sql));
    assert.deepEqual(pagedCall.values, [20, "2026-09-01", "2026-09-07", 4, 10, 0]);
  } finally {
    pool.query = originalQuery;
  }
});

test("Guest Meet date-range MetBy is optional and rejects invalid user IDs", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  let queryCount = 0;
  pool.query = async (sql) => {
    queryCount += 1;
    if (/ARRAY_AGG\(m\.GMMasterID/.test(sql)) {
      return { rows: [{ gmmasterids: null }] };
    }
    return { rows: [] };
  };

  try {
    const base = {
      OrganizationID: 20,
      FromDate: "2026-09-01",
      ToDate: "2026-09-07",
    };
    const withoutFilter = await GuestMeetService.getDateRangeReport({
      ...base,
      MetBy: " ",
    });
    assert.equal(withoutFilter.success, true);
    assert.equal(queryCount, 1);

    for (const MetBy of ["abc", 0, -1, 1.5]) {
      const api = await GuestMeetService.getDateRangeReport({ ...base, MetBy });
      const pdf = await GuestMeetService.generateDateRangeReportPdf({ ...base, MetBy });
      assert.equal(api.statusCode, 400);
      assert.equal(pdf.statusCode, 400);
      assert.match(api.message, /MetBy must be a positive integer/);
    }
    assert.equal(queryCount, 1);
  } finally {
    pool.query = originalQuery;
  }
});

test("Guest Meet date-range PDF applies the same MetBy filter", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/ARRAY_AGG\(/.test(sql)) {
      return {
        rows: [{
          gmmasterids: [10],
          roomsinhouse: "20",
          guestsinhouse: "30",
          arrivals: "4",
          departures: "3",
          occupancy: "75",
          createddate: "2026-09-01",
        }],
      };
    }
    if (/FROM GuestMeet_Daily_Entry_Details d/.test(sql)) return { rows: [] };
    if (/FROM Organization_Master/.test(sql)) {
      return { rows: [{ organizationid: 20, organizationname: "Hotel Test" }] };
    }
    return { rows: [] };
  };

  try {
    const response = await GuestMeetService.generateDateRangeReportPdf({
      OrganizationID: 20,
      FromDate: "2026-09-01",
      ToDate: "2026-09-07",
      MetBy: 4,
    });

    assert.equal(response.success, true);
    assert.equal(Buffer.isBuffer(response.data), true);
    assert.equal(response.data.subarray(0, 4).toString(), "%PDF");
    const detailsCall = calls.find((call) => /FROM GuestMeet_Daily_Entry_Details d/.test(call.sql));
    assert.match(detailsCall.sql, /\$4::bigint IS NULL OR d\.MetBy = \$4::bigint/);
    assert.deepEqual(detailsCall.values, [20, "2026-09-01", "2026-09-07", 4]);
  } finally {
    pool.query = originalQuery;
  }
});

test("Guest Meet date-range controllers forward MetBy", { concurrency: false }, async () => {
  const originalApi = GuestMeetService.getDateRangeReport;
  const originalPdf = GuestMeetService.generateDateRangeReportPdf;
  const forwarded = [];
  GuestMeetService.getDateRangeReport = async (data) => {
    forwarded.push(data);
    return { success: true, data: [] };
  };
  GuestMeetService.generateDateRangeReportPdf = async (data) => {
    forwarded.push(data);
    return {
      success: true,
      data: Buffer.from("%PDF-test"),
      fileName: "report.pdf",
      contentType: "application/pdf",
    };
  };

  const response = () => {
    const res = {
      setHeader: () => {},
      status: () => res,
      json: () => res,
      send: () => res,
    };
    return res;
  };

  try {
    const req = {
      query: {
        OrganizationID: "20",
        FromDate: "2026-09-01",
        ToDate: "2026-09-07",
        MetBy: "4",
      },
    };
    await GuestMeetController.getDateRangeReport(req, response());
    await GuestMeetController.getDateRangeReportPdf(req, response());
    assert.equal(forwarded.length, 2);
    assert.equal(forwarded[0].MetBy, "4");
    assert.equal(forwarded[1].MetBy, "4");
  } finally {
    GuestMeetService.getDateRangeReport = originalApi;
    GuestMeetService.generateDateRangeReportPdf = originalPdf;
  }
});
