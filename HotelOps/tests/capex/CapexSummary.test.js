const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { pool } = require("../../db");
const CapexService = require("../../services/CapexService/CapexService");

test("CAPEX notifications use organization-scoped configured-role recipients", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../../services/CapexService/CapexService.js"), "utf8");
  const resolver = source.match(/const resolveCapexNotificationRecipients[\s\S]*?const notifyCapex/)?.[0] || "";
  assert.match(resolver, /SELECT DISTINCT um\.userid/);
  assert.match(resolver, /INNER JOIN user_org_mapping uom ON uom\.userid = um\.userid/);
  assert.match(resolver, /WHERE uom\.organizationid = \$1/);
  assert.match(resolver, /UPPER\(TRIM\(um\.usertype\)\) = ANY\(\$2::text\[\]\)/);
  assert.match(resolver, /um\.userid::text = ANY\(\$3::text\[\]\)/);
  assert.match(resolver, /um\.userid::text <> \$4::text/);
  assert.match(resolver, /userIds: notificationUserIds\(result\.rows\.map/);
});

test("CAPEX create and approval notifications follow configured stages and recipient rules", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../../services/CapexService/CapexService.js"), "utf8");
  const createBlock = source.match(/const createCapex = async[\s\S]*?\/\/ =+ Read Query/)?.[0] || "";
  const approvalBlock = source.match(/const processCapexApproval = async[\s\S]*?\/\/ =+ Summary/)?.[0] || source.match(/const processCapexApproval = async[\s\S]*?const getCapexSummaryReport/)?.[0] || "";
  assert.match(createBlock, /const firstApprovalRole = String\(approvals\[0\]\?\.ApprovalRole/);
  assert.match(createBlock, /roles: firstApprovalRole \? \[firstApprovalRole\] : \[\]/);
  assert.match(approvalBlock, /roles: \[followingStage\.role\][\s\S]*includeCreator: true,[\s\S]*excludeActor: true/);
  assert.match(approvalBlock, /kind: "APPROVE"[\s\S]*includeCreator: true/);
  for (const action of ["REJECT", "RETURN"]) {
    assert.match(approvalBlock, new RegExp(`kind: "${action}"[\\s\\S]*roles: \\[approverRole\\][\\s\\S]*includeCreator: true,[\\s\\S]*excludeActor: true`));
  }
  assert.match(approvalBlock, /kind: "HOLD"[\s\S]*roles: \[currentRole\][\s\S]*includeCreator: true,[\s\S]*excludeActor: true/);
});

test("CAPEX notification payloads are canonical and never include CAPEX number", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../../services/CapexService/CapexService.js"), "utf8");
  const notifier = source.match(/const notifyCapex[\s\S]*?const notifyCommittedCapex/)?.[0] || "";
  assert.match(source, /const CAPEX_NOTIFICATION_MODULE = "Capex"/);
  assert.match(notifier, /moduleName: CAPEX_NOTIFICATION_MODULE/);
  assert.match(notifier, /entityType: "Capex"/);
  assert.match(notifier, /type: "info"/);
  assert.match(notifier, /priority: "normal"/);
  assert.match(source, /action: "CREATED"/);
  for (const action of ["APPROVED", "REJECTED", "RETURNED", "HOLD"]) assert.match(source, new RegExp(`notificationAction: "${action}"`));
  const notificationContent = source.match(/const firstApprovalRole[\s\S]*?return \{\s*success: true,\s*message: "CAPEX created/)?.[0] || "";
  assert.doesNotMatch(notificationContent, /CapexNumber|capexNumber/);
  assert.doesNotMatch(notifier, /data\.moduleName|req\.body/);
});

test("CAPEX create and approve notification content uses item, quantity, department and organization", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../../services/CapexService/CapexService.js"), "utf8");
  const content = source.match(/const capexNotificationContent[\s\S]*?const notifyCapex/)?.[0] || "";
  assert.match(content, /kind === "CREATE"/);
  assert.match(content, /title: `CAPEX - \$\{String\(item[\s\S]*\(\$\{String\(qty[\s\S]* - \$\{String\(department[\s\S]* - \$\{organizationShortName\}`/);
  assert.match(content, /message: String\(description \|\| ""\)\.trim\(\)/);
  assert.match(content, /kind === "APPROVE"/);
  assert.match(content, /title: `CAPEX - \$\{String\(item[\s\S]* - \$\{String\(department[\s\S]* - \$\{organizationShortName\}`/);
  assert.match(content, /message: `Approved by \$\{actorName \|\| approverRole\}`/);
  assert.match(content, /\["REJECT", "RETURN", "HOLD"\]\.includes\(kind\)/);
  assert.match(content, /REJECT: "Rejected", RETURN: "Returned", HOLD: "Hold"/);
  assert.match(content, /message: `\$\{actionLabel\} by \$\{actorName \|\| approverRole\}`/);
  assert.doesNotMatch(content, /CapexNumber|capexNumber|approvedQuantity|remarks/i);
});

