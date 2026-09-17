const { pool } = require("../../db");
const { sendEmail } = require("../../utils/emailService");
const generateOrganizationLogoUrl = require("../../AzurConfigration/ITAdmin/OrganizationMaster/AzureGetData");

const EMAIL_TYPE = "AMC_EXPIRING_TODAY";
const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const display = (value) => value == null || String(value).trim() === "" ? "-" : String(value);

const ensureDeliveryLog = (queryable) => queryable.query(`
  CREATE TABLE IF NOT EXISTS Engineering_Email_Delivery_Log (
    EngineeringEmailDeliveryLogID BIGSERIAL PRIMARY KEY,
    EmailType VARCHAR(80) NOT NULL, OrganizationID BIGINT NOT NULL,
    BusinessDate DATE NOT NULL, RecipientEmail VARCHAR(320) NOT NULL,
    SentDate TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_engineering_email_delivery
      UNIQUE (EmailType, OrganizationID, BusinessDate, RecipientEmail)
  );`);

const buildAMCEmail = ({ organizationName, logoUrl, businessDate, rows }) => {
  const subject = `[HotelOps] AMC Expiring Today - ${organizationName}`;
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(organizationName)} logo" width="92" style="display:block;width:92px;max-height:58px;object-fit:contain;border:0;">`
    : `<div style="font-size:18px;font-weight:700;color:#fff;">HotelOps</div>`;
  const tableRows = rows.map((row) => `<tr>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.equipmentname))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.serialnumber))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml([row.make, row.modelnumber].filter((v) => v != null && String(v).trim()).join(" / ") || "-")}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.area))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.amctype))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.amcstartdate))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.amcenddate))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.amcstatus))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.amcamount ?? row.amcyearlyexpense))}</td>
    <td style="padding:8px;border:1px solid #dbe5f0;">${escapeHtml(display(row.vendorname))}</td>
  </tr>`).join("");
  const introduction = "The following equipment AMCs expire today and require review.";
  const text = ["AMC Expiring Today", `Organization: ${organizationName}`,
    `AMC Expiry Date: ${businessDate}`, "Dear Sir/Madam,", introduction,
    `Total Equipment: ${rows.length}`,
    ...rows.map((row) => `${display(row.equipmentname)} | ${display(row.serialnumber)} | ${display(row.area)} | ${display(row.amctype)} | ${display(row.amcstartdate)} | ${display(row.amcenddate)} | ${display(row.amcstatus)} | ${display(row.amcamount ?? row.amcyearlyexpense)} | ${display(row.vendorname)}`),
    "This is an automated notification from HotelOps. Please do not reply."].join("\n");
  const headers = ["Equipment", "Serial Number", "Make / Model", "Area", "AMC Type",
    "AMC From", "AMC To", "AMC Status", "Yearly Expense", "Vendor"];
  const html = `<!doctype html><html><body style="margin:0;background:#eef3f8;font-family:Arial,sans-serif;color:#172033;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 10px;"><table role="presentation" width="980" cellspacing="0" cellpadding="0" style="width:100%;max-width:980px;background:#fff;border-collapse:collapse;">
    <tr><td style="padding:20px 24px;background:#082b5c;color:#fff;"><table role="presentation" width="100%"><tr><td width="112">${logo}</td><td><div style="font-size:20px;font-weight:700;">${escapeHtml(organizationName)}</div><div style="margin-top:4px;font-size:13px;color:#c9d9ec;">Engineering AMC</div></td></tr></table></td></tr>
    <tr><td style="padding:22px 24px 14px;"><div style="font-size:19px;font-weight:700;color:#b54708;">AMC Expiring Today</div><div style="margin-top:7px;color:#52647a;font-size:13px;">AMC Expiry Date: ${escapeHtml(businessDate)} &nbsp;|&nbsp; Total Equipment: ${rows.length}</div><div style="margin-top:18px;font-size:14px;">Dear Sir/Madam,</div></td></tr>
    <tr><td style="padding:0 24px 18px;"><div style="padding:12px 14px;background:#fff7ed;border-left:4px solid #b54708;font-size:13px;line-height:1.5;">${introduction}</div></td></tr>
    <tr><td style="padding:0 24px 24px;overflow-x:auto;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:11px;"><tr style="background:#eaf1f8;color:#082b5c;">${headers.map((label) => `<th style="padding:8px;border:1px solid #dbe5f0;text-align:left;">${label}</th>`).join("")}</tr>${tableRows}</table></td></tr>
    <tr><td align="center" style="padding:15px 20px;background:#f3f6fa;border-top:1px solid #dbe5f0;color:#718096;font-size:11px;">This is an automated notification from HotelOps. Please do not reply.<br>HotelOps</td></tr>
  </table></td></tr></table></body></html>`;
  return { subject, text, html };
};

const processEngineeringAMCEmails = async ({ businessDate, amcRows = [], recipientRows = [],
  queryable = pool, deliverEmail = sendEmail } = {}) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate || ""))) {
    throw new Error("A valid AMC email business date is required.");
  }
  if (!amcRows.length) return { records: 0, organizations: 0, sent: 0, skipped: 0, failed: 0 };
  await ensureDeliveryLog(queryable);
  const organizationIDs = [...new Set(amcRows.map((row) => Number(row.organizationid)))];
  const deliveredResult = await queryable.query(`
    SELECT OrganizationID, LOWER(TRIM(RecipientEmail)) AS RecipientEmail
    FROM Engineering_Email_Delivery_Log
    WHERE EmailType = $1 AND BusinessDate = $2::date
      AND OrganizationID = ANY($3::bigint[]);`, [EMAIL_TYPE, businessDate, organizationIDs]);
  const delivered = new Set(deliveredResult.rows.map((row) =>
    `${Number(row.organizationid)}|${String(row.recipientemail || "").toLowerCase()}`));
  const summary = { records: amcRows.length, organizations: organizationIDs.length,
    sent: 0, skipped: 0, failed: 0 };
  for (const organizationID of organizationIDs) {
    const rows = amcRows.filter((row) => Number(row.organizationid) === organizationID);
    const emails = [...new Set(recipientRows.filter((row) =>
      Number(row.organizationid) === organizationID).map((row) =>
      String(row.email || "").trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) { summary.skipped += 1; continue; }
    let logoUrl = process.env.NILE_OFFICIAL_LOGO_URL || null;
    if (rows[0].logoname) try { logoUrl = generateOrganizationLogoUrl(rows[0].logoname); }
    catch (error) { console.error("Engineering AMC logo URL failed:", error.message); }
    const message = buildAMCEmail({ organizationName: rows[0].organizationname || "HotelOps",
      logoUrl, businessDate, rows });
    for (const email of emails) {
      const key = `${organizationID}|${email}`;
      if (delivered.has(key)) { summary.skipped += 1; continue; }
      try {
        await deliverEmail(email, message.subject, message.text, message.html);
        await queryable.query(`INSERT INTO Engineering_Email_Delivery_Log
          (EmailType, OrganizationID, BusinessDate, RecipientEmail)
          VALUES ($1, $2, $3::date, LOWER(TRIM($4)))
          ON CONFLICT (EmailType, OrganizationID, BusinessDate, RecipientEmail) DO NOTHING;`,
        [EMAIL_TYPE, organizationID, businessDate, email]);
        delivered.add(key);
        summary.sent += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`Engineering AMC email failed for ${email}:`, error.message);
      }
    }
  }
  return summary;
};

module.exports = { buildAMCEmail, processEngineeringAMCEmails };
