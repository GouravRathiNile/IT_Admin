const PdfPrinter = require("pdfmake");
const path = require("path");
const { pool } = require("../db");
const { formatDate } = require("./dateFormatter");
const generateOrganizationLogoUrl = require("../AzurConfigration/ITAdmin/OrganizationMaster/AzureGetData");

const COLORS = Object.freeze({ navy: "#082B5C", border: "#CFD7E3", light: "#F4F6F9", text: "#172033" });
const fonts = {
  Roboto: {
    normal: path.join(process.cwd(), "fonts/Roboto-Regular.ttf"),
    bold: path.join(process.cwd(), "fonts/Roboto-Medium.ttf"),
    italics: path.join(process.cwd(), "fonts/Roboto-SemiBold.ttf"),
    bolditalics: path.join(process.cwd(), "fonts/Roboto-Bold.ttf"),
  }
};
const display = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map((item) => item?.name || item?.comment || String(item)).join(", ") || "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const organizationLogoUrl = async (organizationId) => {
  if (!organizationId) return null;
  try {
    const result = await pool.query(
      `SELECT logoname FROM organization_master_logo
        WHERE organizationid = $1 AND isdeleted = FALSE
        ORDER BY logoid LIMIT 1`,
      [Number(organizationId)]
    );
    return result.rows[0]?.logoname ? generateOrganizationLogoUrl(result.rows[0].logoname) : null;
  } catch (_error) { return null; }
};

// Official fallback is a real stored/configured NILE logo. The previous drawn
// placeholder is intentionally not used by any report.
const officialNileLogoUrl = async () => {
  if (process.env.NILE_OFFICIAL_LOGO_URL) return process.env.NILE_OFFICIAL_LOGO_URL;
  try {
    const result = await pool.query(
      `SELECT oml.logoname
       FROM organization_master_logo oml
       INNER JOIN organization_master om ON om.organizationid = oml.organizationid
       WHERE oml.isdeleted = FALSE
         AND om.isdeleted = FALSE
         AND (LOWER(BTRIM(om.shortname)) = 'nile'
           OR LOWER(BTRIM(om.organizationname)) = 'nile'
           OR LOWER(BTRIM(om.organizationname)) LIKE 'nile %')
       ORDER BY om.organizationid, oml.logoid
       LIMIT 1`,
      []
    );
    return result.rows[0]?.logoname ? generateOrganizationLogoUrl(result.rows[0].logoname) : null;
  } catch (_error) { return null; }
};

const fetchLogo = async (url) => {
  if (!url || typeof fetch !== "function") return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const type = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!["image/png", "image/jpeg", "image/jpg"].includes(type)) return null;
    return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  } catch (_error) { return null; }
};

const loadLogo = async (organizationId, suppliedUrl) => {
  const organizationUrl = suppliedUrl || await organizationLogoUrl(organizationId);
  const organizationLogo = await fetchLogo(organizationUrl);
  if (organizationLogo) return organizationLogo;
  return fetchLogo(await officialNileLogoUrl());
};

const buildHeader = async (title, organizationId, logoUrl) => {
  const logo = await loadLogo(organizationId, logoUrl);
  return {
    table: {
      widths: [100, "*", 100], body: [[
        { ...(logo ? { image: logo, fit: [78, 45], alignment: "left" } : { text: "" }), border: [false, false, false, false] },
        { text: title, style: "pdfTitle", alignment: "center", margin: [0, 15, 0, 0], border: [false, false, false, false] },
        { text: "", border: [false, false, false, false] },
      ]]
    }, layout: "noBorders", margin: [0, 0, 0, 10]
  };
};

// const metadataTable = (items = []) => ({
//   table: { widths: [72, "*", 72, "*"], body: Array.from({ length: Math.ceil(items.length / 2) }, (_, row) => {
//     const left = items[row * 2]; const right = items[(row * 2) + 1];
//     return [
//       { text: left?.label || "", style: "pdfLabel", fillColor: COLORS.light }, { text: left ? display(left.value) : "", style: "pdfValue" },
//       { text: right?.label || "", style: "pdfLabel", fillColor: COLORS.light }, { text: right ? display(right.value) : "", style: "pdfValue" },
//     ];
//   }) },
//   layout: { hLineColor: () => COLORS.border, vLineColor: () => COLORS.border, hLineWidth: () => 0.4, vLineWidth: () => 0.4, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 4, paddingBottom: () => 4 },
//   margin: [0, 0, 0, 12],
// });
// const metadataTable = (items = []) => {
//   const normalItems = items.filter((item) => !item?.fullWidth);
//   const fullWidthItems = items.filter((item) => item?.fullWidth);

//   const body = [];