test("CAPEX notifications are triggered only after commit and failures are isolated", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../../services/CapexService/CapexService.js"), "utf8");
  assert.match(source, /const notifyCommittedCapex = \(event\)[\s\S]*Promise\.resolve\(\)[\s\S]*notifyCapex\(event\)[\s\S]*\.catch\(/);
  assert.match(source, /await client\.query\("COMMIT"\);\s*transactionStarted = false;\s*const firstApprovalRole[\s\S]*notifyCommittedCapex\(/);
  for (const kind of ["REJECT", "RETURN", "HOLD"]) {
    assert.match(source, new RegExp(`await client\\.query\\("COMMIT"\\);[\\s\\S]{0,180}notifyApprovalCommitted\\(\\{[\\s\\S]{0,80}kind: "${kind}"`));
  }
  assert.equal((source.match(/await client\.query\("COMMIT"\);\s*transactionStarted = false;\s*notifyApprovalCommitted\(\{\s*kind: "APPROVE"/g) || []).length, 2);
});

test("CAPEX detail PDF uses its dedicated pdfmake layout and configured approval rows", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    if (/AND cm\.CapexID = \$1/.test(sql)) {
      return {
        rows: [{
          capexid: 14,
          organizationid: 20,
          organizationshortname: "HJU",
          capexnumber: 14,
          department: "Finance",
          item: "Test Item",
          description: "Test description",
          make: "Test Make",
          qty: "100",
          rate: "15",
          total: "1500",
          isvoid: false,
          createddate: "2026-09-03",
          currentstatus: "Pending",
        }],
      };
    }
    if (/FROM Capex_Documents/.test(sql)) return { rows: [] };
    if (/FROM Capex_Approval ca/.test(sql)) {
      return {
        rows: [
          {
            capexapprovalid: 14,
            capexid: 14,
            approvalrole: "GM",
            status: "Approved",
            approvedquantity: "100",
            remarks: null,
          },
          {
            capexapprovalid: 14,
            capexid: 14,
            approvalrole: "CEO",
            status: "Pending",
            approvedquantity: null,
            remarks: null,
          },
        ],
      };
    }
    return { rows: [] };
  };

  try {
    const response = await CapexService.generateCapexByIdPdf({ CapexID: 14 });
    assert.equal(response.success, true);
    assert.equal(Buffer.isBuffer(response.PdfBuffer), true);
    assert.equal(response.PdfBuffer.subarray(0, 4).toString(), "%PDF");

    const source = fs.readFileSync(
      path.join(__dirname, "../../services/CapexService/CapexService.js"),
      "utf8",
    );
    const handler = source.match(
      /const generateCapexByIdPdf[\s\S]*?\/\/ =+ Exports/,
    )[0];
    assert.match(handler, /new PdfPrinter/);
    assert.match(handler, /CAPEX Detail Report/);
    assert.match(handler, /text:\s*"Approval"/);
    assert.match(handler, /text:\s*"Status"/);
    assert.match(handler, /text:\s*"Qty"/);
    assert.match(handler, /text:\s*"Remarks"/);
    assert.match(handler, /const fieldIcon =/);
    assert.match(handler, /await loadLogo\(capex\.OrganizationID\)/);
    assert.doesNotMatch(handler, /const getStatusStyle =/);
    assert.doesNotMatch(handler, /statusTheme/);
    assert.doesNotMatch(handler, /await generatePdf\(/);
  } finally {
    pool.query = originalQuery;
  }
});

test("CAPEX approval responses expose role-wise approved quantity", () => {
  const serviceSource = fs.readFileSync(
    path.join(__dirname, "../../services/CapexService/CapexService.js"),
    "utf8",
  );

  assert.match(serviceSource, /WHEN 'GM' THEN ca\.GMApprovedQuantity/);
  assert.match(serviceSource, /WHEN 'CEO' THEN ca\.CEOApprovedQuantity/);
  assert.match(serviceSource, /WHEN 'OWNER' THEN ca\.OwnerApprovedQuantity/);
  assert.match(serviceSource, /END AS ApprovedQuantity/);
  assert.match(serviceSource, /ApprovedQuantity:[\s\S]*Number\(row\.approvedquantity\)/);
});

test("CAPEX approval forwards and persists request Quantity", () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, "../../controllers/CapexController/CapexController.js"),
    "utf8",
  );
  const serviceSource = fs.readFileSync(
    path.join(__dirname, "../../services/CapexService/CapexService.js"),
    "utf8",
  );

  const approvalController = controllerSource.match(
    /exports\.approveCapex[\s\S]*?\/\/ =+ Report Helpers/,
  )[0];
  assert.match(approvalController, /positiveNumber\(req\.body\.Quantity, "Quantity"\)/);
  assert.match(approvalController, /Remarks: remarks \|\| null,[\s\S]*Quantity,/);
  assert.match(serviceSource, /const approvedQuantity =[\s\S]*Number\(data\.Quantity\)/);
  assert.match(serviceSource, /"Approved",[\s\S]*approvedQuantity,/);
});

