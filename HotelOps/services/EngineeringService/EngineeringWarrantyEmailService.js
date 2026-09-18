const { pool } = require("../../db");
const { sendEmail } = require("../../utils/emailService");
const generateOrganizationLogoUrl = require("../../AzurConfigration/ITAdmin/OrganizationMaster/AzureGetData");

const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");
const display = (value) => value == null || String(value).trim() === "" ? "-" : String(value);
const dateOnly = (value) => value instanceof Date
  ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const equipmentPageUrl = () => process.env.ENGINEERING_EQUIPMENT_FRONTEND_URL
  || `${String(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "")}/Hotelops/Pages/EngineeringModule/Pages/List`;

// A database marker makes successful deliveries restart-safe while failed
// recipients remain eligible for a controlled retry on the next job run.
const ensureDeliveryLog = (queryable) => queryable.query(`
  CREATE TABLE IF NOT EXISTS Engineering_Email_Delivery_Log (
    EngineeringEmailDeliveryLogID BIGSERIAL PRIMARY KEY,
    EmailType VARCHAR(80) NOT NULL,
    OrganizationID BIGINT NOT NULL,
    BusinessDate DATE NOT NULL,
    RecipientEmail VARCHAR(320) NOT NULL,
    SentDate TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_engineering_email_delivery
      UNIQUE (EmailType, OrganizationID, BusinessDate, RecipientEmail)
  );`);