//   for (let index = 0; index < normalItems.length; index += 2) {
//     const left = normalItems[index];
//     const right = normalItems[index + 1];

//     body.push([
//       {
//         text: left?.label || "",
//         style: "pdfLabel",
//         fillColor: COLORS.light,
//       },
//       {
//         text: left ? display(left.value) : "",
//         style: "pdfValue",
//       },
//       {
//         text: right?.label || "",
//         style: "pdfLabel",
//         fillColor: COLORS.light,
//       },
//       {
//         text: right ? display(right.value) : "",
//         style: "pdfValue",
//       },
//     ]);
//   }

//   fullWidthItems.forEach((item) => {
//     body.push([
//       {
//         text: item.label || "",
//         style: "pdfLabel",
//         fillColor: COLORS.light,
//       },
//       {
//         text: display(item.value),
//         style: "pdfValue",
//         colSpan: 3,
//       },
//       {},
//       {},
//     ]);
//   });

//   return {
//     table: {
//       widths: [72, "*", 72, "*"],
//       body,
//     },
//     layout: {
//       hLineColor: () => COLORS.border,
//       vLineColor: () => COLORS.border,
//       hLineWidth: () => 0.4,
//       vLineWidth: () => 0.4,
//       paddingLeft: () => 5,
//       paddingRight: () => 5,
//       paddingTop: () => 4,
//       paddingBottom: () => 4,
//     },
//     margin: [0, 0, 0, 12],
//   };
// };

const metadataTable = (items = []) => {
  const normalItems = items.filter((item) => !item?.fullWidth);
  const fullWidthItems = items.filter((item) => item?.fullWidth);

  const body = [];

  for (let index = 0; index < normalItems.length; index += 2) {
    const left = normalItems[index];
    const right = normalItems[index + 1];

    body.push([
      {
        text: left?.label || "",
        style: "pdfLabel",
        fillColor: COLORS.light,
        alignment: "left",
      },
      {
        text: left ? display(left.value) : "",
        style: "pdfValue",
        alignment: "left",
      },
      {
        text: right?.label || "",
        style: "pdfLabel",
        fillColor: COLORS.light,
        alignment: "left",
      },
      {
        text: right ? display(right.value) : "",
        style: "pdfValue",
        alignment: "left",
      },
    ]);
  }

  fullWidthItems.forEach((item) => {
    body.push([
      {
        text: item.label || "",
        style: "pdfLabel",
        fillColor: COLORS.light,
        alignment: "left",
      },
      {
        text: display(item.value),
        style: "pdfValue",
        colSpan: 3,
        alignment: "left",
      },
      {},
      {},
    ]);
  });

  return {
    table: {
      widths: [72, "*", 72, "*"],
      body,
    },

    layout: {
      hLineColor: () => COLORS.border,
      vLineColor: () => COLORS.border,
      hLineWidth: () => 0.4,
      vLineWidth: () => 0.4,

      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },

    margin: [0, 0, 0, 12],
  };
};

const sectionTable = (title, value) => ({
  table: {
    widths: ["*"],
    body: [
      [
        {
          text: title,
          style: "pdfSectionHeader",
          margin: [5, 3, 5, 3],
        },
      ],
      [
        {
          text: display(value),
          style: "pdfSectionContent",
          margin: [5, 5, 5, 5],
        },
      ],
    ],
  },
  layout: {
    hLineColor: () => COLORS.border,
    vLineColor: () => COLORS.border,
    hLineWidth: () => 0.4,
    vLineWidth: () => 0.4,
  },
  margin: [0, 0, 0, 8],
});


const bottomTable = (items = []) => ({
  table: {
    widths: [90, "*", 145, "*"],
    body: [
      [
        {
          text: items[0]?.label || "",
          style: "pdfLabel",
          fillColor: COLORS.light,
        },
        {
          text: display(items[0]?.value),
          style: "pdfValue",
        },
        {
          text: items[1]?.label || "",
          style: "pdfLabel",
          fillColor: COLORS.light,
        },
        {
          text: display(items[1]?.value),
          style: "pdfValue",
        },
      ],
      [
        {
          text: items[2]?.label || "",
          style: "pdfLabel",
          fillColor: COLORS.light,
        },
        {
          text: display(items[2]?.value),
          style: "pdfValue",
        },
        {
          text: items[3]?.label || "",
          style: "pdfLabel",
          fillColor: COLORS.light,
        },
        {
          text: display(items[3]?.value),
          style: "pdfValue",
        },
      ],
    ],
  },
  layout: {
    hLineColor: () => COLORS.border,
    vLineColor: () => COLORS.border,
    hLineWidth: () => 0.4,
    vLineWidth: () => 0.4,
    paddingLeft: () => 5,
    paddingRight: () => 5,
    paddingTop: () => 4,
    paddingBottom: () => 4,
  },
  margin: [0, 4, 0, 0],
});

