const { pool } = require("../../db");

const MODULE_NAME = "Engineering";
const ENTITY_TYPE = "AMC";
const AMC_RD_ORGANIZATION_ID = 10;
const APPROVAL_ROLES = new Set(["FC", "GM", "RD", "CEO"]);

const notificationUserIds = (values) => [...new Set((Array.isArray(values) ? values : [values])
  .filter((value) => value != null && /^[1-9]\d*$/.test(String(value).trim()))
  .map((value) => String(value).trim()))].sort();

// RD is resolved centrally from Organization 10. Every other role and direct
// creator remains scoped to the AMC's own organization.
const resolveAMCApprovalNotificationRecipients = async ({ organizationID,
  roles = [], directUserIds = [], excludeUserID = null, actorUserID = null,
  queryable = pool } = {}) => {
  const normalizedRoles = [...new Set(roles.map((role) =>
    String(role || "").trim().toUpperCase()).filter((role) => APPROVAL_ROLES.has(role)))];
  const normalizedUserIds = notificationUserIds(directUserIds);
  const result = await queryable.query(`
    SELECT DISTINCT um.UserID,
      COALESCE(NULLIF(TRIM(om.ShortName), ''), om.OrganizationName) AS OrganizationShortName,
      COALESCE(NULLIF(TRIM(actor.FullName), ''), NULLIF(TRIM(actor.UserName), '')) AS ActorName
    FROM user_master um
    INNER JOIN organization_master om ON om.OrganizationID = $1
    LEFT JOIN department_master dm ON dm.DepartmentID = um.DepartmentID
    LEFT JOIN user_master actor ON actor.UserID::text = $5::text
    WHERE om.IsActive = TRUE AND om.ActivationStatus = TRUE AND om.IsDeleted = FALSE
      AND um.IsActive = TRUE AND um.IsDeleted = FALSE AND um.IsLocked = FALSE
      AND ($4::text IS NULL OR um.UserID::text <> $4::text)
      AND (
        (um.UserID::text = ANY($3::text[]) AND EXISTS (
          SELECT 1 FROM user_org_mapping direct_uom
          WHERE direct_uom.UserID = um.UserID AND direct_uom.OrganizationID = $1
            AND direct_uom.IsActive = TRUE AND direct_uom.IsDeleted = FALSE))
        OR ('FC' = ANY($2::text[])
          AND UPPER(TRIM(um.UserType)) = 'HOD'
          AND UPPER(TRIM(COALESCE(dm.DepartmentName, ''))) = 'FINANCE'
          AND dm.OrganizationID = $1 AND dm.IsDeleted = FALSE
          AND EXISTS (SELECT 1 FROM user_org_mapping fc_uom
            WHERE fc_uom.UserID = um.UserID AND fc_uom.OrganizationID = $1
              AND fc_uom.IsActive = TRUE AND fc_uom.IsDeleted = FALSE))
        OR ('RD' = ANY($2::text[])
          AND UPPER(TRIM(um.UserType)) = 'HOD'
          AND UPPER(TRIM(COALESCE(dm.DepartmentName, ''))) = 'FINANCE'
          AND dm.IsDeleted = FALSE
          AND EXISTS (SELECT 1 FROM user_org_mapping rd_uom
            WHERE rd_uom.UserID = um.UserID AND rd_uom.OrganizationID = $6
              AND rd_uom.IsActive = TRUE AND rd_uom.IsDeleted = FALSE))
        OR ('GM' = ANY($2::text[]) AND UPPER(TRIM(um.UserType)) = 'GM'
          AND EXISTS (SELECT 1 FROM user_org_mapping gm_uom
            WHERE gm_uom.UserID = um.UserID AND gm_uom.OrganizationID = $1
              AND gm_uom.IsActive = TRUE AND gm_uom.IsDeleted = FALSE))
        OR ('CEO' = ANY($2::text[]) AND UPPER(TRIM(um.UserType)) = 'CEO'
          AND EXISTS (SELECT 1 FROM user_org_mapping ceo_uom
            WHERE ceo_uom.UserID = um.UserID AND ceo_uom.OrganizationID = $1
              AND ceo_uom.IsActive = TRUE AND ceo_uom.IsDeleted = FALSE))
      );`, [organizationID, normalizedRoles, normalizedUserIds,
    excludeUserID == null ? null : String(excludeUserID),
    actorUserID == null ? null : String(actorUserID), AMC_RD_ORGANIZATION_ID]);
  return {
    userIds: notificationUserIds(result.rows.map((row) => row.userid)),
    organizationShortName: String(result.rows[0]?.organizationshortname || "").trim(),
    actorName: String(result.rows[0]?.actorname || "").trim(),
  };
};

const amcApprovalNotificationContent = ({ kind, equipmentName,
  organizationShortName, actorName, approverRole }) => {
  const title = `AMC - ${String(equipmentName || "Equipment").trim()} - ${organizationShortName}`;
  const actedBy = actorName || approverRole;
  if (kind === "CREATE") return { title,
    message: "AMC created and require your action." };
  if (kind === "APPROVE") return { title,
    message: `Approved by ${actedBy}.` };
  if (kind === "FINAL_APPROVE") return { title,
    message: `Approved by ${actedBy}.` };
  if (kind === "RETURN") return { title, message: `Returned by ${actedBy}.` };
  if (kind === "REJECT") return { title, message: `Rejected by ${actedBy}.` };
  throw new Error(`Unsupported AMC notification kind: ${kind}`);
};

const notifyAMCApproval = async ({ organizationID, amcID, equipmentName,
  roles = [], directUserIds = [], excludeUserID = null, actorUserID = null,
  kind, approverRole, action,
  queryable = pool, publishNotification } = {}) => {
  const context = await resolveAMCApprovalNotificationRecipients({ organizationID,
    roles, directUserIds, excludeUserID, actorUserID, queryable });
  if (!context.userIds.length) return { skipped: true, reason: "no-eligible-recipient" };
  const content = amcApprovalNotificationContent({ kind, equipmentName,
    organizationShortName: context.organizationShortName,
    actorName: context.actorName, approverRole });
  const send = publishNotification || (async (data) => {
    const { sendMessage } = require("../../producer/producer");
    const QUEUE = require("../../config/queue");
    return sendMessage(QUEUE.NOTIFICATION.REQUEST, QUEUE.NOTIFICATION.RESPONSE,
      { action: "CREATE_NOTIFICATION", data });
  });
  const response = await send({ organizationId: Number(organizationID),
    title: content.title, message: content.message, type: "info",
    moduleName: MODULE_NAME, entityType: ENTITY_TYPE, entityId: String(amcID),
    action, priority: "normal", userIds: context.userIds });
  if (!response || response.success !== true) {
    throw new Error(response?.message || "AMC notification request unsuccessful");
  }
  return { skipped: false, userIds: context.userIds };
};

// Approval persistence is already committed before this detached dispatcher runs.
const notifyCommittedAMCApproval = (event) => {
  Promise.resolve().then(() => notifyAMCApproval(event))
    .catch((error) => console.error("AMC approval notification failed:", error.message));
};

module.exports = { notificationUserIds, resolveAMCApprovalNotificationRecipients,
  amcApprovalNotificationContent, notifyAMCApproval, notifyCommittedAMCApproval };
