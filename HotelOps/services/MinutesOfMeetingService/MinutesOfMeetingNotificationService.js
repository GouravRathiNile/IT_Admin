const { pool } = require("../../db");

const MOM_NOTIFICATION_MODULE = "Minutes of Meeting";
const MOM_NOTIFICATION_ENTITY = "MOM";

const normalizeResponsibleUserIds = (values) => [...new Set(
  (Array.isArray(values) ? values : [values])
    .filter((value) => value != null && /^[1-9]\d*$/.test(String(value).trim()))
    .map((value) => String(value).trim()),
)].sort((left, right) => Number(left) - Number(right));

// Compare each persisted action independently. A user assigned to a new action
// remains a new assignment even when they already own another meeting action.
const addedResponsibleUserIds = (beforeRows = [], afterRows = []) => {
  const beforeByAction = new Map(beforeRows.map((row) => [String(row.actionid),
    new Set(normalizeResponsibleUserIds(row.responsibleperson))]));
  const added = [];

  for (const row of afterRows) {
    const previous = beforeByAction.get(String(row.actionid));
    for (const userID of normalizeResponsibleUserIds(row.responsibleperson)) {
      if (!previous || !previous.has(userID)) added.push(userID);
    }
  }

  return normalizeResponsibleUserIds(added);
};

const notifyMOMAssignment = async ({ organizationID, meetingID, meetingTitle,
  responsibleUserIds, action, queryable = pool, publishNotification } = {}) => {
  const candidateIds = normalizeResponsibleUserIds(responsibleUserIds);
  if (!candidateIds.length) return { skipped: true, reason: "no-assignment" };

  const recipientResult = await queryable.query(`
    SELECT DISTINCT um.UserID,
      COALESCE(NULLIF(TRIM(om.ShortName), ''), om.OrganizationName) AS OrganizationShortName
    FROM user_master um
    INNER JOIN user_org_mapping uom ON uom.UserID = um.UserID
    INNER JOIN organization_master om ON om.OrganizationID = uom.OrganizationID
    WHERE um.UserID::text = ANY($1::text[])
      AND uom.OrganizationID = $2
      AND um.IsActive = TRUE AND um.IsDeleted = FALSE AND um.IsLocked = FALSE
      AND uom.IsActive = TRUE AND uom.IsDeleted = FALSE
      AND om.IsActive = TRUE AND om.ActivationStatus = TRUE AND om.IsDeleted = FALSE;
  `, [candidateIds, organizationID]);

  const userIds = normalizeResponsibleUserIds(recipientResult.rows.map((row) => row.userid));
  if (!userIds.length) return { skipped: true, reason: "no-eligible-recipient" };

  const organizationShortName = String(
    recipientResult.rows[0]?.organizationshortname || "",
  ).trim();
  const title = `MOM - ${String(meetingTitle || "Meeting").trim()} - ${organizationShortName}`;
  const message = "You have been assigned one or more action items for this meeting.";
  const send = publishNotification || (async (data) => {
    const { sendMessage } = require("../../producer/producer");
    const QUEUE = require("../../config/queue");
    return sendMessage(QUEUE.NOTIFICATION.REQUEST, QUEUE.NOTIFICATION.RESPONSE,
      { action: "CREATE_NOTIFICATION", data });
  });

  const response = await send({ organizationId: Number(organizationID), title, message,
    type: "info", moduleName: MOM_NOTIFICATION_MODULE, entityType: MOM_NOTIFICATION_ENTITY,
    entityId: String(meetingID), action, priority: "normal", userIds });
  if (!response || response.success !== true) {
    throw new Error(response?.message || "MOM notification request unsuccessful");
  }

  return { skipped: false, userIds };
};

// MOM data is already committed before this detached dispatcher is called.
const notifyCommittedMOMAssignment = (event) => {
  Promise.resolve().then(() => notifyMOMAssignment(event))
    .catch((error) => console.error("MOM assignment notification failed:", error.message));
};

module.exports = { normalizeResponsibleUserIds, addedResponsibleUserIds,
  notifyMOMAssignment, notifyCommittedMOMAssignment };