const baseTableLayout = {
  fillColor: (row) => row === 0 ? COLORS.navy : row % 2 === 0 ? "#FAFBFD" : "#FFFFFF",
  hLineColor: () => COLORS.border, vLineColor: () => COLORS.border,
  hLineWidth: () => 0.5, vLineWidth: () => 0.5,
  paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 5, paddingBottom: () => 5,
};

const dataTable = ({ columns, rows = [], layout, table = {}, headerStyle = "pdfTableHeader", cellStyle = "pdfTableCell" }) => {
  const body = [columns.map((column) => ({ text: column.header, style: headerStyle, alignment: column.align || "left" }))];
  body.push(...rows.map((row) => columns.map((column) => ({
    text: display(typeof column.value === "function" ? column.value(row) : row[column.key]),
    style: column.style || cellStyle, alignment: column.align || "left", noWrap: column.noWrap,
    ...(column.bold ? { bold: true } : {}),
  }))));
  if (body.length === 1) body.push([{ text: "No data found.", colSpan: columns.length, alignment: "center" }, ...Array(Math.max(0, columns.length - 1)).fill({})]);
  return { table: { headerRows: 1, dontBreakRows: true, widths: columns.map((column) => column.width || "*"), body, ...table }, layout: { ...baseTableLayout, ...layout } };
};

const footer = (reportName, timestamp) => (page, count) => ({
  columns: [
    { text: reportName, alignment: "left", width: "*" },
    { text: `Page ${page} of ${count}`, alignment: "center", width: "auto", bold: true },
    { text: `Generated: ${timestamp}`, alignment: "right", width: "*" },
  ], fontSize: 7.5, color: COLORS.navy, margin: [24, 6, 24, 0]
});

// const generatePdf = async ({ title, reportName, organizationId, logoUrl, orientation = "portrait", metadata = [], columns, rows, sections = [], pageMargins, styles = {}, tableOptions = {} }) => {
const generatePdf = async ({
  title,
  reportName,
  organizationId,
  logoUrl,
  orientation = "portrait",
  metadata = [],
  columns,
  rows,
  sections = [],
  bottomItems = [],
  pageMargins,
  styles = {},
  tableOptions = {}
}) => {
  // const content = [await buildHeader(title, organizationId, logoUrl)];
  // if (metadata.length) content.push(metadataTable(metadata));
  // if (columns) content.push(dataTable({ columns, rows, ...tableOptions }));
  // for (const section of sections) {
  //   content.push({ text: section.title, style: "pdfSection", margin: [0, 8, 0, 4] });
  //   content.push(metadataTable(section.items));
  // }
  const content = [await buildHeader(title, organizationId, logoUrl)];

  if (metadata.length) {
    content.push({
      text: "Information",
      style: "pdfSectionHeader",
      margin: [5, 3, 5, 3],
    });

    content.push(metadataTable(metadata));
  }

  if (columns) {
    content.push(dataTable({ columns, rows, ...tableOptions }));
  }

  for (const section of sections) {
    content.push(sectionTable(section.title, section.items[0]?.value));
  }

  if (bottomItems.length) {
    content.push(bottomTable(bottomItems));
  }
  const definition = {
    pageSize: "A4", pageOrientation: orientation, pageMargins: pageMargins || [24, 26, 24, 34], content,
    defaultStyle: { font: "Roboto", fontSize: orientation === "landscape" ? 8 : 9 },
    styles: {
      pdfTitle: { fontSize: 18, bold: true, color: COLORS.navy }, pdfLabel: { fontSize: 8, bold: true, color: COLORS.navy },
      pdfValue: { fontSize: 8.5, color: COLORS.text }, pdfTableHeader: { fontSize: 8, bold: true, color: COLORS.navy },
      pdfTableCell: { fontSize: 8, color: COLORS.text }, pdfSection: { fontSize: 12, bold: true, color: COLORS.navy }, pdfSectionHeader: {
        fontSize: 8,
        bold: true,
        color: COLORS.navy,
        fillColor: COLORS.light,
      },

      pdfSectionContent: {
        fontSize: 8,
        color: COLORS.text,
        lineHeight: 1.15,
      }, ...styles,
    },
    footer: footer(reportName, formatDate(new Date(), "DD MMM YYYY hh:mm A")),
  };
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PdfPrinter(fonts).createPdfKitDocument(definition); const chunks = [];
      pdf.on("data", (chunk) => chunks.push(chunk)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); pdf.end();
    } catch (error) { reject(error); }
  });
};

module.exports = { generatePdf, dataTable, metadataTable, loadLogo, display, COLORS };
