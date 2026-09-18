const { pool } = require("../../db");
const { sendEmail } = require("../../utils/emailService");
const generateOrganizationLogoUrl = require("../../AzurConfigration/ITAdmin/OrganizationMaster/AzureGetData");

const EMAIL_TYPE = "MAINTENANCE_DUE";
const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const display = (value) => value == null || String(value).trim() === "" ? "-" : String(value);
const equipmentPageUrl = () => process.env.ENGINEERING_EQUIPMENT_FRONTEND_URL
  || `${String(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "")}/Hotelops/Pages/EngineeringModule/Pages/List`;

const buildMaintenanceEmail = ({ organizationName, logoUrl, maintenanceDate, rows }) => {
  const requestUrl = equipmentPageUrl();
  const subject = `[HotelOps] Today's Scheduled Maintenance - ${organizationName}`;
  const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(organizationName)} logo" width="92" style="display:block;width:92px;max-height:58px;object-fit:contain;border:0;">`
    : `<div style="font-size:18px;font-weight:700;color:#fff;">HotelOps</div>`;
  const tableRows = rows.map((row) => `<tr>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.equipmentname))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.serialnumber))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml([row.make, row.modelnumber].filter((v) => v != null && String(v).trim()).join(" / ") || "-")}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.area))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.scheduleofservicing))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.scheduleday))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">Scheduled preventive maintenance</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">-</td>
    <td style="padding:8px;border:1px solid #dbe5f0;color:#b54708;font-weight:700;">Pending</td>
  </tr>`).join("");
  const introduction = "The following equipment items are scheduled for maintenance today.";
  const text = ["Today's Scheduled Maintenance", `Organization: ${organizationName}`,
    `Maintenance Date: ${maintenanceDate}`, "Dear Sir/Madam,", introduction,
    `Total Equipment: ${rows.length}`,
    ...rows.map((row) => `${display(row.equipmentname)} | ${display(row.serialnumber)} | ${display(row.area)} | ${display(row.scheduleofservicing)} | Day ${display(row.scheduleday)} | Pending`),
    `View Equipment: ${requestUrl}`,
    "This is an automated notification from HotelOps. Please do not reply."].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#eef3f8;font-family:Arial,sans-serif;color:#172033;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 10px;"><table role="presentation" width="920" cellspacing="0" cellpadding="0" style="width:100%;max-width:920px;background:#fff;border-collapse:collapse;">
    <tr><td style="padding:20px 24px;background:#082b5c;color:#fff;"><table role="presentation" width="100%"><tr><td width="112">${logo}</td><td><div style="font-size:20px;font-weight:700;">${escapeHtml(organizationName)}</div><div style="margin-top:4px;font-size:13px;color:#c9d9ec;">Engineering Maintenance</div></td></tr></table></td></tr>
    <tr><td style="padding:22px 24px 14px;"><div style="font-size:19px;font-weight:700;color:#0b5cab;">Today's Scheduled Maintenance</div><div style="margin-top:7px;color:#52647a;font-size:13px;">Maintenance Date: ${escapeHtml(maintenanceDate)} &nbsp;|&nbsp; Total Equipment: ${rows.length}</div><div style="margin-top:18px;font-size:14px;">Dear Sir/Madam,</div></td></tr>
    <tr><td style="padding:0 24px 18px;"><div style="padding:12px 14px;background:#edf6ff;border-left:4px solid #0b5cab;font-size:13px;line-height:1.5;">${introduction}</div></td></tr>
    <tr><td style="padding:0 24px 24px;overflow-x:auto;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:11px;"><tr style="background:#eaf1f8;color:#082b5c;">${["Equipment", "Serial Number", "Make / Model", "Area", "Schedule", "Schedule Day", "Maintenance / Task", "Assigned Engineer", "Status"].map((label) => `<th style="padding:8px;border:1px solid #dbe5f0;text-align:left;">${label}</th>`).join("")}</tr>${tableRows}</table></td></tr>
    <tr><td align="center" style="padding:0 24px 26px;"><a href="${escapeHtml(requestUrl)}" target="_blank" style="display:inline-block;padding:13px 24px;background:#0b5cab;color:#ffffff;text-decoration:none;border-radius:5px;font-size:13px;font-weight:700;letter-spacing:.3px;">View Equipment</a></td></tr>
    <tr><td align="center" style="padding:15px 20px;background:#f3f6fa;border-top:1px solid #dbe5f0;color:#718096;font-size:11px;">This is an automated notification from HotelOps. Please do not reply.<br>HotelOps</td></tr>
  </table></td></tr></table></body></html>`;
  return { subject, text, html };
};

const processEngineeringMaintenanceEmails = async ({ businessDate, dueItems = [], recipientRows,
  queryable = pool, deliverEmail = sendEmail } = {}) => {
  const today = String(businessDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("A valid maintenance email business date is required.");
  if (!dueItems.length) return { records: 0, organizations: 0, sent: 0, skipped: 0, failed: 0 };
  const organizationIDs = [...new Set(dueItems.map((row) => Number(row.organizationid)))];
  let recipients = recipientRows;
  if (!Array.isArray(recipients)) {
    const result = await queryable.query(`
      SELECT DISTINCT uom.OrganizationID, LOWER(TRIM(um.Email)) AS Email
      FROM user_master um
      INNER JOIN user_org_mapping uom ON uom.UserID = um.UserID
      INNER JOIN department_master dm ON dm.DepartmentID = um.DepartmentID AND dm.OrganizationID = uom.OrganizationID
      WHERE uom.OrganizationID = ANY($1::bigint[])
        AND UPPER(TRIM(um.UserType)) = 'HOD' AND UPPER(TRIM(dm.DepartmentName)) = 'ENGINEERING'
        AND um.IsActive = TRUE AND um.IsDeleted = FALSE AND um.IsLocked = FALSE
        AND uom.IsActive = TRUE AND uom.IsDeleted = FALSE AND dm.IsDeleted = FALSE
        AND NULLIF(TRIM(um.Email), '') IS NOT NULL;`, [organizationIDs]);
    recipients = result.rows;
  }
  const deliveredResult = await queryable.query(`
    SELECT OrganizationID, LOWER(TRIM(RecipientEmail)) AS RecipientEmail
    FROM Engineering_Email_Delivery_Log
    WHERE EmailType = $1 AND BusinessDate = $2::date AND OrganizationID = ANY($3::bigint[]);`,
  [EMAIL_TYPE, today, organizationIDs]);
  const delivered = new Set(deliveredResult.rows.map((row) => `${Number(row.organizationid)}|${String(row.recipientemail || "").toLowerCase()}`));
  const summary = { records: dueItems.length, organizations: organizationIDs.length, sent: 0, skipped: 0, failed: 0 };
  for (const organizationID of organizationIDs) {
    const rows = dueItems.filter((row) => Number(row.organizationid) === organizationID);
    const emails = [...new Set(recipients.filter((row) => Number(row.organizationid) === organizationID)
      .map((row) => String(row.email || "").trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) { summary.skipped += 1; continue; }
    let logoUrl = process.env.NILE_OFFICIAL_LOGO_URL || null;
    if (rows[0].logoname) try { logoUrl = generateOrganizationLogoUrl(rows[0].logoname); }
    catch (error) { console.error("Engineering maintenance logo URL failed:", error.message); }
    const message = buildMaintenanceEmail({ organizationName: rows[0].organizationname || "HotelOps", logoUrl, maintenanceDate: today, rows });
    for (const email of emails) {
      const key = `${organizationID}|${email}`;
      if (delivered.has(key)) { summary.skipped += 1; continue; }
      try {
        await deliverEmail(email, message.subject, message.text, message.html);
        await queryable.query(`INSERT INTO Engineering_Email_Delivery_Log
          (EmailType, OrganizationID, BusinessDate, RecipientEmail)
          VALUES ($1, $2, $3::date, LOWER(TRIM($4)))
          ON CONFLICT (EmailType, OrganizationID, BusinessDate, RecipientEmail) DO NOTHING;`,
        [EMAIL_TYPE, organizationID, today, email]);
        delivered.add(key);
        summary.sent += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`Engineering maintenance email failed for ${email}:`, error.message);
      }
    }
  }
  return summary;
};

module.exports = { buildMaintenanceEmail, processEngineeringMaintenanceEmails };
