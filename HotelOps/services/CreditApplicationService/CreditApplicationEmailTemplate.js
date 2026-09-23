const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");
const display = (value) => value === undefined || value === null || String(value).trim() === ""
  ? "-" : String(value);
const amount = (value) => Number.isFinite(Number(value))
  ? `₹ ${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "-";
const row = (label, value) => `<tr><td style="width:38%;padding:9px 12px;border-bottom:1px solid #dbe5f0;background:#f5f8fc;color:#52647a;font-size:13px;font-weight:600;vertical-align:top;word-break:break-word;">${escapeHtml(label)}</td><td style="padding:9px 12px;border-bottom:1px solid #dbe5f0;color:#172033;font-size:13px;vertical-align:top;word-break:break-word;">${escapeHtml(display(value))}</td></tr>`;

const buildCreditApplicationEmail = ({ title, message, organizationName,
  logoUrl, details = {} } = {}) => {
  const subject = `[HotelOps] ${String(title || "Credit Application").trim()}`;
  const note = "This is an automated notification from HotelOps. Please do not reply to this email.";
  const detailRows = [
    ["Company/Firm Name", details.companyName],
    ["Application Date", details.applicationDate],
    ["Credit Amount Allowed", amount(details.creditAmountAllowed)],
    ["Expected Business FY", amount(details.expectedBusinessFY)],
    ["Financial Year", details.financialYear],
    ["Authorised Person", details.authorisedPerson],
    ["Accounts Contact", details.accountsContact],
    ["Organization", organizationName],
  ];
  const text = [title, "Dear Sir/Madam,", message,
    ...detailRows.map(([label, value]) => `${label}: ${display(value)}`), note].join("\n\n");
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(display(organizationName))} logo" width="92" style="display:block;width:92px;max-height:58px;object-fit:contain;border:0;">`
    : `<div style="font-size:18px;font-weight:700;color:#ffffff;">HotelOps</div>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#172033;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#eef3f8;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:collapse;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 3px 14px rgba(8,43,92,.12);">
    <tr><td style="padding:20px 28px;background:#082b5c;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="112" valign="middle">${logo}</td><td valign="middle" style="color:#ffffff;font-size:19px;font-weight:700;line-height:1.3;">${escapeHtml(display(organizationName))}<div style="font-size:12px;font-weight:400;color:#c9d9ec;margin-top:3px;">Credit Application Notification</div></td></tr></table></td></tr>
    <tr><td style="padding:24px 28px 14px;"><div style="font-size:20px;line-height:1.35;font-weight:700;color:#082b5c;">${escapeHtml(display(title))}</div><div style="margin-top:14px;font-size:14px;line-height:1.6;color:#33465e;">Dear Sir/Madam,</div><div style="margin-top:7px;font-size:14px;line-height:1.6;color:#45566c;">${escapeHtml(display(message))}</div></td></tr>
    <tr><td style="padding:0 28px 28px;"><div style="padding:0 0 8px;color:#082b5c;font-size:15px;font-weight:700;">Application Details</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dbe5f0;">${detailRows.map(([label, value]) => row(label, value)).join("")}</table></td></tr>
    <tr><td align="center" style="padding:16px 24px;background:#f3f6fa;border-top:1px solid #dbe5f0;color:#718096;font-size:11px;line-height:1.5;">${note}<br>HotelOps</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
};

module.exports = { buildCreditApplicationEmail };