const summaryRow = {
  totalcapex: "6",
  totalamount: "2100",
  pendingcount: "1",
  pendingamount: "100",
  approvedcount: "1",
  approvedamount: "200",
  rejectedcount: "1",
  rejectedamount: "300",
  holdcount: "1",
  holdamount: "400",
  returnedcount: "1",
  returnedamount: "500",
  voidcount: "1",
  voidamount: "600",
};

test("non-approval roles receive the organization-wide CAPEX summary", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [summaryRow] };
  };

  try {
    const hod = await CapexService.getCapexSummaryReport({
      Filters: { OrganizationID: 17 },
      UserType: " hod ",
    });
    const user = await CapexService.getCapexSummaryReport({
      Filters: { OrganizationID: 17 },
      UserType: "USER",
    });

    assert.equal(hod.success, true);
    assert.deepEqual(hod.data, user.data);
    assert.equal(hod.data.TotalCapex, 6);
    assert.equal(hod.data.HoldCount, 1);
    assert.deepEqual(calls.map((call) => call.values), [[17], [17]]);
    assert.match(calls[0].sql, /cm\.IsDeleted = FALSE/);
    assert.match(calls[0].sql, /ca\.FinalStatus/);
    assert.match(calls[0].sql, /cm\.IsVoid = TRUE THEN 'Void'/);
  } finally {
    pool.query = originalQuery;
  }
});

test("approval roles retain the role-scoped CAPEX query", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  let call;
  pool.query = async (sql, values) => {
    call = { sql, values };
    return { rows: [summaryRow] };
  };

  try {
    const response = await CapexService.getCapexSummaryReport({
      Filters: { OrganizationID: 17 },
      UserType: "gm",
    });

    assert.equal(response.success, true);
    assert.deepEqual(call.values, [17, "GM"]);
    assert.match(call.sql, /CurrentApprovalRole = \$2/);
  } finally {
    pool.query = originalQuery;
  }
});

