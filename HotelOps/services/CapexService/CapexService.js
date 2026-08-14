const { pool } = require("../../db");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");
const { deleteDocuments } = require("../../AzurConfigration/CAPEX/AzureDocuments");
const generateDocumentUrl = require("../../AzurConfigration/ITAdmin/UserMaster/AzureGetData");

const DEFAULT_APPROVALS = Object.freeze([
  { LevelNo: 1, ApprovalRole: "GM" },
  { LevelNo: 2, ApprovalRole: "CEO" },
  { LevelNo: 3, ApprovalRole: "OWNER" },
]);
const APPROVAL_ROLES = new Set(["GM", "CEO", "OWNER"]);

const fail = (message, statusCode = 400) => ({
  success: false,
  statusCode,
  message,
});

const mergeApprovalConfiguration = (configuredRows) => {
  const approvals = new Map(
    DEFAULT_APPROVALS.map((approval) => [approval.LevelNo, approval])
  );

  for (const row of configuredRows) {
    const levelNo = Number(row.levelno);
    const approvalRole = String(row.approvalrole || "").trim();

    if (Number.isSafeInteger(levelNo) && levelNo > 0 && approvalRole) {
      approvals.set(levelNo, {
        LevelNo: levelNo,
        ApprovalRole: approvalRole,
      });
    }
  }

  return [...approvals.values()].sort((left, right) => left.LevelNo - right.LevelNo);
};

const approvalConfigurationIsValid = (approvals) => approvals.length > 0
  && approvals.every((approval) => APPROVAL_ROLES.has(
    String(approval.ApprovalRole || "").trim().toUpperCase()
  ));

const rollback = async (client, transactionStarted) => {
  if (!client || !transactionStarted) return;

  try {
    await client.query("ROLLBACK");
  } catch (error) {
    console.error("CAPEX Rollback Error:", error.message);
  }
};

const cleanupAndFail = async (client, transactionStarted, documents, response) => {
  await rollback(client, transactionStarted);
  await deleteDocuments(documents);
  return response;
};

