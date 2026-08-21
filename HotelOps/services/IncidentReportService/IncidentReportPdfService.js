const PdfPrinter = require("pdfmake");
const path = require("path");

const fonts = {
  Roboto: {
    normal: path.join(process.cwd(), "fonts/Roboto-Regular.ttf"),
    bold: path.join(process.cwd(), "fonts/Roboto-Medium.ttf"),
    italics: path.join(process.cwd(), "fonts/Roboto-SemiBold.ttf"),
    bolditalics: path.join(process.cwd(), "fonts/Roboto-Bold.ttf"),
  },
};

const display = (value) => value == null || value === "" ? "-" : String(value);
const row = (label, value) => ([
  { text: label, bold: true, fillColor: "#eaf1f8", margin: [5, 4] },
  { text: display(value), margin: [5, 4] },
]);

const generateIncidentReportPdf = (data) => new Promise((resolve, reject) => {
  const printer = new PdfPrinter(fonts);
  const details = [
    row("Incident Report ID", data.ID), row("Organization", data.OrganizationName),
    row("Report Date", data.ReportDate), row("Incident Date", data.IncidentDate),
    row("Time", data.Time), row("Location", data.Location),
    row("Accident Cause", data.AccidentCause), row("Any Casualty", data.Anycasualty),
    row("Description", data.Description), row("Damage Caused", data.Damagedcaused),
    row("Investigation", data.Investigation), row("Investigated By", data.InvestigatedBy),
    row("Present During Incident", data.PresentDuringIncident), row("Reported To", data.ReportTo),
    row("Report Made By", data.ReportBy), row("Created By", data.CreatedBy),
    row("Created Date", data.CreatedDate), row("Modified By", data.ModifyBy),
    row("Modified Date", data.ModifyDate),
  ];
  const definition = {
    pageSize: "A4", pageMargins: [36, 42, 36, 42],
    content: [
      { text: "INCIDENT REPORT", alignment: "center", bold: true, fontSize: 18, color: "#1f4e78", margin: [0, 0, 0, 16] },
      { table: { widths: [150, "*"], body: details }, layout: "lightHorizontalLines" },
    ],
    defaultStyle: { font: "Roboto", fontSize: 9 },
  };
  try {
    const pdf = printer.createPdfKitDocument(definition);
    const chunks = [];
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.end();
  } catch (error) { reject(error); }
});

module.exports = { generateIncidentReportPdf };
