const ExcelJS = require("exceljs");

const normalize = (value) => value === null || value === undefined ? "" : value;
const escapeCSV = (value) => {
  const text = String(normalize(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const generateCSV = (rows, columns) => {
  const lines = [columns.map((column) => escapeCSV(column.header)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => escapeCSV(row[column.key])).join(","));
  return Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8");
};

const generateExcel = async (rows, columns, sheetName) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HotelOps";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = columns.map((column) => ({
    header: column.header, key: column.key, width: column.width || 18,
  }));
  for (const row of rows) {
    const record = {};
    for (const column of columns) record[column.key] = normalize(row[column.key]);
    worksheet.addRow(record);
  }
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 24;
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

module.exports = { generateCSV, generateExcel };
