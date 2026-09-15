const express = require("express");
const { pool } = require("../../db");
const { formatDate } = require("../../utils/dateFormatter");

const router = express.Router();
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const display = (value) => escapeHtml(String(value ?? "").trim() || "—");
const icons = {
  equipment: '<rect x="4" y="5" width="16" height="13" rx="2"/><path d="M8 18v3m8-3v3M8 9h1m6 0h1M9 14h6"/>',
  building: '<path d="M5 21V3h14v18M3 21h18M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
  tool: '<path d="M14 6a5 5 0 0 0-6 6L3 17a2.8 2.8 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4 3-3Z"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16M8 14h1m6 0h1M8 17h1"/>',
  document: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h6"/>',
  repeat: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
};
const icon = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
const detail = (name, label, value) => '<div class="detail"><span class="detail-icon">' + icon(name) + '</span><div><dt>' + label + '</dt><dd>' + display(value) + '</dd></div></div>';
const metric = (name, tone, label, value) => '<div class="metric"><span class="metric-icon ' + tone + '">' + icon(name) + '</span><dt>' + label + '</dt><dd>' + display(value) + '</dd></div>';
const page = (content) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Equipment Detail | HotelOps</title>
<style>
:root{font-family:Arial,Helvetica,sans-serif;color:#10234c;background:#f5f8fc;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 90% 0%,#fff8e9 0,transparent 40%),linear-gradient(135deg,#f5f9ff,#fff 65%);min-height:100vh}
main{max-width:1320px;margin:0 auto;padding:30px 28px 50px}.brand{display:flex;align-items:center;gap:10px;margin-bottom:24px;color:#192f59;font-size:19px;font-weight:700;letter-spacing:-.4px}.brand svg{width:25px;height:25px;color:#b88409}.brand small{margin-left:auto;font-size:11px;font-weight:600;color:#60728f;letter-spacing:1.5px;text-transform:uppercase}
.card{background:#fff;border:1px solid #e3ebf4;border-radius:20px;box-shadow:0 12px 35px #213e7110;overflow:hidden;margin-bottom:24px}
.hero{display:grid;grid-template-columns:60px minmax(0,1fr) 320px;gap:18px;align-items:center;padding:20px 28px;background:linear-gradient(120deg,#fff 60%,#fffaf0)}
.hero-icon{height:60px;width:60px;border-radius:50%;display:grid;place-items:center;color:#b98406;background:#fcf3dc}.hero-icon svg{width:30px;height:30px}
.eyebrow{color:#a87400;font-size:13px;font-weight:700;letter-spacing:1.5px;margin:0 0 12px}h1{font-size:clamp(21px,2vw,26px);line-height:1.3;letter-spacing:-.6px;margin:0;overflow-wrap:anywhere}h2{margin:0;font-size:25px;letter-spacing:-.5px;line-height:1.3}
.badges{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.badge{display:inline-flex;align-items:center;gap:8px;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.4;max-width:100%;overflow-wrap:anywhere}.badge svg{width:22px;height:22px;flex-shrink:0}.blue{background:#eaf0ff;color:#174cb0}.green{background:#e8f7eb;color:#18783a}.red{background:#fff0ef;color:#ae3836}.neutral{background:#f0f3f7;color:#425775}.purple{background:#f0ebff;color:#7250c7}.gold{background:#fff4d9;color:#ae7a08}
.identity{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0;padding:14px 18px;background:#f7f4eb;border-radius:12px}.identity div+div{border-left:1px solid #dedfdb;padding-left:16px}dt{color:#526782;font-size:14px;line-height:1.5}dd{margin:5px 0 0;color:#12244b;font-size:17px;line-height:1.5;overflow-wrap:anywhere}.identity dd{font-size:18px;font-weight:700}
.details{display:grid;grid-template-columns:1fr 1fr;margin:0 28px;padding:0 0 8px;border-top:1px solid #e5ecf4}.detail{display:flex;gap:22px;align-items:flex-start;padding:24px 18px;min-width:0}.detail:nth-child(n+3){border-top:1px solid #e5ecf4}.detail:nth-child(even){border-left:1px solid #e5ecf4}.detail-icon{display:flex;color:#203e6f;padding-top:3px}.detail-icon svg{width:27px;height:27px}.detail>div{min-width:0}
.maintenance-header{display:flex;align-items:center;gap:16px;padding:18px 28px;background:linear-gradient(115deg,#f0f8ff,#eaf3fa)}.maintenance-header>span{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:#dcecff;flex-shrink:0}.maintenance-header svg{width:27px;height:27px}.maintenance-header p{color:#526b8f;margin:8px 0 0;font-size:15px;line-height:1.6}
.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:0;padding:22px 12px}.metric{padding:0 18px;min-width:0}.metric+.metric{border-left:1px solid #e4ebf5}.metric-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;margin-bottom:8px}.metric-icon svg{width:22px;height:22px}.metric dd{font-weight:400;font-size:17px}.empty{padding:30px 32px;color:#60728f;line-height:1.7}.footer{text-align:center;color:#74829a;font-size:12px;margin:28px 0 0}.error{padding:36px}.error p{color:#60728f;line-height:1.6}
@media(max-width:1000px){.hero{grid-template-columns:52px minmax(0,1fr);gap:14px}.hero-icon{width:52px;height:52px}.hero-icon svg{width:28px;height:28px}.identity{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:20px}.identity div+div{margin:0;padding:0 0 0 20px;border-top:0;border-left:1px solid #dedfdb}.metrics{grid-template-columns:repeat(3,minmax(0,1fr));gap:26px 0}.metric:nth-child(4){border-left:0}}
@media(max-width:600px){main{padding:20px 14px 30px}.brand{margin:0 4px 18px}.brand small{font-size:9px;letter-spacing:1px}.card{border-radius:16px;margin-bottom:18px}.hero{padding:18px;grid-template-columns:44px minmax(0,1fr);gap:12px}.hero-icon{width:44px;height:44px}.hero-icon svg{width:25px;height:25px}.eyebrow{font-size:11px;margin-bottom:8px}.badge{font-size:12px;padding:8px 10px;border-radius:10px}.badge svg{width:18px;height:18px}.badges{gap:8px;margin-top:14px}.identity{padding:16px;gap:12px}.identity dd{font-size:18px}.identity dt{font-size:12px}.details{grid-template-columns:1fr;margin:0 18px}.detail{padding:18px 0;gap:16px}.detail:nth-child(even){border-left:0}.detail+.detail{border-top:1px solid #e5ecf4}.detail dd{font-size:15px}.maintenance-header{padding:16px 18px;gap:12px;align-items:center}.maintenance-header>span{width:40px;height:40px}.maintenance-header svg{width:23px;height:23px}h2{font-size:21px}.maintenance-header p{font-size:13px}.metrics{grid-template-columns:1fr 1fr;padding:18px 4px;gap:18px 0}.metric{padding:0 14px}.metric:nth-child(odd){border-left:0}.metric:nth-child(even){border-left:1px solid #e4ebf5}.metric:first-child{grid-column:1/-1}.metric:nth-child(2),.metric:nth-child(4){border-left:0}.metric:nth-child(3),.metric:nth-child(5){border-left:1px solid #e4ebf5}.metric dd{font-size:15px}.metric dt{font-size:13px}.metric-icon{width:36px;height:36px}.empty{padding:24px 18px}}
@media print{body{background:white}main{max-width:none;padding:0}.card{box-shadow:none;break-inside:avoid}.brand small,.footer{display:none}}
</style></head><body><main><div class="brand">${icon("equipment")} HotelOps <small>Equipment record</small></div>${content}<p class="footer">HotelOps &middot; Equipment &amp; Maintenance</p></main></body></html>`;

// QR scans expose only equipment status and the latest maintenance summary.
router.get("/Equipment", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const organizationID = Number(req.query.OrganizationID);
  const equipmentID = Number(req.query.EquipmentID);
  if (![organizationID, equipmentID].every((id) => Number.isSafeInteger(id) && id > 0)) {
    return res.status(400).type("html").send(page("<h1>Invalid equipment link</h1><p>Valid OrganizationID and EquipmentID are required.</p>"));
  }
  try {
    const result = await pool.query(`
      SELECT e.Capacity, e.SerialNumber, e.Description, d.DepartmentName, e.WarrantyStatus, e.AMCStatus,
             e.ScheduleOfServicing, latest.MaintenanceID, latest.Maintenance,
             latest.MaintenanceDate, latest.MaintenanceBy,
             engineer.FullName AS EngineerName
      FROM Engineering_Equipment_Entry_Master e
      INNER JOIN Organization_Master om
        ON om.OrganizationID = e.OrganizationID AND om.IsDeleted = FALSE
      LEFT JOIN department_master d
        ON d.DepartmentID = e.DepartmentID AND d.OrganizationID = e.OrganizationID
       AND d.IsDeleted = FALSE
      LEFT JOIN LATERAL (
        SELECT m.MaintenanceID, m.Maintenance, m.MaintenanceDate,
               m.MaintenanceBy, m.EngineerAssigned
        FROM Engineering_Maintenance_Details m
        WHERE m.EquipmentID = e.EquipmentID AND m.OrganizationID = e.OrganizationID
          AND m.IsDeleted = FALSE
        ORDER BY m.MaintenanceDate DESC NULLS LAST, m.MaintenanceID DESC
        LIMIT 1
      ) latest ON TRUE
      LEFT JOIN user_master engineer
        ON engineer.UserID = latest.EngineerAssigned AND engineer.IsDeleted = FALSE
      WHERE e.OrganizationID = $1 AND e.EquipmentID = $2 AND e.IsDeleted = FALSE
      LIMIT 1;
    `, [organizationID, equipmentID]);
    const row = result.rows[0];
    if (!row) return res.status(404).type("html").send(page("<h1>Equipment not found</h1><p>This equipment is unavailable.</p>"));
    const maintenance = row.maintenanceid == null
      ? '<div class="empty">No maintenance records available.</div>'
      : '<dl class="metrics">' +
          metric("document", "purple", "Maintenance", row.maintenance) +
          metric("calendar", "green", "Maintenance On", formatDate(row.maintenancedate)) +
          metric("repeat", "gold", "Schedule", row.scheduleofservicing) +
          metric("people", "red", "Maintenance By", row.maintenanceby) +
          metric("person", "blue", "Engineer", row.engineername) + '</dl>';
    return res.type("html").send(page(`
      <section class="card" aria-labelledby="equipment-title">
        <div class="hero">
          <span class="hero-icon">${icon("equipment")}</span>
          <h1 id="equipment-title">Equipment Details</h1>
          <dl class="identity"><div><dt>Capacity</dt><dd>${display(row.capacity)}</dd></div><div><dt>Serial Number</dt><dd>${display(row.serialnumber)}</dd></div></dl>
        </div>
        <dl class="details">
          ${detail("equipment", "Equipment", row.description)}
          ${detail("building", "Department", row.departmentname)}
          ${detail("shield", "Warranty Status", row.warrantystatus)}
          ${detail("tool", "AMC Status", row.amcstatus)}
        </dl>
      </section>
      <section class="card" aria-labelledby="maintenance-title">
        <div class="maintenance-header"><span>${icon("calendar")}</span><div><h2 id="maintenance-title">Last Maintenance Detail</h2></div></div>
        ${maintenance}
      </section>`));
  } catch (error) {
    console.error("Public equipment detail error:", error.message);
    return res.status(503).type("html").send(page("<h1>Equipment details unavailable</h1><p>Please try again shortly.</p>"));
  }
});

module.exports = router;