const createCapex = async (data) => {
  let client;
  let transactionStarted = false;
  const documents = Array.isArray(data.Documents) ? data.Documents : [];

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const accessResult = await client.query(
      `
      SELECT 1
      FROM user_org_mapping uom
      INNER JOIN user_master um ON um.UserID = uom.UserID
      INNER JOIN Organization_Master om
        ON om.OrganizationID = uom.OrganizationID
      WHERE uom.UserID = $1
        AND uom.OrganizationID = $2
        AND uom.IsActive = TRUE
        AND uom.IsDeleted = FALSE
        AND um.IsActive = TRUE
        AND um.IsDeleted = FALSE
        AND COALESCE(um.IsLocked, FALSE) = FALSE
        AND om.IsActive = TRUE
        AND om.IsDeleted = FALSE
        AND om.ActivationStatus = TRUE
      LIMIT 1;
      `,
      [data.UserID, data.OrganizationID]
    );

    if (accessResult.rows.length === 0) {
      return await cleanupAndFail(
        client,
        transactionStarted,
        documents,
        fail("You are not authorized to create CAPEX for this organization.", 403)
      );
    }

    const sequenceResult = await client.query(
      `
      INSERT INTO Capex_Organization_Sequence
      (
        OrganizationID,
        LastCapexNumber
      )
      VALUES ($1, 1)
      ON CONFLICT (OrganizationID)
      DO UPDATE SET
        LastCapexNumber = Capex_Organization_Sequence.LastCapexNumber + 1
      RETURNING LastCapexNumber;
      `,
      [data.OrganizationID]
    );

    const capexNumber = Number(sequenceResult.rows[0].lastcapexnumber);

    const masterResult = await client.query(
      `
      INSERT INTO Capex_Master
      (
        OrganizationID,
        CapexNumber,
        Department,
        Item,
        Description,
        Make,
        Qty,
        Rate,
        Total,
        IsVoid,
        IsDeleted,
        CreatedBy,
        CreatedDate
      )
      VALUES
      (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $7::numeric * $8::numeric,
        FALSE, FALSE, $9, CURRENT_TIMESTAMP
      )
      RETURNING CapexID, Total;
      `,
      [
        data.OrganizationID,
        capexNumber,
        data.Department,
        data.Item,
        data.Description,
        data.Make,
        data.Qty,
        data.Rate,
        data.CreatedBy,
      ]
    );

    const capexID = Number(masterResult.rows[0].capexid);
    const total = Number(masterResult.rows[0].total);

    for (const document of documents) {
      await client.query(
        `
        INSERT INTO Capex_Documents
        (
          CapexID,
          CapexNumber,
          FileName,
          FilePath,
          FileType,
          FileSize,
          IsDeleted,
          CreatedBy,
          CreatedDate
        )
        VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, CURRENT_TIMESTAMP);
        `,
        [
          capexID,
          capexNumber,
          document.FileName,
          document.FilePath,
          document.FileType,
          document.FileSize,
          data.CreatedBy,
        ]
      );
    }

    const approvalConfigResult = await client.query(
      `
      SELECT LevelNo, ApprovalRole
      FROM Capex_Approval_Config
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
      ORDER BY LevelNo ASC, CapexApprovalConfigID ASC;
      `,
      [data.OrganizationID]
    );

    const approvals = mergeApprovalConfiguration(approvalConfigResult.rows);

    if (!approvalConfigurationIsValid(approvals)) {
      return await cleanupAndFail(
        client,
        transactionStarted,
        documents,
        fail("CAPEX approval configuration contains an invalid approval role.", 400)
      );
    }

    for (const approval of approvals) {
      await client.query(
        `
        INSERT INTO Capex_Approval
        (
          CapexID,
          LevelNo,
          ApprovalRole,
          Status,
          StatusDateTime,
          IsDeleted,
          CreatedBy,
          CreatedDate
        )
        VALUES ($1, $2, $3, 'Pending', CURRENT_TIMESTAMP, FALSE, $4, CURRENT_TIMESTAMP);
        `,
        [capexID, approval.LevelNo, approval.ApprovalRole, data.CreatedBy]
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "CAPEX created successfully.",
      data: {
        CapexID: capexID,
        CapexNumber: capexNumber,
        Total: total,
        DocumentCount: documents.length,
        Approvals: approvals.map((approval) => ({
          ...approval,
          Status: "Pending",
        })),
      },
    };
  } catch (error) {
    await rollback(client, transactionStarted);

    console.error("Create CAPEX Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    await deleteDocuments(documents);

    if (error.code === "23503") {
      return fail("Invalid CAPEX organization or related data.", 400);
    }

    if (error.code === "23505") {
      return fail("A CAPEX record with the same details already exists.", 409);
    }

    return fail("Unable to create CAPEX at this time.", 500);
  } finally {
    if (client) client.release();
  }
};

const CAPEX_SELECT = `
  SELECT
    cm.CapexID,
    cm.OrganizationID,
    cm.CapexNumber,
    cm.Department,
    cm.Item,
    cm.Description,
    cm.Make,
    cm.Qty,
    cm.Rate,
    cm.Total,
    cm.IsVoid,
    cm.VoidRemarks,
    cm.CreatedBy,
    cm.CreatedDate,
    cm.ModifiedBy,
    cm.ModifiedDate,
    current_stage.ApprovalRole AS CurrentApprovalRole,
    COALESCE(
      current_stage.Status,
      CASE
        WHEN EXISTS
        (
          SELECT 1
          FROM Capex_Approval completed_stage
          WHERE completed_stage.CapexID = cm.CapexID
            AND completed_stage.IsDeleted = FALSE
        ) THEN 'Approved'
        ELSE 'Pending'
      END
    ) AS CurrentStatus
  FROM Capex_Master cm
  INNER JOIN user_org_mapping uom
    ON uom.OrganizationID = cm.OrganizationID
   AND uom.UserID = $1
   AND uom.IsActive = TRUE
   AND uom.IsDeleted = FALSE
  INNER JOIN user_master um
    ON um.UserID = uom.UserID
   AND um.IsActive = TRUE
   AND um.IsDeleted = FALSE
   AND COALESCE(um.IsLocked, FALSE) = FALSE
  INNER JOIN Organization_Master om
    ON om.OrganizationID = cm.OrganizationID
   AND om.IsActive = TRUE
   AND om.IsDeleted = FALSE
   AND om.ActivationStatus = TRUE
  LEFT JOIN LATERAL
  (
    SELECT
      ca.ApprovalRole,
      ca.Status,
      ca.LevelNo
    FROM Capex_Approval ca
    WHERE ca.CapexID = cm.CapexID
      AND ca.IsDeleted = FALSE
      AND UPPER(COALESCE(ca.Status, 'PENDING')) <> 'APPROVED'
    ORDER BY ca.LevelNo ASC, ca.CapexApprovalID ASC
    LIMIT 1
  ) current_stage ON TRUE
  WHERE cm.IsDeleted = FALSE
`;

const mapMaster = (row) => ({
  CapexID: Number(row.capexid),
  OrganizationID: Number(row.organizationid),
  CapexNumber: Number(row.capexnumber),
  Department: row.department,
  Item: row.item,
  Description: row.description,
  Make: row.make,
  Qty: Number(row.qty),
  Rate: Number(row.rate),
  Total: Number(row.total),
  IsVoid: row.isvoid,
  VoidRemarks: row.voidremarks,
  CreatedBy: row.createdby == null ? null : Number(row.createdby),
  CreatedDate: row.createddate,
  ModifiedBy: row.modifiedby == null ? null : Number(row.modifiedby),
  ModifiedDate: row.modifieddate,
  CurrentApprovalRole: row.currentapprovalrole || null,
  CurrentStatus: row.currentstatus,
  Documents: [],
  Approvals: [],
});

const mapDocument = (row) => ({
  CapexDocumentID: Number(row.capexdocumentid),
  CapexID: Number(row.capexid),
  CapexNumber: Number(row.capexnumber),
  FileName: row.filename,
  FilePath: row.filepath ? generateDocumentUrl(row.filepath) : null,
  FileType: row.filetype,
  FileSize: row.filesize == null ? null : Number(row.filesize),
});

const mapApproval = (row) => ({
  CapexApprovalID: Number(row.capexapprovalid),
  LevelNo: Number(row.levelno),
  ApprovalRole: row.approvalrole,
  Status: row.status,
  StatusDateTime: row.statusdatetime,
  StatusApprovedBy: row.statusapprovedby == null
    ? null
    : Number(row.statusapprovedby),
  Remarks: row.remarks,
});

const attachRelatedData = async (capexRows) => {
  if (capexRows.length === 0) return [];

  const capexIDs = capexRows.map((row) => Number(row.capexid));
  const [documentsResult, approvalsResult] = await Promise.all([
    pool.query(
      `
      SELECT
        CapexDocumentID,
        CapexID,
        CapexNumber,
        FileName,
        FilePath,
        FileType,
        FileSize
      FROM Capex_Documents
      WHERE CapexID = ANY($1::bigint[])
        AND IsDeleted = FALSE
      ORDER BY CapexID ASC, CapexDocumentID ASC;
      `,
      [capexIDs]
    ),
    pool.query(
      `
      SELECT
        CapexApprovalID,
        CapexID,
        LevelNo,
        ApprovalRole,
        Status,
        StatusDateTime,
        StatusApprovedBy,
        Remarks
      FROM Capex_Approval
      WHERE CapexID = ANY($1::bigint[])
        AND IsDeleted = FALSE
      ORDER BY CapexID ASC, LevelNo ASC, CapexApprovalID ASC;
      `,
      [capexIDs]
    ),
  ]);

  const byID = new Map(
    capexRows.map((row) => {
      const capex = mapMaster(row);
      return [capex.CapexID, capex];
    })
  );

  for (const row of documentsResult.rows) {
    byID.get(Number(row.capexid))?.Documents.push(mapDocument(row));
  }

  for (const row of approvalsResult.rows) {
    byID.get(Number(row.capexid))?.Approvals.push(mapApproval(row));
  }

  return capexRows.map((row) => byID.get(Number(row.capexid)));
};

const getAllCapex = async (data) => {
  try {
    const result = await pool.query(
      `${CAPEX_SELECT}
       AND
       (
         cm.CreatedBy = $1
         OR
         (
           UPPER($2) IN ('GM', 'CEO', 'OWNER')
           AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = UPPER($2)
           AND UPPER(COALESCE(current_stage.Status, '')) IN ('PENDING', 'RETURNED')
         )
       )
       ORDER BY cm.CreatedDate DESC, cm.CapexID DESC;`,
      [data.UserID, data.UserType]
    );

    const capex = await attachRelatedData(result.rows);

    return {
      success: true,
      message: "CAPEX records fetched successfully.",
      Count: capex.length,
      data: capex,
    };
  } catch (error) {
    console.error("Get All CAPEX Error:", error.message);
    return fail("Unable to fetch CAPEX records at this time.", 503);
  }
};

const getCapexById = async (data) => {
  try {
    const result = await pool.query(
      `${CAPEX_SELECT}
       AND cm.CapexID = $3
       AND
       (
         cm.CreatedBy = $1
         OR
         (
           UPPER($2) IN ('GM', 'CEO', 'OWNER')
           AND UPPER(COALESCE(current_stage.ApprovalRole, '')) = UPPER($2)
           AND UPPER(COALESCE(current_stage.Status, '')) IN ('PENDING', 'RETURNED')
         )
       )
       LIMIT 1;`,
      [data.UserID, data.UserType, data.CapexID]
    );

    if (result.rows.length === 0) {
      const existence = await pool.query(
        `
        SELECT 1
        FROM Capex_Master
        WHERE CapexID = $1
          AND IsDeleted = FALSE
        LIMIT 1;
        `,
        [data.CapexID]
      );

      return existence.rows.length === 0
        ? fail("CAPEX record not found.", 404)
        : fail("You are not authorized to view this CAPEX record.", 403);
    }

    const [capex] = await attachRelatedData(result.rows);

    return {
      success: true,
      message: "CAPEX record fetched successfully.",
      data: capex,
    };
  } catch (error) {
    console.error("Get CAPEX By ID Error:", error.message);
    return fail("Unable to fetch CAPEX record at this time.", 503);
  }
};

const getMergedApprovals = async (client, organizationID) => {
  const result = await client.query(
    `
    SELECT LevelNo, ApprovalRole
    FROM Capex_Approval_Config
    WHERE OrganizationID = $1
      AND IsDeleted = FALSE
    ORDER BY LevelNo ASC, CapexApprovalConfigID ASC;
    `,
    [organizationID]
  );

  return mergeApprovalConfiguration(result.rows);
};

const insertApprovalRows = async (client, capexID, approvals, userID) => {
  for (const approval of approvals) {
    await client.query(
      `
      INSERT INTO Capex_Approval
      (
        CapexID,
        LevelNo,
        ApprovalRole,
        Status,
        StatusDateTime,
        IsDeleted,
        CreatedBy,
        CreatedDate
      )
      VALUES ($1, $2, $3, 'Pending', CURRENT_TIMESTAMP, FALSE, $4, CURRENT_TIMESTAMP);
      `,
      [capexID, approval.LevelNo, approval.ApprovalRole, userID]
    );
  }
};

const findMutableCapex = async (client, data) => {
  const result = await client.query(
    `
    SELECT
      cm.CapexID,
      cm.OrganizationID,
      cm.CapexNumber,
      cm.Qty,
      cm.Rate,
      cm.CreatedBy
    FROM Capex_Master cm
    INNER JOIN user_org_mapping uom
      ON uom.OrganizationID = cm.OrganizationID
     AND uom.UserID = $1
     AND uom.IsActive = TRUE
     AND uom.IsDeleted = FALSE
    INNER JOIN user_master um
      ON um.UserID = uom.UserID
     AND um.IsActive = TRUE
     AND um.IsDeleted = FALSE
     AND COALESCE(um.IsLocked, FALSE) = FALSE
    INNER JOIN Organization_Master om
      ON om.OrganizationID = cm.OrganizationID
     AND om.IsActive = TRUE
     AND om.IsDeleted = FALSE
     AND om.ActivationStatus = TRUE
    WHERE cm.CapexID = $2
      AND cm.IsDeleted = FALSE
      AND
      (
        cm.CreatedBy = $1
        OR UPPER($3) = 'SUPERADMIN'
      )
    LIMIT 1
    FOR UPDATE OF cm;
    `,
    [data.UserID, data.CapexID, data.LoginType]
  );

  return result.rows[0] || null;
};

const capexExists = async (client, capexID) => {
  const result = await client.query(
    `SELECT 1 FROM Capex_Master WHERE CapexID = $1 AND IsDeleted = FALSE LIMIT 1;`,
    [capexID]
  );
  return result.rows.length > 0;
};

const validateOrganizationAccess = async (client, userID, organizationID) => {
  const result = await client.query(
    `
    SELECT 1
    FROM user_org_mapping uom
    INNER JOIN user_master um ON um.UserID = uom.UserID
    INNER JOIN Organization_Master om ON om.OrganizationID = uom.OrganizationID
    WHERE uom.UserID = $1
      AND uom.OrganizationID = $2
      AND uom.IsActive = TRUE
      AND uom.IsDeleted = FALSE
      AND um.IsActive = TRUE
      AND um.IsDeleted = FALSE
      AND COALESCE(um.IsLocked, FALSE) = FALSE
      AND om.IsActive = TRUE
      AND om.IsDeleted = FALSE
      AND om.ActivationStatus = TRUE
    LIMIT 1;
    `,
    [userID, organizationID]
  );
  return result.rows.length > 0;
};

const nextCapexNumber = async (client, organizationID) => {
  const result = await client.query(
    `
    INSERT INTO Capex_Organization_Sequence (OrganizationID, LastCapexNumber)
    VALUES ($1, 1)
    ON CONFLICT (OrganizationID)
    DO UPDATE SET
      LastCapexNumber = Capex_Organization_Sequence.LastCapexNumber + 1
    RETURNING LastCapexNumber;
    `,
    [organizationID]
  );
  return Number(result.rows[0].lastcapexnumber);
};

const updateCapex = async (data) => {
  let client;
  let transactionStarted = false;
  const documents = Array.isArray(data.Documents) ? data.Documents : [];

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const current = await findMutableCapex(client, data);
    if (!current) {
      const exists = await capexExists(client, data.CapexID);
      return await cleanupAndFail(
        client,
        transactionStarted,
        documents,
        exists
          ? fail("You are not authorized to update this CAPEX record.", 403)
          : fail("CAPEX record not found.", 404)
      );
    }

    const approvalState = await client.query(
      `
      SELECT
        COUNT(*)::integer AS ApprovalCount,
        BOOL_AND(UPPER(COALESCE(Status, '')) = 'APPROVED') AS IsFinalApproved
      FROM Capex_Approval
      WHERE CapexID = $1
        AND IsDeleted = FALSE;
      `,
      [data.CapexID]
    );

    const state = approvalState.rows[0];
    if (Number(state.approvalcount) > 0 && state.isfinalapproved === true) {
      return await cleanupAndFail(
        client,
        transactionStarted,
        documents,
        fail("A fully approved CAPEX record cannot be updated.", 400)
      );
    }

    const changes = data.Changes || {};
    let organizationID = Number(current.organizationid);
    let capexNumber = Number(current.capexnumber);
    const organizationChanged = changes.OrganizationID !== undefined
      && Number(changes.OrganizationID) !== organizationID;

    if (organizationChanged) {
      const hasAccess = await validateOrganizationAccess(
        client,
        data.UserID,
        changes.OrganizationID
      );
      if (!hasAccess) {
        return await cleanupAndFail(
          client,
          transactionStarted,
          documents,
          fail("You are not authorized to use the selected organization.", 403)
        );
      }

      organizationID = Number(changes.OrganizationID);
      capexNumber = await nextCapexNumber(client, organizationID);
    }

    const assignments = [];
    const values = [];
    const addValue = (column, value) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (changes.OrganizationID !== undefined) addValue("OrganizationID", organizationID);
    if (organizationChanged) addValue("CapexNumber", capexNumber);
    if (changes.Department !== undefined) addValue("Department", changes.Department);
    if (changes.Item !== undefined) addValue("Item", changes.Item);
    if (changes.Description !== undefined) addValue("Description", changes.Description);
    if (changes.Make !== undefined) addValue("Make", changes.Make);
    if (changes.Qty !== undefined) addValue("Qty", changes.Qty);
    if (changes.Rate !== undefined) addValue("Rate", changes.Rate);
    if (changes.IsVoid !== undefined) addValue("IsVoid", changes.IsVoid);
    if (changes.VoidRemarks !== undefined) addValue("VoidRemarks", changes.VoidRemarks);

    if (changes.Qty !== undefined || changes.Rate !== undefined) {
      const effectiveQty = changes.Qty ?? current.qty;
      const effectiveRate = changes.Rate ?? current.rate;
      values.push(effectiveQty, effectiveRate);
      assignments.push(`Total = $${values.length - 1}::numeric * $${values.length}::numeric`);
    }

    values.push(data.UserID);
    assignments.push(`ModifiedBy = $${values.length}`);
    assignments.push("ModifiedDate = CURRENT_TIMESTAMP");
    values.push(data.CapexID);

    const updateResult = await client.query(
      `
      UPDATE Capex_Master
      SET ${assignments.join(", ")}
      WHERE CapexID = $${values.length}
        AND IsDeleted = FALSE
      RETURNING CapexID, OrganizationID, CapexNumber, Total;
      `,
      values
    );

    if (organizationChanged) {
      await client.query(
        `
        UPDATE Capex_Documents
        SET CapexNumber = $1, ModifiedBy = $2, ModifiedDate = CURRENT_TIMESTAMP
        WHERE CapexID = $3 AND IsDeleted = FALSE;
        `,
        [capexNumber, data.UserID, data.CapexID]
      );

      await client.query(
        `
        UPDATE Capex_Approval
        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE CapexID = $2 AND IsDeleted = FALSE;
        `,
        [data.UserID, data.CapexID]
      );

      const approvals = await getMergedApprovals(client, organizationID);
      if (!approvalConfigurationIsValid(approvals)) {
        return await cleanupAndFail(
          client,
          transactionStarted,
          documents,
          fail("CAPEX approval configuration contains an invalid approval role.", 400)
        );
      }
      await insertApprovalRows(client, data.CapexID, approvals, data.UserID);
    }

    for (const document of documents) {
      await client.query(
        `
        INSERT INTO Capex_Documents
        (
          CapexID, CapexNumber, FileName, FilePath, FileType, FileSize,
          IsDeleted, CreatedBy, CreatedDate
        )
        VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, CURRENT_TIMESTAMP);
        `,
        [
          data.CapexID,
          capexNumber,
          document.FileName,
          document.FilePath,
          document.FileType,
          document.FileSize,
          data.UserID,
        ]
      );
    }

    const deleteDocumentIDs = Array.isArray(data.DeleteDocumentIDs)
      ? data.DeleteDocumentIDs
      : [];
    if (deleteDocumentIDs.length > 0) {
      const ownedDocuments = await client.query(
        `
        SELECT CapexDocumentID
        FROM Capex_Documents
        WHERE CapexID = $1
          AND CapexDocumentID = ANY($2::bigint[])
          AND IsDeleted = FALSE;
        `,
        [data.CapexID, deleteDocumentIDs]
      );

      if (ownedDocuments.rows.length !== deleteDocumentIDs.length) {
        return await cleanupAndFail(
          client,
          transactionStarted,
          documents,
          fail("One or more selected CAPEX documents are invalid.", 400)
        );
      }

      await client.query(
        `
        UPDATE Capex_Documents
        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE CapexID = $2
          AND CapexDocumentID = ANY($3::bigint[])
          AND IsDeleted = FALSE;
        `,
        [data.UserID, data.CapexID, deleteDocumentIDs]
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    const updated = updateResult.rows[0];
    return {
      success: true,
      message: "CAPEX updated successfully.",
      data: {
        CapexID: Number(updated.capexid),
        OrganizationID: Number(updated.organizationid),
        CapexNumber: Number(updated.capexnumber),
        Total: Number(updated.total),
        DocumentsAdded: documents.length,
        DocumentsDeleted: deleteDocumentIDs.length,
      },
    };
  } catch (error) {
    await rollback(client, transactionStarted);
    console.error("Update CAPEX Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    await deleteDocuments(documents);

    if (error.code === "23503") return fail("Invalid CAPEX related data.", 400);
    if (error.code === "23505") return fail("CAPEX organization number already exists.", 409);
    return fail("Unable to update CAPEX at this time.", 500);
  } finally {
    if (client) client.release();
  }
};

const deleteCapex = async (data) => {
  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const current = await findMutableCapex(client, data);
    if (!current) {
      const exists = await capexExists(client, data.CapexID);
      await rollback(client, transactionStarted);
      return exists
        ? fail("You are not authorized to delete this CAPEX record.", 403)
        : fail("CAPEX record not found.", 404);
    }

    await client.query(
      `
      UPDATE Capex_Master
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CapexID = $2 AND IsDeleted = FALSE;
      `,
      [data.UserID, data.CapexID]
    );

    await client.query(
      `
      UPDATE Capex_Documents
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CapexID = $2 AND IsDeleted = FALSE;
      `,
      [data.UserID, data.CapexID]
    );

    await client.query(
      `
      UPDATE Capex_Approval
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CapexID = $2 AND IsDeleted = FALSE;
      `,
      [data.UserID, data.CapexID]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "CAPEX deleted successfully.",
    };
  } catch (error) {
    await rollback(client, transactionStarted);
    console.error("Delete CAPEX Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return fail("Unable to delete CAPEX at this time.", 500);
  } finally {
    if (client) client.release();
  }
};

const processCapexApproval = async (data) => {
  let client;
  let transactionStarted = false;

  try {
    const approverRole = String(data.UserType || "").trim().toUpperCase();
    if (!["APPROVE", "REJECT", "RETURN"].includes(data.Action)) {
      return fail("Invalid CAPEX approval action.", 400);
    }

    if (["REJECT", "RETURN"].includes(data.Action) && !String(data.Remarks || "").trim()) {
      return fail(`Remarks are required when the action is ${data.Action}.`, 400);
    }

    if (!APPROVAL_ROLES.has(approverRole)) {
      return fail("Your user role is not authorized for CAPEX approval.", 403);
    }

    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const masterResult = await client.query(
      `
      SELECT
        cm.CapexID,
        cm.CapexNumber,
        cm.OrganizationID,
        cm.IsVoid,
        cm.ModifiedDate
      FROM Capex_Master cm
      INNER JOIN user_org_mapping uom
        ON uom.OrganizationID = cm.OrganizationID
       AND uom.UserID = $1
       AND uom.IsActive = TRUE
       AND uom.IsDeleted = FALSE
      INNER JOIN user_master um
        ON um.UserID = uom.UserID
       AND um.IsActive = TRUE
       AND um.IsDeleted = FALSE
       AND COALESCE(um.IsLocked, FALSE) = FALSE
      INNER JOIN Organization_Master om
        ON om.OrganizationID = cm.OrganizationID
       AND om.IsActive = TRUE
       AND om.IsDeleted = FALSE
       AND om.ActivationStatus = TRUE
      WHERE cm.CapexID = $2
        AND cm.IsDeleted = FALSE
      LIMIT 1
      FOR UPDATE OF cm;
      `,
      [data.UserID, data.CapexID]
    );

    if (masterResult.rows.length === 0) {
      const exists = await capexExists(client, data.CapexID);
      await rollback(client, transactionStarted);
      return exists
        ? fail("You are not authorized to approve this CAPEX record.", 403)
        : fail("CAPEX record not found.", 404);
    }

    const capex = masterResult.rows[0];
    if (capex.isvoid === true) {
      await rollback(client, transactionStarted);
      return fail("A void CAPEX record cannot be approved.", 400);
    }

    const configuredStages = await getMergedApprovals(
      client,
      Number(capex.organizationid)
    );

    if (!approvalConfigurationIsValid(configuredStages)) {
      await rollback(client, transactionStarted);
      return fail("CAPEX approval configuration contains an invalid approval role.", 400);
    }

    const approvalsResult = await client.query(
      `
      SELECT
        CapexApprovalID,
        LevelNo,
        ApprovalRole,
        Status,
        StatusDateTime
      FROM Capex_Approval
      WHERE CapexID = $1
        AND IsDeleted = FALSE
      ORDER BY LevelNo ASC, CapexApprovalID ASC
      FOR UPDATE;
      `,
      [data.CapexID]
    );

    const approvalsByLevel = new Map(
      approvalsResult.rows.map((approval) => [Number(approval.levelno), approval])
    );
    const stages = configuredStages.map((configured) => ({
      configured,
      approval: approvalsByLevel.get(Number(configured.LevelNo)),
    }));

    if (stages.some(({ configured, approval }) => (
      !approval
      || String(approval.approvalrole).trim().toUpperCase()
        !== String(configured.ApprovalRole).trim().toUpperCase()
    ))) {
      await rollback(client, transactionStarted);
      return fail("CAPEX approval records do not match the active approval configuration.", 400);
    }

    if (stages.some(({ approval }) => String(approval.status).toUpperCase() === "REJECTED")) {
      await rollback(client, transactionStarted);
      return fail("This CAPEX record has already been rejected.", 400);
    }

    const currentIndex = stages.findIndex(
      ({ approval }) => String(approval.status || "PENDING").toUpperCase() !== "APPROVED"
    );

    if (currentIndex === -1) {
      await rollback(client, transactionStarted);
      return fail("This CAPEX record is already finally approved.", 400);
    }

    const current = stages[currentIndex].approval;
    const currentRole = String(current.approvalrole).trim().toUpperCase();
    const currentStatus = String(current.status || "PENDING").trim().toUpperCase();

    if (currentRole !== approverRole) {
      await rollback(client, transactionStarted);
      return fail(
        `Only the current ${currentRole} approval stage can perform this action.`,
        403
      );
    }

    if (!["PENDING", "RETURNED"].includes(currentStatus)) {
      await rollback(client, transactionStarted);
      return fail("The current CAPEX approval stage cannot be actioned again.", 400);
    }

    if (currentIndex === 0 && currentStatus === "RETURNED") {
      const returnedOn = current.statusdatetime
        ? new Date(current.statusdatetime).getTime()
        : 0;
      const correctedOn = capex.modifieddate
        ? new Date(capex.modifieddate).getTime()
        : 0;

      if (correctedOn <= returnedOn) {
        await rollback(client, transactionStarted);
        return fail("The creator must correct the CAPEX before GM can action it again.", 400);
      }
    }

    await client.query(
      `
      UPDATE Capex_Approval
      SET
        Status = $1,
        StatusDateTime = CURRENT_TIMESTAMP,
        StatusApprovedBy = $2,
        Remarks = $3,
        ModifiedBy = $2,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE CapexApprovalID = $4
        AND IsDeleted = FALSE;
      `,
      [data.Action === "APPROVE" ? "Approved" : data.Action === "REJECT" ? "Rejected" : "Returned",
        data.UserID,
        data.Remarks,
        current.capexapprovalid]
    );

    let responseStatus;
    let responseRole;

    if (data.Action === "APPROVE") {
      const nextStage = stages[currentIndex + 1];
      if (nextStage) {
        responseRole = String(nextStage.approval.approvalrole).trim();
        responseStatus = String(nextStage.approval.status || "Pending");
      } else {
        responseRole = null;
        responseStatus = "Approved";
      }
    } else if (data.Action === "REJECT") {
      responseRole = null;
      responseStatus = "Rejected";
    } else {
      const previousStage = stages[currentIndex - 1];
      if (previousStage) {
        await client.query(
          `
          UPDATE Capex_Approval
          SET
            Status = 'Pending',
            StatusDateTime = CURRENT_TIMESTAMP,
            StatusApprovedBy = NULL,
            Remarks = NULL,
            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP
          WHERE CapexApprovalID = $2
            AND IsDeleted = FALSE;
          `,
          [data.UserID, previousStage.approval.capexapprovalid]
        );
        responseRole = String(previousStage.approval.approvalrole).trim();
        responseStatus = "Pending";
      } else {
        responseRole = null;
        responseStatus = "Returned";
      }
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: `CAPEX ${data.Action.toLowerCase()} action completed successfully.`,
      data: {
        CapexID: Number(capex.capexid),
        CapexNumber: Number(capex.capexnumber),
        CurrentStatus: responseStatus,
        CurrentApprovalRole: responseRole,
        Action: data.Action,
      },
    };
  } catch (error) {
    await rollback(client, transactionStarted);
    console.error("CAPEX Approval Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return fail("Unable to process CAPEX approval at this time.", 500);
  } finally {
    if (client) client.release();
  }
};

const REPORT_DATA_CTE = `
  WITH capex_data AS
  (
    SELECT
      cm.CapexID,
      cm.OrganizationID,
      cm.Department,
      COALESCE(cm.Total, 0)::numeric AS Total,
      CASE
        WHEN cm.IsVoid = TRUE THEN 'Void'
        WHEN COALESCE(approval_state.HasRejected, FALSE) THEN 'Rejected'
        WHEN COALESCE(approval_state.HasReturned, FALSE) THEN 'Returned'
        WHEN approval_state.ApprovalCount > 0
          AND COALESCE(approval_state.AllApproved, FALSE) THEN 'Approved'
        ELSE 'Pending'
      END AS Status
    FROM Capex_Master cm
    LEFT JOIN LATERAL
    (
      SELECT
        COUNT(*)::integer AS ApprovalCount,
        BOOL_OR(UPPER(COALESCE(ca.Status, '')) = 'REJECTED') AS HasRejected,
        BOOL_OR(UPPER(COALESCE(ca.Status, '')) = 'RETURNED') AS HasReturned,
        BOOL_AND(UPPER(COALESCE(ca.Status, '')) = 'APPROVED') AS AllApproved
      FROM Capex_Approval ca
      WHERE ca.CapexID = cm.CapexID
        AND ca.IsDeleted = FALSE
    ) approval_state ON TRUE
    WHERE cm.IsDeleted = FALSE
      AND EXISTS
      (
        SELECT 1
        FROM user_org_mapping uom
        INNER JOIN user_master um
          ON um.UserID = uom.UserID
         AND um.IsActive = TRUE
         AND um.IsDeleted = FALSE
         AND COALESCE(um.IsLocked, FALSE) = FALSE
        INNER JOIN Organization_Master om
          ON om.OrganizationID = uom.OrganizationID
         AND om.IsActive = TRUE
         AND om.IsDeleted = FALSE
         AND om.ActivationStatus = TRUE
        WHERE uom.UserID = $1
          AND uom.OrganizationID = cm.OrganizationID
          AND uom.IsActive = TRUE
          AND uom.IsDeleted = FALSE
      )
      AND ($2::bigint IS NULL OR cm.OrganizationID = $2)
      AND ($3::text IS NULL OR LOWER(cm.Department) = LOWER($3))
      AND ($5::date IS NULL OR cm.CreatedDate >= $5::date)
      AND ($6::date IS NULL OR cm.CreatedDate < ($6::date + INTERVAL '1 day'))
  ),
  filtered_capex AS
  (
    SELECT *
    FROM capex_data
    WHERE $4::text IS NULL OR UPPER(Status) = UPPER($4)
  )
`;

const reportParameters = (data) => {
  const filters = data.Filters || {};
  return [
    data.UserID,
    filters.OrganizationID ?? null,
    filters.Department ?? null,
    filters.Status ?? null,
    filters.FromDate ?? null,
    filters.ToDate ?? null,
  ];
};

const reportFailure = (error, reportName) => {
  console.error(`${reportName} Error:`, error.message);
  return fail(`Unable to generate ${reportName} at this time.`, 503);
};

const getCapexSummaryReport = async (data) => {
  try {
    const result = await pool.query(
      `${REPORT_DATA_CTE}
       SELECT
         COUNT(*)::bigint AS TotalCapex,
         COALESCE(SUM(Total), 0) AS TotalAmount,
         COUNT(*) FILTER (WHERE Status = 'Pending')::bigint AS PendingCount,
         COALESCE(SUM(Total) FILTER (WHERE Status = 'Pending'), 0) AS PendingAmount,
         COUNT(*) FILTER (WHERE Status = 'Approved')::bigint AS ApprovedCount,
         COALESCE(SUM(Total) FILTER (WHERE Status = 'Approved'), 0) AS ApprovedAmount,
         COUNT(*) FILTER (WHERE Status = 'Rejected')::bigint AS RejectedCount,
         COALESCE(SUM(Total) FILTER (WHERE Status = 'Rejected'), 0) AS RejectedAmount,
         COUNT(*) FILTER (WHERE Status = 'Returned')::bigint AS ReturnedCount,
         COALESCE(SUM(Total) FILTER (WHERE Status = 'Returned'), 0) AS ReturnedAmount,
         COUNT(*) FILTER (WHERE Status = 'Void')::bigint AS VoidCount,
         COALESCE(SUM(Total) FILTER (WHERE Status = 'Void'), 0) AS VoidAmount
       FROM filtered_capex;`,
      reportParameters(data)
    );

    const row = result.rows[0];
    return {
      success: true,
      message: "CAPEX summary report fetched successfully.",
      data: {
        TotalCapex: Number(row.totalcapex),
        TotalAmount: Number(row.totalamount),
        PendingCount: Number(row.pendingcount),
        PendingAmount: Number(row.pendingamount),
        ApprovedCount: Number(row.approvedcount),
        ApprovedAmount: Number(row.approvedamount),
        RejectedCount: Number(row.rejectedcount),
        RejectedAmount: Number(row.rejectedamount),
        ReturnedCount: Number(row.returnedcount),
        ReturnedAmount: Number(row.returnedamount),
        VoidCount: Number(row.voidcount),
        VoidAmount: Number(row.voidamount),
      },
    };
  } catch (error) {
    return reportFailure(error, "CAPEX summary report");
  }
};

const getCapexStatusReport = async (data) => {
  try {
    const result = await pool.query(
      `${REPORT_DATA_CTE}
       SELECT
         Status,
         COUNT(*)::bigint AS Count,
         COALESCE(SUM(Total), 0) AS TotalAmount
       FROM filtered_capex
       GROUP BY Status
       ORDER BY
         CASE Status
           WHEN 'Pending' THEN 1
           WHEN 'Approved' THEN 2
           WHEN 'Rejected' THEN 3
           WHEN 'Returned' THEN 4
           WHEN 'Void' THEN 5
           ELSE 6
         END;`,
      reportParameters(data)
    );

    return {
      success: true,
      message: "CAPEX status report fetched successfully.",
      data: result.rows.map((row) => ({
        Status: row.status,
        Count: Number(row.count),
        TotalAmount: Number(row.totalamount),
      })),
    };
  } catch (error) {
    return reportFailure(error, "CAPEX status report");
  }
};

const groupedReportRows = (rows, groupField) => rows.map((row) => ({
  [groupField]: groupField === "OrganizationID"
    ? Number(row.organizationid)
    : row.department,
  Count: Number(row.count),
  TotalAmount: Number(row.totalamount),
  ApprovedCount: Number(row.approvedcount),
  PendingCount: Number(row.pendingcount),
  RejectedCount: Number(row.rejectedcount),
  ReturnedCount: Number(row.returnedcount),
}));

const getCapexDepartmentReport = async (data) => {
  try {
    const result = await pool.query(
      `${REPORT_DATA_CTE}
       SELECT
         COALESCE(Department, 'Unspecified') AS Department,
         COUNT(*)::bigint AS Count,
         COALESCE(SUM(Total), 0) AS TotalAmount,
         COUNT(*) FILTER (WHERE Status = 'Approved')::bigint AS ApprovedCount,
         COUNT(*) FILTER (WHERE Status = 'Pending')::bigint AS PendingCount,
         COUNT(*) FILTER (WHERE Status = 'Rejected')::bigint AS RejectedCount,
         COUNT(*) FILTER (WHERE Status = 'Returned')::bigint AS ReturnedCount
       FROM filtered_capex
       GROUP BY COALESCE(Department, 'Unspecified')
       ORDER BY COALESCE(Department, 'Unspecified') ASC;`,
      reportParameters(data)
    );

    return {
      success: true,
      message: "CAPEX department report fetched successfully.",
      data: groupedReportRows(result.rows, "Department"),
    };
  } catch (error) {
    return reportFailure(error, "CAPEX department report");
  }
};

const getCapexOrganizationReport = async (data) => {
  try {
    const result = await pool.query(
      `${REPORT_DATA_CTE}
       SELECT
         OrganizationID,
         COUNT(*)::bigint AS Count,
         COALESCE(SUM(Total), 0) AS TotalAmount,
         COUNT(*) FILTER (WHERE Status = 'Approved')::bigint AS ApprovedCount,
         COUNT(*) FILTER (WHERE Status = 'Pending')::bigint AS PendingCount,
         COUNT(*) FILTER (WHERE Status = 'Rejected')::bigint AS RejectedCount,
         COUNT(*) FILTER (WHERE Status = 'Returned')::bigint AS ReturnedCount
       FROM filtered_capex
       GROUP BY OrganizationID
       ORDER BY OrganizationID ASC;`,
      reportParameters(data)
    );

    return {
      success: true,
      message: "CAPEX organization report fetched successfully.",
      data: groupedReportRows(result.rows, "OrganizationID"),
    };
  } catch (error) {
    return reportFailure(error, "CAPEX organization report");
  }
};

module.exports = {
  createCapex,
  getAllCapex,
  getCapexById,
  updateCapex,
  deleteCapex,
  processCapexApproval,
  getCapexSummaryReport,
  getCapexStatusReport,
  getCapexDepartmentReport,
  getCapexOrganizationReport,
};