test("OrganizationID remains mandatory and the controller trusts JWT UserType", async () => {
  const response = await CapexService.getCapexSummaryReport({
    Filters: {},
    UserType: "USER",
  });
  assert.equal(response.success, false);
  assert.equal(response.statusCode, 400);

  const controllerSource = fs.readFileSync(
    path.join(__dirname, "../../controllers/CapexController/CapexController.js"),
    "utf8",
  );
  const summaryHandler = controllerSource.match(
    /exports\.getCapexSummaryReport[\s\S]*?\/\/ =+ Department Report/,
  )[0];

  assert.match(summaryHandler, /const UserType = user\.UserType\.toUpperCase\(\)/);
  assert.doesNotMatch(summaryHandler, /req\.(query|body).*UserType/);
  assert.doesNotMatch(summaryHandler, /STATUS_CODES\.FORBIDDEN/);
});

test("HOD Approved list uses the completed configured flow", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "1" }] }
      : { rows: [] };
  };

  try {
    const response = await CapexService.getAllCapex({
      OrganizationID: 20,
      UserType: "HOD",
      Status: "Approved",
      page: 1,
      PageSize: 10,
    });

    assert.equal(response.success, true);
    assert.equal(response.TotalCount, 1);
    assert.equal(calls.length, 2);

    for (const call of calls) {
      const statusFilter = call.sql.slice(call.sql.lastIndexOf("AND cm.OrganizationID"));
      assert.match(statusFilter, /approval_state\.FinalStatus/);
      assert.doesNotMatch(statusFilter, /approval_state\.OwnerStatus/);
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("CEO CAPEX list and count require GM approval for every status view", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    for (const Status of [null, "Pending", "Approved", "Rejected", "Hold", "Returned"]) {
      const response = await CapexService.getAllCapex({
        OrganizationID: 20,
        UserType: "CEO",
        Status,
        page: 1,
        PageSize: 10,
      });
      assert.equal(response.success, true);
    }

    assert.equal(calls.length, 12);
    for (const call of calls) {
      assert.match(
        call.sql,
        /UPPER\(COALESCE\(approval_state\.GMStatus, 'PENDING'\)\) = 'APPROVED'/,
      );
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("CAPEX list PDF reuses getAllCapex configured-flow visibility", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    const response = await CapexService.generateCapexListPdf({
      OrganizationID: 20,
      UserType: "HOD",
      Status: "Approved",
    });

    assert.equal(response.success, true);
    assert.equal(Buffer.isBuffer(response.data), true);
    assert.equal(response.data.subarray(0, 4).toString(), "%PDF");

    const executedCapexQueries = calls.filter((call) =>
      /FROM Capex_Master cm/.test(call.sql),
    );
    assert.equal(executedCapexQueries.length, 2);
    for (const call of executedCapexQueries) {
      assert.match(call.sql, /approval_state\.FinalStatus/);
      assert.match(
        call.sql,
        /COALESCE\(\s*approval_state\.FinalStatus,\s*'PENDING'\s*\)\s*\) = 'APPROVED'/,
      );
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("GM CAPEX filter applies CEO Rejected without also requiring GM Rejected", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("SELECT COUNT(*) AS TotalCount")) {
      return { rows: [{ totalcount: "0" }] };
    }
    return { rows: [] };
  };

  try {
    const filters = {
      OrganizationID: 20,
      UserType: "GM",
      ApprovalFlow: " ceo ",
      Status: "Rejected",
      page: 1,
      PageSize: 10,
    };

    const list = await CapexService.getAllCapex(filters);
    const pdf = await CapexService.generateCapexListPdf(filters);

    assert.equal(list.success, true);
    assert.equal(list.TotalCount, 0);
    assert.equal(pdf.success, true);
    assert.equal(pdf.data.subarray(0, 4).toString(), "%PDF");

    const capexQueries = calls.filter((call) =>
      /FROM Capex_Master cm/.test(call.sql),
    );
    assert.equal(capexQueries.length, 4);

    for (const call of capexQueries) {
      assert.ok(call.values.includes("CEO"));
      assert.ok(call.values.includes("REJECTED"));
      const appliedFilters = call.sql.slice(
        call.sql.lastIndexOf("AND cm.OrganizationID"),
      );
      assert.match(
        appliedFilters,
        /FROM Capex_Approval_Config flow_cfg[\s\S]*flow_cfg\.ApprovalRole/,
      );
      assert.match(
        appliedFilters,
        /UPPER\(TRIM\(COALESCE\(approval_state\.CEOStatus, 'PENDING'\)\)\)[\s\S]*= \$\d+/,
      );
      assert.doesNotMatch(
        appliedFilters,
        /COALESCE\(current_stage\.ApprovalRole, ''\)/,
      );
      assert.doesNotMatch(
        appliedFilters,
        /COALESCE\(\s*approval_state\.GMStatus,[\s\S]*?= \$\d+/,
      );
    }

    const invalid = await CapexService.getAllCapex({
      ...filters,
      ApprovalFlow: "FC",
    });
    assert.equal(invalid.success, false);
    assert.equal(invalid.statusCode, 400);
  } finally {
    pool.query = originalQuery;
  }
});

test("CAPEX list returns CanApprove and creator-or-HOD/GM CanAction flags", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const masterRows = [
    {
      capexid: 101,
      organizationid: 20,
      organizationshortname: "HJU",
      capexnumber: 1,
      department: "Engineering",
      item: "Creator item",
      description: "Creator-owned CAPEX",
      make: "Demo",
      qty: 1,
      rate: 100,
      total: 100,
      isvoid: false,
      voidremarks: null,
      createdby: 77,
      createddate: "2026-09-01",
      currentapprovalrole: "GM",
      currentstatus: "Pending",
    },
    {
      capexid: 102,
      organizationid: 20,
      organizationshortname: "HJU",
      capexnumber: 2,
      department: "Finance",
      item: "CEO item",
      description: "Awaiting CEO",
      make: "Demo",
      qty: 1,
      rate: 200,
      total: 200,
      isvoid: false,
      voidremarks: null,
      createdby: 88,
      createddate: "2026-09-02",
      currentapprovalrole: "CEO",
      currentstatus: "Pending",
    },
  ];

  pool.query = async (sql) => {
    if (sql.includes("SELECT COUNT(*) AS TotalCount")) {
      return { rows: [{ totalcount: "2" }] };
    }
    if (/FROM Capex_Master cm/.test(sql)) return { rows: masterRows };
    return { rows: [] };
  };

  try {
    const ceo = await CapexService.getAllCapex({
      OrganizationID: 20,
      UserID: 77,
      UserType: "CEO",
      page: 1,
      PageSize: 10,
    });

    assert.equal(ceo.success, true);
    assert.equal(ceo.data[0].CanApprove, false);
    assert.equal(ceo.data[0].CanAction, true);
    assert.equal(ceo.data[1].CanApprove, true);
    assert.equal(ceo.data[1].CanAction, false);
    assert.equal(Object.hasOwn(ceo.data[0], "CreatedBy"), false);

    const hod = await CapexService.getAllCapex({
      OrganizationID: 20,
      UserID: 999,
      UserType: "HOD",
      page: 1,
      PageSize: 10,
    });
    assert.equal(hod.data.every((row) => row.CanAction === true), true);
    assert.equal(hod.data.every((row) => row.CanApprove === false), true);
  } finally {
    pool.query = originalQuery;
  }
});

test("CAPEX organization API and PDF include Hold count", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql) => {
    calls.push(sql);
    return {
      rows: [
        {
          organizationid: "20",
          shortname: "HJU",
          count: "6",
          totalamount: "1000",
          approvedcount: "1",
          pendingcount: "1",
          rejectedcount: "1",
          holdcount: "2",
          returnedcount: "1",
        },
      ],
    };
  };

  try {
    const report = await CapexService.getCapexOrganizationReport({
      Filters: { OrganizationID: 20 },
    });
    assert.equal(report.success, true);
    assert.equal(report.data[0].HoldCount, 2);

    const pdf = await CapexService.getCapexOrganizationReportPdf({
      Filters: { OrganizationID: 20 },
    });
    assert.equal(pdf.success, true);
    assert.equal(Buffer.isBuffer(pdf.pdfBuffer), true);
    assert.equal(pdf.pdfBuffer.subarray(0, 4).toString(), "%PDF");

    const reportQueries = calls.filter((sql) => /FROM capex_data cm/.test(sql));
    assert.equal(reportQueries.length, 2);
    for (const sql of reportQueries) {
      assert.match(sql, /cm\.Status = 'Hold'[\s\S]*AS HoldCount/);
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("CAPEX department API and PDF include Hold count", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql) => {
    calls.push(sql);
    return {
      rows: [
        {
          department: "Finance",
          count: "6",
          totalamount: "1000",
          approvedcount: "1",
          pendingcount: "1",
          rejectedcount: "1",
          holdcount: "2",
          returnedcount: "1",
        },
      ],
    };
  };

  try {
    const report = await CapexService.getCapexDepartmentReport({
      Filters: { OrganizationID: 20, Department: "Finance" },
    });
    assert.equal(report.success, true);
    assert.equal(report.data[0].HoldCount, 2);

    const pdf = await CapexService.getCapexDepartmentReportPdf({
      Filters: { OrganizationID: 20, Department: "Finance" },
    });
    assert.equal(pdf.success, true);
    assert.equal(Buffer.isBuffer(pdf.pdfBuffer), true);
    assert.equal(pdf.pdfBuffer.subarray(0, 4).toString(), "%PDF");

    const reportQueries = calls.filter((sql) => /FROM capex_data/.test(sql));
    assert.equal(reportQueries.length, 2);
    for (const sql of reportQueries) {
      assert.match(sql, /Status = 'Hold'[\s\S]*AS HoldCount/);
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("non-approval CAPEX list applies every requested status to rows and count", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    const statuses = ["Approved", "Rejected", "Hold", "Returned", "Pending", null];
    for (const Status of statuses) {
      const response = await CapexService.getAllCapex({
        OrganizationID: 20,
        UserType: "User",
        Status,
        page: 1,
        PageSize: 10,
      });
      assert.equal(response.success, true);
    }

    const capexQueries = calls.filter((call) => /FROM Capex_Master cm/.test(call.sql));
    assert.equal(capexQueries.length, statuses.length * 2);

    for (let index = 0; index < statuses.length; index += 1) {
      const pair = capexQueries.slice(index * 2, index * 2 + 2);
      const status = statuses[index];
      for (const call of pair) {
        const appliedFilters = call.sql.slice(call.sql.lastIndexOf("AND cm.OrganizationID"));
        if (status === "Approved") {
          assert.match(appliedFilters, /approval_state\.FinalStatus[\s\S]*= \$\d+/);
        } else if (["Rejected", "Hold", "Returned"].includes(status)) {
          assert.match(appliedFilters, /approval_state\.GMStatus/);
          assert.match(appliedFilters, /approval_state\.FinalStatus/);
          assert.ok(call.values.includes(status.toUpperCase()));
        } else if (status === "Pending") {
          assert.match(appliedFilters, /approval_state\.FinalStatus[\s\S]*= 'PENDING'/);
          assert.match(appliedFilters, /NOT IN \('REJECTED', 'HOLD', 'RETURNED'\)/);
        } else {
          assert.doesNotMatch(appliedFilters, /UPPER\(TRIM\(COALESCE/);
        }
      }
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("non-approval CAPEX PDF reuses the corrected status visibility", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    const response = await CapexService.generateCapexListPdf({
      OrganizationID: 20,
      UserType: "User",
      Status: "Approved",
    });

    assert.equal(response.success, true);
    assert.equal(response.data.subarray(0, 4).toString(), "%PDF");

    const capexQueries = calls.filter((call) => /FROM Capex_Master cm/.test(call.sql));
    assert.equal(capexQueries.length, 2);
    for (const call of capexQueries) {
      const appliedFilters = call.sql.slice(call.sql.lastIndexOf("AND cm.OrganizationID"));
      assert.match(appliedFilters, /approval_state\.FinalStatus[\s\S]*= \$\d+/);
      assert.ok(call.values.includes("APPROVED"));
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("CAPEX update preserves existing documents and inserts only new uploads", { concurrency: false }, async () => {
  const originalConnect = pool.connect;
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/UPDATE Capex_Master/.test(sql)) {
        return { rows: [{ capexid: 21, capexnumber: 11 }] };
      }
      if (/FROM Capex_Documents[\s\S]*FOR UPDATE/.test(sql)) {
        return {
          rows: [
            { capexdocumentid: 17, filepath: "old-17.png" },
            { capexdocumentid: 18, filepath: "old-18.pdf" },
          ],
        };
      }
      if (/MAX\(CapexDocumentID\)/.test(sql)) {
        return { rows: [{ nextid: "19" }] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  pool.connect = async () => client;

  try {
    const response = await CapexService.updateCapex({
      CapexID: 21,
      UserID: 8,
      Changes: { Item: "Updated item" },
      Documents: [
        {
          FileName: "new.xlsx",
          FilePath: "new-19.xlsx",
          FileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          FileSize: 100,
        },
      ],
      DeleteDocumentIDs: [],
    });

    assert.equal(response.success, true);
    assert.equal(
      calls.some((call) => /INSERT INTO Capex_Documents/.test(call.sql)),
      true,
    );
    assert.equal(
      calls.some((call) => /UPDATE Capex_Documents/.test(call.sql)),
      false,
    );
    assert.equal(calls.some((call) => call.sql === "COMMIT"), true);

    calls.length = 0;
    const noDocumentChanges = await CapexService.updateCapex({
      CapexID: 21,
      UserID: 8,
      Changes: { Description: "Text only update" },
      Documents: [],
      DeleteDocumentIDs: [],
    });
    assert.equal(noDocumentChanges.success, true);
    assert.equal(
      calls.some((call) => /FROM Capex_Documents|UPDATE Capex_Documents/.test(call.sql)),
      false,
    );
  } finally {
    pool.connect = originalConnect;
  }
});

test("CAPEX update deletes only requested owned document IDs", { concurrency: false }, async () => {
  const originalConnect = pool.connect;
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/UPDATE Capex_Master/.test(sql)) {
        return { rows: [{ capexid: 21, capexnumber: 11 }] };
      }
      if (/FROM Capex_Documents[\s\S]*FOR UPDATE/.test(sql)) {
        return { rows: [{ capexdocumentid: 17, filepath: "old-17.png" }] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  pool.connect = async () => client;

  try {
    const deleted = await CapexService.updateCapex({
      CapexID: 21,
      UserID: 8,
      Changes: { Item: "Updated item" },
      Documents: [],
      DeleteDocumentIDs: [17],
    });
    assert.equal(deleted.success, true);
    const deleteCall = calls.find((call) => /UPDATE Capex_Documents/.test(call.sql));
    assert.deepEqual(deleteCall.values, [8, 21, [17]]);

    calls.length = 0;
    const invalid = await CapexService.updateCapex({
      CapexID: 21,
      UserID: 8,
      Changes: { Item: "Updated again" },
      Documents: [],
      DeleteDocumentIDs: [999],
    });
    assert.equal(invalid.success, false);
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.message, /selected for deletion are invalid/);
    assert.equal(calls.some((call) => call.sql === "ROLLBACK"), true);
  } finally {
    pool.connect = originalConnect;
  }
});
