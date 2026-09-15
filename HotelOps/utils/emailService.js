const nodemailer = require("nodemailer");

const getTransporter = () => {
  const host = process.env.SMTP_HOST || "host56.registrar-servers.com";
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!user || !pass) {
    throw new Error("SMTP configuration is missing");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
};

const sendEmail = async (
  to,
  subject,
  text,
  html,
  attachments = [],
  cc = ""
) => {
  try {
    const fromName = process.env.SMTP_FROM_NAME || "HotelOps";
    const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

    const info = await getTransporter().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      cc: cc || undefined,
      subject,
      text,
      html,
      attachments,
    });

    console.log("Email sent: %s", info.messageId);
    return info;
  } catch (error) {
    console.error("Email send failed:", error.message);
    throw error;
  }
};

const sendPasswordResetOTP = async (email, otp) => {
  const subject = "Password Reset Verification OTP";
  const text = [
      "We received a request to reset your password.",
      `Your verification OTP is: ${otp}`,
      "This OTP is valid for 10 minutes.",
      "If you did not request a password reset, please ignore this email.",
    ].join("\n\n");
  const html = `
    <p>We received a request to reset your password.</p>
    <p>Your verification OTP is:</p>
    <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${otp}</p>
    <p>This OTP is valid for <strong>10 minutes</strong>.</p>
    <p>If you did not request a password reset, please ignore this email.</p>
  `;

  return sendEmail(email, subject, text, html);
};

// Escape notification data before placing it in the reusable HTML template.
const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const capexPageUrl = () => {
  if (process.env.CAPEX_FRONTEND_URL) return process.env.CAPEX_FRONTEND_URL;
  const baseUrl = String(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
  return `${baseUrl}/Hotelops/Pages/Capex/Pages`;
};

const displayEmailValue = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return "-";
  return String(value);
};

const displayAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `₹ ${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
    : "-";
};

const displayActionDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : "-";
};

const detailRow = (label, value) => `
  <tr>
    <td style="width:38%;padding:9px 12px;border-bottom:1px solid #dbe5f0;background:#f5f8fc;color:#52647a;font-size:13px;font-weight:600;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(label)}</td>
    <td style="padding:9px 12px;border-bottom:1px solid #dbe5f0;color:#172033;font-size:13px;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(displayEmailValue(value))}</td>
  </tr>`;

const capexActionMessage = (kind, actionBy) => {
  const actor = displayEmailValue(actionBy);
  return {
    CREATE: "A new CAPEX request has been created and is available for your review.",
    APPROVE: `The CAPEX request has been approved by ${actor}.`,
    REJECT: `The CAPEX request has been rejected by ${actor}.`,
    RETURN: `The CAPEX request has been returned by ${actor} for further review.`,
    HOLD: `The CAPEX request has been placed on hold by ${actor}.`,
  }[kind] || "A CAPEX request requires your attention.";
};

// Send the CAPEX report-style email through the existing shared transporter.
// Notification title/message remain owned by CAPEX and are used unchanged.
const sendNotificationEmail = async (email, notification) => {
  const title = String(notification?.title || "").trim();
  const details = notification?.email_data || {};
  const organizationName = String(notification?.organization_name || "HotelOps").trim();
  const logoUrl = String(notification?.logo_url || "").trim();
  const requestUrl = capexPageUrl();
  const kind = String(details.kind || "").toUpperCase();
  const isCreate = kind === "CREATE";
  const emailTitle = `CAPEX - ${displayEmailValue(details.item)}`;
  const actionMessage = capexActionMessage(kind, details.actionBy);
  const subject = `[HotelOps] ${title}`;
  const automatedNote = "This is an automated notification from HotelOps. Please do not reply to this email.";
  const text = [
    emailTitle,
    "Dear Sir/Madam,",
    actionMessage,
    `Item: ${displayEmailValue(details.item)}`,
    `Department: ${displayEmailValue(details.department)}`,
    `Quantity: ${displayEmailValue(details.quantity)}`,
    `Rate: ${displayAmount(details.rate)}`,
    `Total Amount: ${displayAmount(details.total)}`,
    `Organization: ${organizationName}`,
    `Description: ${displayEmailValue(details.description)}`,
    ...(!isCreate ? [
      `Action Quantity: ${displayEmailValue(details.actionQuantity)}`,
      `Remark: ${displayEmailValue(details.remark)}`,
      `Action By: ${displayEmailValue(details.actionBy)}`,
      `Action Date: ${displayActionDate(details.actionDate)}`,
    ] : []),
    `View CAPEX Request: ${requestUrl}`,
    automatedNote,
  ].join("\n\n");
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(organizationName)} logo" width="92" style="display:block;width:92px;max-height:58px;object-fit:contain;border:0;outline:none;text-decoration:none;">`
    : `<div style="font-size:18px;font-weight:700;color:#ffffff;">HotelOps</div>`;
  const actionDetails = isCreate ? "" : `
    <tr><td style="padding:0 28px 22px;">
      <div style="padding:0 0 8px;color:#082b5c;font-size:15px;font-weight:700;">Action Details</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dbe5f0;">
        ${detailRow("Action Quantity", details.actionQuantity)}
        ${detailRow("Remark", details.remark)}
        ${detailRow("Action By", details.actionBy)}
        ${detailRow("Action Date", displayActionDate(details.actionDate))}
      </table>
    </td></tr>`;
  const html = `
    <!doctype html>
    <html><body style="margin:0;padding:0;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#172033;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#eef3f8;">
        <tr><td align="center" style="padding:24px 12px;">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:collapse;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 3px 14px rgba(8,43,92,.12);">
            <tr><td style="padding:20px 28px;background:#082b5c;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
                <td width="112" valign="middle">${logo}</td>
                <td valign="middle" style="color:#ffffff;font-size:19px;font-weight:700;line-height:1.3;">${escapeHtml(organizationName)}<div style="font-size:12px;font-weight:400;color:#c9d9ec;margin-top:3px;">CAPEX Notification</div></td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:24px 28px 14px;">
              <div style="font-size:21px;line-height:1.35;font-weight:700;color:#082b5c;">${escapeHtml(emailTitle)}</div>
              <div style="margin-top:14px;font-size:14px;line-height:1.6;color:#33465e;">Dear Sir/Madam,</div>
              <div style="margin-top:7px;font-size:14px;line-height:1.6;color:#45566c;">${escapeHtml(actionMessage)}</div>
            </td></tr>
            <tr><td style="padding:0 28px 22px;">
              <div style="padding:0 0 8px;color:#082b5c;font-size:15px;font-weight:700;">CAPEX Details</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dbe5f0;">
                ${detailRow("Item", details.item)}
                ${detailRow("Department", details.department)}
                ${detailRow("Quantity", details.quantity)}
                ${detailRow("Rate", displayAmount(details.rate))}
                ${detailRow("Total Amount", displayAmount(details.total))}
                ${detailRow("Organization", organizationName)}
              </table>
            </td></tr>
            <tr><td style="padding:0 28px 22px;">
              <div style="padding:0 0 8px;color:#082b5c;font-size:15px;font-weight:700;">Description</div>
              <div style="padding:13px 14px;border:1px solid #dbe5f0;background:#f8fafc;font-size:13px;line-height:1.6;color:#33465e;">${escapeHtml(displayEmailValue(details.description)).replace(/\r?\n/g, "<br>")}</div>
            </td></tr>
            ${actionDetails}
            <tr><td align="center" style="padding:2px 28px 28px;">
              <a href="${escapeHtml(requestUrl)}" target="_blank" style="display:inline-block;padding:13px 24px;background:#0b5cab;color:#ffffff;text-decoration:none;border-radius:5px;font-size:13px;font-weight:700;letter-spacing:.3px;">VIEW CAPEX REQUEST</a>
            </td></tr>
            <tr><td align="center" style="padding:16px 24px;background:#f3f6fa;border-top:1px solid #dbe5f0;color:#718096;font-size:11px;line-height:1.5;">${automatedNote}<br>HotelOps</td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
  `;

  return sendEmail(email, subject, text, html);
};

module.exports = {
  sendEmail,
  sendPasswordResetOTP,
  sendNotificationEmail,
};
