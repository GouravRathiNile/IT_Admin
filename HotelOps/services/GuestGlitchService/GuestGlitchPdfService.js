const PDFDocument = require("pdfkit");

const value = (input) => {
  if (input == null || input === "") return "-";
  if (Array.isArray(input)) return input.map((item) => item.name || item.comment || String(item)).join(", ") || "-";
  if (typeof input === "object") return JSON.stringify(input);
  return String(input);
};

const section = (doc, title, fields, data) => {
  doc.moveDown(0.5).fontSize(13).fillColor("#1f4e78").text(title).moveDown(0.25);
  doc.fontSize(9).fillColor("#111111");
  for (const [label, key] of fields) {
    doc.font("Helvetica-Bold").text(`${label}: `, { continued: true })
      .font("Helvetica").text(value(data[key]));
  }
};

const generateGuestGlitchPdf = (data) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.on("error", reject);

  doc.fontSize(18).fillColor("#1f4e78").text("Guest Glitch Master Report", { align: "center" });
  doc.fontSize(10).fillColor("#333333").text(`Record #${data.ID}`, { align: "center" });
  section(doc, "Hotel and Guest", [["Hotel", "Hotel"], ["Entry Date", "EntryDate"], ["Room", "RoomNumber"], ["Guest", "GuestName"], ["Guest Status", "GuestStatus"], ["Company", "CompanyName"], ["Rate", "Rate"], ["Check In", "CheckInDate"], ["Check Out", "CheckOutDate"]], data);
  section(doc, "Complaint and Follow-up", [["Complaint", "Complaint"], ["Complaint Source", "ComplaintSource"], ["Raise Source", "RaiseSource"], ["Departments", "Departments"], ["Received By", "ReceivedByUsers"], ["Informed To", "InformedToUsers"], ["Process Lapse", "ProcessLapse"], ["Service Recovery", "ServiceRecovery"], ["Detailed Investigation", "DetailedInvestigation"], ["Internal Action", "InternalActionTaken"]], data);
  section(doc, "Workflow", [["Status", "Status"], ["Resolved By", "ResolvedBy"], ["GM Comment", "GMComment"], ["HOD Comments", "DepartmentHODComments"]], data);
  section(doc, "Audit and Attachment", [["Created By", "CreatedBy"], ["Created Date", "CreatedDate"], ["Modified By", "ModifyBy"], ["Modified Date", "ModifyDate"], ["Attachment", "Attachment"]], data);
  doc.end();
});

module.exports = { generateGuestGlitchPdf };