const buildWarrantyEmail = ({ organizationName, logoUrl, warrantyDate, rows, expired }) => {
  const requestUrl = equipmentPageUrl();
  const heading = expired ? "Expired Warranty / Action Pending" : "Today's Warranty";
  const subject = expired
    ? `[HotelOps] Expired Warranty - Action Pending - ${organizationName}`
    : `[HotelOps] Today's Warranty - ${organizationName}`;
  const introduction = expired
    ? "The following equipment warranties have expired and require action."
    : "The following equipment warranties expire today.";
  const accent = expired ? "#b42318" : "#0b5cab";
  const accentBackground = expired ? "#fff1f0" : "#edf6ff";
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(organizationName)} logo" width="92" style="display:block;width:92px;max-height:58px;object-fit:contain;border:0;outline:none;text-decoration:none;">`
    : `<div style="font-size:18px;font-weight:700;color:#ffffff;">HotelOps</div>`;
  const rowsHtml = rows.map((row) => `<tr>
    <td style="padding:9px;border:1px solid #dbe5f0;">${escapeHtml(display(row.equipmentname))}</td>
    <td style="padding:9px;border:1px solid #dbe5f0;">${escapeHtml(display(row.serialnumber))}</td>
    <td style="padding:9px;border:1px solid #dbe5f0;">${escapeHtml([row.make, row.modelnumber].filter((value) => value != null && String(value).trim()).join(" / ") || "-")}</td>
    <td style="padding:9px;border:1px solid #dbe5f0;">${escapeHtml(display(row.area))}</td>
    <td style="padding:9px;border:1px solid #dbe5f0;">${escapeHtml(dateOnly(row.warrantystartdate) || "-")}</td>
    <td style="padding:9px;border:1px solid #dbe5f0;">${escapeHtml(dateOnly(row.warrantyenddate) || "-")}</td>
    <td style="padding:9px;border:1px solid #dbe5f0;color:${accent};font-weight:700;">${escapeHtml(display(row.warrantystatus))}</td>
  </tr>`).join("");
  const text = [heading, `Organization: ${organizationName}`, `Warranty Date: ${warrantyDate}`,
    "Dear Sir/Madam,", introduction, `Total Equipment: ${rows.length}`,
    ...rows.map((row) => `${display(row.equipmentname)} | ${display(row.serialnumber)} | ${display(row.make)} / ${display(row.modelnumber)} | ${display(row.area)} | ${dateOnly(row.warrantystartdate) || "-"} | ${dateOnly(row.warrantyenddate) || "-"} | ${display(row.warrantystatus)}`),
    `View Equipment: ${requestUrl}`,
    "This is an automated notification from HotelOps. Please do not reply."].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#eef3f8;font-family:Arial,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 10px;">
    <table role="presentation" width="820" cellspacing="0" cellpadding="0" style="width:100%;max-width:820px;background:#fff;border-collapse:collapse;">
      <tr><td style="padding:20px 24px;background:#082b5c;color:#fff;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="112" valign="middle">${logo}</td><td valign="middle"><div style="font-size:20px;font-weight:700;">${escapeHtml(organizationName)}</div><div style="margin-top:4px;font-size:13px;color:#c9d9ec;">Engineering Warranty</div></td></tr></table></td></tr>
      <tr><td style="padding:22px 24px 14px;"><div style="font-size:19px;font-weight:700;color:${accent};">${escapeHtml(heading)}</div><div style="margin-top:7px;color:#52647a;font-size:13px;">Warranty Date: ${escapeHtml(warrantyDate)} &nbsp;|&nbsp; Total Equipment: ${rows.length}</div><div style="margin-top:18px;font-size:14px;color:#33465e;">Dear Sir/Madam,</div></td></tr>
      <tr><td style="padding:0 24px 18px;"><div style="padding:12px 14px;background:${accentBackground};border-left:4px solid ${accent};font-size:13px;line-height:1.5;color:#33465e;">${escapeHtml(introduction)}</div></td></tr>
      <tr><td style="padding:0 24px 24px;overflow-x:auto;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px;">
        <tr style="background:#eaf1f8;color:#082b5c;"><th style="padding:9px;border:1px solid #dbe5f0;text-align:left;">Equipment</th><th style="padding:9px;border:1px solid #dbe5f0;text-align:left;">Serial Number</th><th style="padding:9px;border:1px solid #dbe5f0;text-align:left;">Make / Model</th><th style="padding:9px;border:1px solid #dbe5f0;text-align:left;">Area</th><th style="padding:9px;border:1px solid #dbe5f0;text-align:left;">Warranty From</th><th style="padding:9px;border:1px solid #dbe5f0;text-align:left;">Warranty To</th><th style="padding:9px;border:1px solid #dbe5f0;text-align:left;">Warranty Status</th></tr>${rowsHtml}
      </table></td></tr>
      <tr><td align="center" style="padding:0 24px 26px;"><a href="${escapeHtml(requestUrl)}" target="_blank" style="display:inline-block;padding:13px 24px;background:#0b5cab;color:#ffffff;text-decoration:none;border-radius:5px;font-size:13px;font-weight:700;letter-spacing:.3px;">View Equipment</a></td></tr>
      <tr><td align="center" style="padding:15px 20px;background:#f3f6fa;border-top:1px solid #dbe5f0;color:#718096;font-size:11px;">This is an automated notification from HotelOps. Please do not reply.<br>HotelOps</td></tr>
    </table></td></tr></table></body></html>`;
  return { subject, text, html };
};

const processEngineeringWarrantyEmails = async ({ businessDate, queryable = pool,
  deliverEmail = sendEmail } = {}) => {
  const today = String(businessDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("A valid warranty email business date is required.");
  const yesterday = addDays(today, -1);
  await ensureDeliveryLog(queryable);
  const equipmentResult = await queryable.query(`
    SELECT e.EquipmentID, e.OrganizationID, e.Description AS EquipmentName,
           e.SerialNumber, e.Make, e.ModelNumber, e.Area,
           TO_CHAR(e.WarrantyStartDate, 'YYYY-MM-DD') AS WarrantyStartDate,
           TO_CHAR(e.WarrantyEndDate, 'YYYY-MM-DD') AS WarrantyEndDate,
           e.WarrantyStatus,
           CASE
             WHEN e.WarrantyEndDate = $1::date THEN 'TODAY'
             WHEN e.WarrantyEndDate = $2::date
               AND UPPER(TRIM(COALESCE(e.WarrantyStatus, ''))) = 'EXPIRED'
             THEN 'EXPIRED'
           END AS WarrantyCategory,
           COALESCE(NULLIF(TRIM(om.OrganizationName), ''), om.ShortName, 'HotelOps') AS OrganizationName,
           logo.LogoName
    FROM Engineering_Equipment_Entry_Master e
    INNER JOIN Organization_Master om ON om.OrganizationID = e.OrganizationID
      AND om.IsActive = TRUE AND om.ActivationStatus = TRUE AND om.IsDeleted = FALSE
    LEFT JOIN LATERAL (
      SELECT oml.LogoName FROM organization_master_logo oml
      WHERE oml.OrganizationID = om.OrganizationID AND oml.IsDeleted = FALSE
      ORDER BY oml.LogoID LIMIT 1
    ) logo ON TRUE
    WHERE e.IsDeleted = FALSE AND (e.WarrantyEndDate = $1::date
      OR (e.WarrantyEndDate = $2::date
        AND UPPER(TRIM(COALESCE(e.WarrantyStatus, ''))) = 'EXPIRED'))
    ORDER BY e.OrganizationID, e.EquipmentID;`, [today, yesterday]);
  if (!equipmentResult.rows.length) return { records: 0, organizations: 0, sent: 0, skipped: 0, failed: 0 };

  const organizationIDs = [...new Set(equipmentResult.rows.map((row) => Number(row.organizationid)))];
  const recipientResult = await queryable.query(`
    SELECT DISTINCT uom.OrganizationID, LOWER(TRIM(um.Email)) AS Email
    FROM user_master um
    INNER JOIN user_org_mapping uom ON uom.UserID = um.UserID
    INNER JOIN department_master dm ON dm.DepartmentID = um.DepartmentID
      AND dm.OrganizationID = uom.OrganizationID
    WHERE uom.OrganizationID = ANY($1::bigint[])
      AND UPPER(TRIM(um.UserType)) = 'HOD'
      AND UPPER(TRIM(dm.DepartmentName)) = 'ENGINEERING'
      AND um.IsActive = TRUE AND um.IsDeleted = FALSE AND um.IsLocked = FALSE
      AND uom.IsActive = TRUE AND uom.IsDeleted = FALSE AND dm.IsDeleted = FALSE
      AND NULLIF(TRIM(um.Email), '') IS NOT NULL;`, [organizationIDs]);
  const emailsByOrganization = new Map();
  for (const row of recipientResult.rows) {
    const organizationID = Number(row.organizationid);
    const emails = emailsByOrganization.get(organizationID) || new Map();
    const email = String(row.email || "").trim();
    if (email && !emails.has(email.toLowerCase())) emails.set(email.toLowerCase(), email);
    emailsByOrganization.set(organizationID, emails);
  }

  const deliveryResult = await queryable.query(`
    SELECT EmailType, OrganizationID, LOWER(TRIM(RecipientEmail)) AS RecipientEmail
    FROM Engineering_Email_Delivery_Log
    WHERE BusinessDate = $1::date
      AND OrganizationID = ANY($2::bigint[])
      AND EmailType = ANY($3::text[]);`,
  [today, organizationIDs, ["WARRANTY_TODAY", "WARRANTY_EXPIRED"]]);
  const delivered = new Set(deliveryResult.rows.map((row) =>
    `${row.emailtype}|${Number(row.organizationid)}|${String(row.recipientemail || "").toLowerCase()}`));

  const summary = { records: equipmentResult.rows.length, organizations: organizationIDs.length,
    sent: 0, skipped: 0, failed: 0 };
  for (const organizationID of organizationIDs) {
    const organizationRows = equipmentResult.rows.filter((row) => Number(row.organizationid) === organizationID);
    const groups = [{ category: "TODAY",
      rows: organizationRows.filter((row) =>
        String(row.warrantycategory || "").toUpperCase() === "TODAY"),
      date: today, expired: false },
    { rows: organizationRows.filter((row) =>
      String(row.warrantycategory || "").toUpperCase() === "EXPIRED"),
    category: "EXPIRED", date: yesterday, expired: true }];
    const emails = [...(emailsByOrganization.get(organizationID)?.values() || [])];
    for (const group of groups) {
      if (!group.rows.length || !emails.length) { summary.skipped += 1; continue; }
      const emailType = `WARRANTY_${group.category}`;
      let logoUrl = process.env.NILE_OFFICIAL_LOGO_URL || null;
      if (group.rows[0].logoname) {
        try { logoUrl = generateOrganizationLogoUrl(group.rows[0].logoname); }
        catch (error) { console.error("Engineering warranty logo URL failed:", error.message); }
      }
      const message = buildWarrantyEmail({ organizationName: group.rows[0].organizationname || "HotelOps",
        logoUrl,
        warrantyDate: group.date, rows: group.rows, expired: group.expired });
      for (const email of emails) {
        const deliveryKey = `${emailType}|${organizationID}|${email.toLowerCase()}`;
        if (delivered.has(deliveryKey)) { summary.skipped += 1; continue; }
        try {
          await deliverEmail(email, message.subject, message.text, message.html);
          await queryable.query(`
            INSERT INTO Engineering_Email_Delivery_Log
              (EmailType, OrganizationID, BusinessDate, RecipientEmail)
            VALUES ($1, $2, $3::date, LOWER(TRIM($4)))
            ON CONFLICT (EmailType, OrganizationID, BusinessDate, RecipientEmail) DO NOTHING;`,
          [emailType, organizationID, today, email]);
          delivered.add(deliveryKey);
          summary.sent += 1;
        }
        catch (error) { summary.failed += 1; console.error(`Engineering warranty email failed for ${email}:`, error.message); }
      }
    }
  }
  return summary;
};

module.exports = { buildWarrantyEmail, processEngineeringWarrantyEmails };
