const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const display = (value) => value === undefined || value === null || String(value).trim() === ""
  ? "-" : String(value);

const amount = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? `₹ ${numeric.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "-";
};

const actionDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : "-";
};

const opexPageUrl = (entityId) => {
  const encodedId = encodeURIComponent(String(entityId ?? "").trim());
  if (process.env.OPEX_FRONTEND_URL) {
    const separator = process.env.OPEX_FRONTEND_URL.includes("?") ? "&" : "?";
    return `${process.env.OPEX_FRONTEND_URL}${separator}opexId=${encodedId}`;
  }
  const configuredBase = String(process.env.FRONTEND_URL || "").trim().replace(/\/$/, "");
  if (configuredBase) return `${configuredBase}/Hotelops/Pages/Opex/Pages`;
  return process.env.NODE_ENV === "production"
    ? ""
    : `http://localhost:5173/Hotelops/Pages/Opex/Pages`;
};

const row = (label, value) => `
  <tr>
    <td style="width:38%;padding:9px 12px;border-bottom:1px solid #dbe5f0;background:#f5f8fc;color:#52647a;font-size:13px;font-weight:600;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(label)}</td>
    <td style="padding:9px 12px;border-bottom:1px solid #dbe5f0;color:#172033;font-size:13px;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(display(value))}</td>
  </tr>`;

const introduction = (kind, actor) => ({
  CREATE: "A new OPEX request has been created and is available for your review.",
  APPROVE: `The OPEX request has been approved by ${display(actor)}.`,
  REJECT: `The OPEX request has been rejected by ${display(actor)}.`,
  RETURN: `The OPEX request has been returned by ${display(actor)} for further review.`,
  HOLD: `The OPEX request has been placed on hold by ${display(actor)}.`,
}[kind] || "An OPEX request requires your attention.");

// OPEX owns this presentation while the shared email service owns SMTP delivery.
const buildOpexEmail = ({ notificationTitle, organizationName, logoUrl, details = {} }) => {
  const kind = String(details.kind || "").toUpperCase();
  const isCreate = kind === "CREATE";
  const title = `OPEX - ${display(details.item)}`;
  const message = introduction(kind, details.actionBy);
  const requestUrl = opexPageUrl(details.entityId);
  const footerNote = "This is an automated notification. Please do not reply to this email.";
  const text = [
    title, "Dear Sir/Madam,", message,
    `Item: ${display(details.item)}`,
    `Department: ${display(details.department)}`,
    `Quantity: ${display(details.quantity)}`,
    `Rate: ${amount(details.rate)}`,
    `Total Amount: ${amount(details.total)}`,
    `Organization: ${display(organizationName)}`,
    `Description: ${display(details.description)}`,
    ...(!isCreate ? [
      `Action Quantity: ${display(details.actionQuantity)}`,
      `Remark: ${display(details.remark)}`,
      `Action By: ${display(details.actionBy)}`,
      `Action Date: ${actionDate(details.actionDate)}`,
    ] : []),
    ...(requestUrl ? [`View OPEX Request: ${requestUrl}`] : []),
    "Best regards,\nHotelOps Team",
    `© 2026 HotelOps • Nile Hospitality\n${footerNote}`,
  ].join("\n\n");
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(organizationName)} logo" width="92" style="display:block;width:92px;max-height:58px;object-fit:contain;border:0;outline:none;text-decoration:none;">`
    : `<div style="font-size:18px;font-weight:700;color:#ffffff;">HotelOps</div>`;
  const actions = isCreate ? "" : `
    <tr><td style="padding:0 28px 22px;">
      <div style="padding:0 0 8px;color:#082b5c;font-size:15px;font-weight:700;">Action Details</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dbe5f0;">
        ${row("Action Quantity", details.actionQuantity)}
        ${row("Remark", details.remark)}
        ${row("Action By", details.actionBy)}
        ${row("Action Date", actionDate(details.actionDate))}
      </table>
    </td></tr>`;
  const button = requestUrl ? `
    <tr><td align="center" style="padding:2px 28px 28px;">
      <a href="${escapeHtml(requestUrl)}" target="_blank" style="display:inline-block;padding:13px 24px;background:#0b5cab;color:#ffffff;text-decoration:none;border-radius:5px;font-size:13px;font-weight:700;letter-spacing:.3px;">VIEW OPEX REQUEST</a>
    </td></tr>` : "";
  const html = `<!doctype html>
  <html><body style="margin:0;padding:0;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#eef3f8;"><tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:collapse;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 3px 14px rgba(8,43,92,.12);">
        <tr><td style="padding:20px 28px;background:#082b5c;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
          <td width="112" valign="middle">${logo}</td>
          <td valign="middle" style="color:#ffffff;font-size:19px;font-weight:700;line-height:1.3;">${escapeHtml(display(organizationName))}<div style="font-size:12px;font-weight:400;color:#c9d9ec;margin-top:3px;">OPEX Notification</div></td>
        </tr></table></td></tr>
        <tr><td style="padding:24px 28px 14px;">
          <div style="font-size:21px;line-height:1.35;font-weight:700;color:#082b5c;">${escapeHtml(title)}</div>
          <div style="margin-top:14px;font-size:14px;line-height:1.6;color:#33465e;">Dear Sir/Madam,</div>
          <div style="margin-top:7px;font-size:14px;line-height:1.6;color:#45566c;">${escapeHtml(message)}</div>
        </td></tr>
        <tr><td style="padding:0 28px 22px;">
          <div style="padding:0 0 8px;color:#082b5c;font-size:15px;font-weight:700;">OPEX Details</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dbe5f0;">
            ${row("Item", details.item)}${row("Department", details.department)}${row("Quantity", details.quantity)}
            ${row("Rate", amount(details.rate))}${row("Total Amount", amount(details.total))}${row("Organization", organizationName)}
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 22px;">
          <div style="padding:0 0 8px;color:#082b5c;font-size:15px;font-weight:700;">Description</div>
          <div style="padding:13px 14px;border:1px solid #dbe5f0;background:#f8fafc;font-size:13px;line-height:1.6;color:#33465e;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(display(details.description)).replace(/\r?\n/g, "<br>")}</div>
        </td></tr>
        ${actions}${button}
        <tr><td align="center" style="padding:16px 24px;background:#f3f6fa;border-top:1px solid #dbe5f0;color:#718096;font-size:11px;line-height:1.6;">Best regards,<br><strong>HotelOps Team</strong><br><br>© 2026 HotelOps • Nile Hospitality<br>${footerNote}</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  return { subject: `[HotelOps] ${notificationTitle}`, text, html };
};

module.exports = { buildOpexEmail };
