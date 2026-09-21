const { pool } = require("../../db");
const { sendEmail } = require("../../utils/emailService");
const generateOrganizationLogoUrl = require("../../AzurConfigration/ITAdmin/OrganizationMaster/AzureGetData");
const { buildCreditApplicationEmail } = require("./CreditApplicationEmailTemplate");

const MODULE_NAME = "Credit Application";
const ENTITY_TYPE = "CreditApplication";
const CENTRAL_FINANCE_ORGANIZATION_ID = 10;
const APPROVAL_ROLES = new Set(["FC", "GM"]);

const notificationUserIds = (values) => [...new Set((Array.isArray(values) ? values : [values])
  .filter((value) => value != null && /^[1-9]\d*$/.test(String(value).trim()))
  .map((value) => String(value).trim()))].sort((left, right) => Number(left) - Number(right));

// FC and GM recipients must belong to the application's organization; JWT role
// authorization alone is not sufficient for notification delivery.
const resolveCreditApplicationRecipients = async ({ organizationID, roles = [],
  excludeUserIds = [], queryable = pool } = {}) => {
  const normalizedRoles = [...new Set(roles.map((role) => String(role || "").trim().toUpperCase())
    .filter((role) => APPROVAL_ROLES.has(role)))];
  const excludedIds = notificationUserIds(excludeUserIds);
  if (!normalizedRoles.length) return { userIds: [], recipients: [] };

  const result = await queryable.query(`
    SELECT DISTINCT um.UserID, NULLIF(TRIM(um.Email), '') AS Email,
      om.OrganizationName,
      COALESCE(NULLIF(TRIM(om.ShortName), ''), om.OrganizationName) AS OrganizationShortName,
      logo.LogoName
    FROM user_master um
    INNER JOIN user_org_mapping uom ON uom.UserID = um.UserID
      AND uom.OrganizationID = $1 AND uom.IsActive = TRUE AND uom.IsDeleted = FALSE
    INNER JOIN organization_master om ON om.OrganizationID = uom.OrganizationID
    LEFT JOIN department_master dm ON dm.DepartmentID = um.DepartmentID
    LEFT JOIN LATERAL (
      SELECT oml.LogoName
      FROM organization_master_logo oml
      WHERE oml.OrganizationID = om.OrganizationID AND oml.IsDeleted = FALSE
      ORDER BY oml.LogoID
      LIMIT 1
    ) logo ON TRUE
    WHERE um.IsActive = TRUE AND um.IsDeleted = FALSE AND um.IsLocked = FALSE
      AND om.IsActive = TRUE AND om.ActivationStatus = TRUE AND om.IsDeleted = FALSE
      AND NOT (um.UserID::text = ANY($3::text[]))
      AND (
        ('FC' = ANY($2::text[]) AND UPPER(TRIM(um.UserType)) = 'HOD'
          AND UPPER(TRIM(COALESCE(dm.DepartmentName, ''))) IN ('FC', 'FINANCE')
          AND dm.OrganizationID = $1 AND dm.IsDeleted = FALSE
          -- Central Finance HOD remains the RD role even when additionally
          -- mapped to the Credit Application's organization.
          AND NOT EXISTS (
            SELECT 1
            FROM user_org_mapping central_uom
            INNER JOIN organization_master central_om
              ON central_om.OrganizationID = central_uom.OrganizationID
            WHERE central_uom.UserID = um.UserID
              AND central_uom.OrganizationID = $4
              AND central_uom.IsActive = TRUE AND central_uom.IsDeleted = FALSE
              AND central_om.IsActive = TRUE
              AND central_om.ActivationStatus = TRUE
              AND central_om.IsDeleted = FALSE))
        OR ('GM' = ANY($2::text[]) AND UPPER(TRIM(um.UserType)) = 'GM')
      );`, [organizationID, normalizedRoles, excludedIds,
    CENTRAL_FINANCE_ORGANIZATION_ID]);

  const rowsByUser = new Map();
  for (const row of result.rows) rowsByUser.set(String(row.userid), row);
  const recipients = [...rowsByUser.values()];
  const first = recipients[0] || {};
  return {
    userIds: notificationUserIds(recipients.map((row) => row.userid)),
    recipients,
    organizationName: String(first.organizationname || "").trim(),
    organizationShortName: String(first.organizationshortname || "").trim(),
    logoName: first.logoname || null,
  };
};

