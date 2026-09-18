const { pool } = require("../../db");
const { numberToWords } = require("../../utils/numberToWords");

const MODULE_NAME = "Engineering";
const ENTITY_TYPE = "EquipmentAMCSummary";
const ACTION = "AMC_EXPIRING_TODAY";

const positiveIDs = (values) => [...new Set(values.map(Number)
  .filter((value) => Number.isSafeInteger(value) && value > 0))];

// Engineering_AMC_Master is authoritative for AMC expiry; equipment only
// supplies display fields for the notification and email.
const resolveExpiringAMCs = async ({ businessDate, queryable = pool } = {}) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate || ""))) {
    throw new Error("A valid AMC business date is required.");
  }
  const result = await queryable.query(`
    SELECT am.AMCID, am.OrganizationID, am.EquipmentID,
           TO_CHAR(am.AMCStartDate, 'YYYY-MM-DD') AS AMCStartDate,
           TO_CHAR(am.AMCEndDate, 'YYYY-MM-DD') AS AMCEndDate,
           am.AMCType, am.AMCAmount, am.VendorName,
           e.Description AS EquipmentName, e.SerialNumber, e.Make,
           e.ModelNumber, e.Area, e.AMCStatus, e.AMCYearlyExpense,
           COALESCE(NULLIF(TRIM(om.OrganizationName), ''), om.ShortName, 'HotelOps') AS OrganizationName,
           logo.LogoName
    FROM Engineering_AMC_Master am
    INNER JOIN Engineering_Equipment_Entry_Master e
      ON e.EquipmentID = am.EquipmentID AND e.IsDeleted = FALSE
    INNER JOIN Organization_Master om
      ON om.OrganizationID = am.OrganizationID
      AND om.IsActive = TRUE AND om.ActivationStatus = TRUE AND om.IsDeleted = FALSE
    LEFT JOIN LATERAL (
      SELECT oml.LogoName FROM organization_master_logo oml
      WHERE oml.OrganizationID = om.OrganizationID AND oml.IsDeleted = FALSE
      ORDER BY oml.LogoID LIMIT 1
    ) logo ON TRUE
    WHERE am.IsDeleted = FALSE AND am.AMCEndDate::date = $1::date
    ORDER BY am.OrganizationID, am.AMCID;`, [businessDate]);
  return result.rows;
};

const resolveAMCRecipients = async ({ organizationIDs, queryable = pool } = {}) => {
  if (!organizationIDs?.length) return [];
  const result = await queryable.query(`
    SELECT DISTINCT um.UserID, uom.OrganizationID, LOWER(TRIM(um.Email)) AS Email
    FROM user_master um
    INNER JOIN user_org_mapping uom ON uom.UserID = um.UserID
    INNER JOIN department_master dm ON dm.DepartmentID = um.DepartmentID
      AND dm.OrganizationID = uom.OrganizationID
    WHERE uom.OrganizationID = ANY($1::bigint[])
      AND UPPER(TRIM(um.UserType)) = 'HOD'
      AND UPPER(TRIM(dm.DepartmentName)) = 'ENGINEERING'
      AND um.IsActive = TRUE AND um.IsDeleted = FALSE AND um.IsLocked = FALSE
      AND uom.IsActive = TRUE AND uom.IsDeleted = FALSE AND dm.IsDeleted = FALSE;`,
  [organizationIDs]);
  return result.rows;
};

const processAMCNotifications = async ({ businessDate, amcRows,
  recipientRows, queryable = pool, publishNotification } = {}) => {
  const rows = amcRows || await resolveExpiringAMCs({ businessDate, queryable });
  if (!rows.length) return { candidates: 0, organizations: 0, sent: 0, skipped: 0, failed: 0 };
  const organizationIDs = positiveIDs(rows.map((row) => row.organizationid));
  const recipients = recipientRows || await resolveAMCRecipients({ organizationIDs, queryable });
  const existingResult = await queryable.query(`
    SELECT Organization_ID FROM notifications
    WHERE Module_Name = $1 AND Entity_Type = $2 AND Action = $3
      AND Entity_ID = $4 AND Organization_ID = ANY($5::bigint[]);`,
  [MODULE_NAME, ENTITY_TYPE, ACTION, businessDate, organizationIDs]);
  const existing = new Set(existingResult.rows.map((row) => Number(row.organization_id)));
  const send = publishNotification || (async (data) => {
    const { sendMessage } = require("../../producer/producer");
    const QUEUE = require("../../config/queue");
    return sendMessage(QUEUE.NOTIFICATION.REQUEST, QUEUE.NOTIFICATION.RESPONSE,
      { action: "CREATE_NOTIFICATION", data });
  });
  const summary = { candidates: rows.length, organizations: organizationIDs.length,
    sent: 0, skipped: 0, failed: 0 };
  for (const organizationID of organizationIDs) {
    const items = rows.filter((row) => Number(row.organizationid) === organizationID);
    const userIds = positiveIDs(recipients.filter((row) =>
      Number(row.organizationid) === organizationID).map((row) => row.userid));
    if (!userIds.length || existing.has(organizationID)) { summary.skipped += 1; continue; }
    const count = items.length;
    let message = `${numberToWords(count)} ${count === 1 ? "AMC Expires" : "AMCs Expire"} Today.`;
    if (count <= 3) {
      message += `\n\nAffected Equipment:\n${items.map((row) => {
        const details = [String(row.equipmentname || "Equipment").trim()];
        if (String(row.serialnumber || "").trim()) details.push(`Serial: ${String(row.serialnumber).trim()}`);
        if (String(row.area || "").trim()) details.push(`Area: ${String(row.area).trim()}`);
        details.push(`AMC End Date: ${String(row.amcenddate || businessDate)}`);
        return `- ${details.join(" | ")}`;
      }).join("\n")}`;
    }
    try {
      const response = await send({ organizationId: organizationID,
        title: "Engineering AMC Expiry Summary", message, type: "info",
        moduleName: MODULE_NAME, entityType: ENTITY_TYPE, entityId: businessDate,
        action: ACTION, priority: "normal", userIds });
      if (!response || response.success !== true) throw new Error(response?.message || "No response");
      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`Engineering AMC notification failed for organization ${organizationID}:`, error.message);
    }
  }
  return summary;
};

module.exports = { resolveExpiringAMCs, resolveAMCRecipients, processAMCNotifications };