const creditApplicationContent = ({ kind, companyName, organizationShortName }) => {
  const title = `Credit Application - ${String(companyName || "").trim()} - ${organizationShortName}`;
  const messages = {
    CREATE: "Credit application created and requires your action.",
    FC_APPROVE: "Credit application approved by FC and requires your action.",
    GM_APPROVE: "Credit application approved by GM. Please update the ARID.",
    GM_REJECT: "Credit application rejected by GM. Please review the application.",
  };
  if (!messages[kind]) throw new Error(`Unsupported Credit Application notification kind: ${kind}`);
  return { title, message: messages[kind] };
};

const dispatchCreditApplicationEvent = async ({ organizationID, creditApplicationID,
  companyName, roles, excludeUserIds, kind, action, details,
  queryable = pool, publishNotification, deliverEmail = sendEmail } = {}) => {
  const context = await resolveCreditApplicationRecipients({ organizationID, roles,
    excludeUserIds, queryable });
  if (!context.userIds.length) return { skipped: true, reason: "no-eligible-recipient" };

  const content = creditApplicationContent({ kind, companyName,
    organizationShortName: context.organizationShortName });
  const sendNotification = publishNotification || (async (data) => {
    const { sendMessage } = require("../../producer/producer");
    const QUEUE = require("../../config/queue");
    return sendMessage(QUEUE.NOTIFICATION.REQUEST, QUEUE.NOTIFICATION.RESPONSE,
      { action: "CREATE_NOTIFICATION", data });
  });
  const notificationPayload = { organizationId: Number(organizationID),
    title: content.title, message: content.message, type: "info", moduleName: MODULE_NAME,
    entityType: ENTITY_TYPE, entityId: String(creditApplicationID), action,
    priority: "normal", userIds: context.userIds };

  let logoUrl = process.env.NILE_OFFICIAL_LOGO_URL || null;
  if (context.logoName) {
    try { logoUrl = generateOrganizationLogoUrl(context.logoName); }
    catch (error) { console.error("Credit Application email logo URL failed:", error.message); }
  }
  const email = buildCreditApplicationEmail({ title: content.title, message: content.message,
    organizationName: context.organizationName, logoUrl,
    details: { ...details, companyName } });
  const uniqueEmails = new Map();
  for (const recipient of context.recipients) {
    const address = String(recipient.email || "").trim();
    if (address) uniqueEmails.set(address.toLowerCase(), address);
  }

  // Both channels start only after the business transaction commits and fail independently.
  const tasks = [Promise.resolve().then(() => sendNotification(notificationPayload))
    .then((response) => {
      if (!response || response.success !== true) {
        throw new Error(response?.message || "Notification request unsuccessful");
      }
    }).catch((error) => console.error("Credit Application notification failed:", error.message))];
  for (const address of uniqueEmails.values()) {
    tasks.push(Promise.resolve().then(() => deliverEmail(address, email.subject, email.text, email.html))
      .catch((error) => console.error("Credit Application email failed:", error.message)));
  }
  await Promise.all(tasks);
  return { skipped: false, userIds: context.userIds, emailCount: uniqueEmails.size };
};

// The caller invokes this only after COMMIT; detached delivery cannot change the operation result.
const dispatchCommittedCreditApplicationEvent = (event) => {
  Promise.resolve().then(() => dispatchCreditApplicationEvent(event))
    .catch((error) => console.error("Credit Application post-commit dispatch failed:", error.message));
};

module.exports = { notificationUserIds, resolveCreditApplicationRecipients,
  creditApplicationContent, dispatchCreditApplicationEvent,
  dispatchCommittedCreditApplicationEvent };
