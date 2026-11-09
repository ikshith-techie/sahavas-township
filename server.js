const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { classifyComplaint, parseCsv, matchStatementRow } = require("./src/core");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const PUBLIC_DIR = path.join(__dirname, "public");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "township.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS flats (
    id TEXT PRIMARY KEY, resident TEXT NOT NULL, area INTEGER NOT NULL,
    upi_id TEXT NOT NULL UNIQUE, days_overdue INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY, flat_id TEXT NOT NULL REFERENCES flats(id),
    period TEXT NOT NULL, amount INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
    due_date TEXT NOT NULL, UNIQUE(flat_id, period)
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, flat_id TEXT NOT NULL REFERENCES flats(id),
    bill_id TEXT NOT NULL REFERENCES bills(id), amount INTEGER NOT NULL,
    reference TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS complaints (
    id TEXT PRIMARY KEY, flat_id TEXT NOT NULL REFERENCES flats(id),
    description TEXT NOT NULL, category TEXT NOT NULL, urgency TEXT NOT NULL,
    status TEXT NOT NULL, team TEXT NOT NULL, assigned_to TEXT NOT NULL,
    created_at TEXT NOT NULL, due_at TEXT NOT NULL, resolved_at TEXT, duplicate_of TEXT
  );
  CREATE TABLE IF NOT EXISTS bank_rows (
    id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, posted INTEGER NOT NULL DEFAULT 0,
    raw_json TEXT NOT NULL, match_json TEXT NOT NULL
  );
`);
if (!db.prepare("PRAGMA table_info(complaints)").all().some((column) => column.name === "resolved_at")) {
  db.exec("ALTER TABLE complaints ADD COLUMN resolved_at TEXT");
}

const seedFlats = [
  { id: "T07-1203", resident: "Neeraj Kulkarni", area: 1150, paid: 7475, overdue: 0, upi: "neeraj.k@okaxis" },
  { id: "T12-0408", resident: "Swati Joshi", area: 980, paid: 0, overdue: 47, upi: "swati.j@okhdfcbank" },
  { id: "T21-1601", resident: "Aamir Shaikh", area: 1640, paid: 5000, overdue: 18, upi: "aamir.s@okicici" }
];
const period = new Date().toISOString().slice(0, 7);
const dueDate = `${period}-01`;
const seed = db.prepare("INSERT OR IGNORE INTO flats (id,resident,area,upi_id,days_overdue) VALUES (?,?,?,?,?)");
const billSeed = db.prepare("INSERT OR IGNORE INTO bills (id,flat_id,period,amount,paid,due_date) VALUES (?,?,?,?,?,?)");
for (const flat of seedFlats) {
  seed.run(flat.id, flat.resident, flat.area, flat.upi, flat.overdue);
  billSeed.run(`B-${period}-${flat.id}`, flat.id, period, flat.area * 650 / 100, flat.paid, dueDate);
  if (flat.paid) {
    db.prepare(`INSERT OR IGNORE INTO payments (id,flat_id,bill_id,amount,reference,source,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(`seed-${period}-${flat.id}`, flat.id, `B-${period}-${flat.id}`, flat.paid, `DEMO-${flat.id}`, "Opening balance", new Date().toISOString());
  }
}
const complaintCount = db.prepare("SELECT COUNT(*) AS count FROM complaints").get().count;
if (!complaintCount) {
  const addComplaint = db.prepare(`INSERT INTO complaints
    (id,flat_id,description,category,urgency,status,team,assigned_to,created_at,due_at,duplicate_of)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const now = new Date();
  addComplaint.run("C-1042", "T12-0408", "Water is leaking under the kitchen sink and spreading across the floor.", "Plumbing", "Normal", "In progress", "Plumbing", "R. Patil", new Date(now - 1000 * 60 * 90).toISOString(), new Date(now.getTime() + 1000 * 60 * 60 * 2).toISOString(), null);
}

const sessions = new Map();
const loginAttempts = new Map();
const teams = {
  Plumbing: ["R. Patil", "S. More"],
  Electrical: ["A. Jadhav", "M. Khan"],
  Lift: ["Duty manager", "Lift vendor"],
  Security: ["Duty manager", "Security lead"],
  Housekeeping: ["P. Shinde", "K. Pawar"],
  General: ["Help desk", "Facility supervisor"]
};
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(value));
};
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter((part) => part.length === 2));
const readBody = (req, limit = 1_000_000) => new Promise((resolve, reject) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (Buffer.byteLength(body) > limit) {
      reject(Object.assign(new Error("Request too large"), { status: 413 }));
      req.destroy();
    }
  });
  req.on("end", () => {
    try { resolve(body ? JSON.parse(body) : {}); }
    catch { reject(Object.assign(new Error("Invalid JSON body"), { status: 400 })); }
  });
  req.on("error", reject);
});
const safeString = (value, max = 500) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const requireAuth = (req, res, role) => {
  const sessionId = cookies(req).session;
  const session = sessionId && sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    if (sessionId) sessions.delete(sessionId);
    json(res, 401, { error: "Please sign in to continue." });
    return null;
  }
  if (role && session.role !== role) { json(res, 403, { error: "You don't have permission to do that." }); return null; }
  return session;
};
const billFor = (flatId) => db.prepare("SELECT * FROM bills WHERE flat_id=? ORDER BY period DESC LIMIT 1").get(flatId);
const outstanding = (flatId) => {
  const bill = billFor(flatId);
  return bill ? bill.amount - bill.paid : 0;
};
const sendReceipt = (flatId, billId, amount, source) => {
  const reference = `TXN-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO payments (id,flat_id,bill_id,amount,reference,source,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, flatId, billId, amount, reference, source, createdAt);
  db.prepare("UPDATE bills SET paid=paid+? WHERE id=?").run(amount, billId);
  return { id, flatId, billId, amount, reference, source, createdAt };
};
const publicBill = (bill) => ({ ...bill, balance: bill.amount - bill.paid, rate: 6.5 });
const flatData = (flatId) => {
  const flat = db.prepare("SELECT id,resident,area,days_overdue FROM flats WHERE id=?").get(flatId);
  const bill = billFor(flatId);
  const complaints = db.prepare("SELECT * FROM complaints WHERE flat_id=? ORDER BY created_at DESC").all(flatId);
  const payments = db.prepare("SELECT * FROM payments WHERE flat_id=? ORDER BY created_at DESC").all(flatId);
  return { flat, bill: bill && publicBill(bill), complaints, payments };
};
const csvRows = (csv) => {
  const records = parseCsv(csv);
  if (records.length < 2) throw Object.assign(new Error("Add a header row and at least one bank transaction."), { status: 400 });
  const headers = records[0].map((cell) => cell.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  const index = (names) => headers.findIndex((header) => names.includes(header));
  const amountIndex = index(["amount", "credit", "deposit"]);
  const refIndex = index(["reference", "ref", "description", "narration", "remarks"]);
  const upiIndex = index(["upiid", "payerupi", "vpa"]);
  if (amountIndex < 0 || refIndex < 0) throw Object.assign(new Error("CSV needs amount and reference/description columns."), { status: 400 });
  return records.slice(1).filter((record) => record.some((cell) => cell.trim())).map((record, rowIndex) => {
    const rawAmount = (record[amountIndex] || "").replace(/[₹,\s]/g, "");
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount) !== amount) {
      throw Object.assign(new Error(`Row ${rowIndex + 2}: amount must be a positive whole number of rupees.`), { status: 400 });
    }
    return { amount, reference: (record[refIndex] || "").trim().slice(0, 160), upiId: upiIndex < 0 ? "" : (record[upiIndex] || "").trim().slice(0, 100) };
  });
};

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const method = req.method;
  const route = url.pathname;
  try {
    if (method === "GET" && route === "/api/session") {
      const sessionId = cookies(req).session;
      const session = sessionId && sessions.get(sessionId);
      if (!session || session.expiresAt < Date.now()) {
        if (sessionId) sessions.delete(sessionId);
        json(res, 200, { user: null });
      } else json(res, 200, { user: session });
      return;
    }
    if (method === "POST" && route === "/api/login/otp") {
      const ip = req.socket.remoteAddress || "unknown";
      const attempts = loginAttempts.get(ip) || { count: 0, since: Date.now() };
      if (Date.now() - attempts.since > 10 * 60_000) { attempts.count = 0; attempts.since = Date.now(); }
      if (attempts.count >= 8) { json(res, 429, { error: "Too many attempts. Please wait a few minutes." }); return; }
      const body = await readBody(req);
      const flat = db.prepare("SELECT id,resident FROM flats WHERE id=?").get(String(body.flat || "").trim().toUpperCase());
      if (!flat || body.otp !== (process.env.DEMO_OTP || "246810")) {
        attempts.count++;
        loginAttempts.set(ip, attempts);
        json(res, 401, { error: "That flat or one-time code doesn't match. Try again." });
        return;
      }
      loginAttempts.delete(ip);
      const id = crypto.randomBytes(32).toString("hex");
      const user = { role: "resident", flatId: flat.id, name: flat.resident, expiresAt: Date.now() + 8 * 60 * 60_000 };
      sessions.set(id, user);
      json(res, 200, { user }, { "Set-Cookie": `session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${IS_PRODUCTION ? "; Secure" : ""}` });
      return;
    }
    if (method === "POST" && route === "/api/login/staff") {
      const body = await readBody(req);
      if (body.username !== (process.env.STAFF_USERNAME || "helpdesk") || body.password !== (process.env.STAFF_PASSWORD || "Township!26")) {
        json(res, 401, { error: "The staff username or password is incorrect." });
        return;
      }
      const id = crypto.randomBytes(32).toString("hex");
      const user = { role: "staff", flatId: null, name: "Help desk", expiresAt: Date.now() + 8 * 60 * 60_000 };
      sessions.set(id, user);
      json(res, 200, { user }, { "Set-Cookie": `session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${IS_PRODUCTION ? "; Secure" : ""}` });
      return;
    }
    if (method === "POST" && route === "/api/logout") {
      const id = cookies(req).session;
      if (id) sessions.delete(id);
      json(res, 200, { ok: true }, { "Set-Cookie": "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
      return;
    }
    if (method === "GET" && route === "/api/data") {
      const session = requireAuth(req, res);
      if (!session) return;
      if (session.role === "resident") { json(res, 200, flatData(session.flatId)); return; }
      const flats = db.prepare("SELECT f.id,f.resident,f.area,f.days_overdue,b.id AS bill_id,b.amount,b.paid,b.amount-b.paid AS balance FROM flats f JOIN bills b ON b.flat_id=f.id ORDER BY f.id").all();
      const complaints = db.prepare("SELECT c.*,f.resident FROM complaints c JOIN flats f ON f.id=c.flat_id ORDER BY c.created_at DESC").all();
      const payments = db.prepare("SELECT p.*,f.resident FROM payments p JOIN flats f ON f.id=p.flat_id ORDER BY p.created_at DESC LIMIT 12").all();
      json(res, 200, { flats, complaints, payments });
      return;
    }
    if (method === "GET" && route === "/api/committee") {
      if (!requireAuth(req, res, "staff")) return;
      const flats = db.prepare("SELECT f.id,f.resident,f.area,f.days_overdue,b.amount,b.paid,b.amount-b.paid AS balance FROM flats f JOIN bills b ON b.flat_id=f.id ORDER BY f.id").all();
      const complaints = db.prepare("SELECT c.*,f.resident FROM complaints c JOIN flats f ON f.id=c.flat_id ORDER BY c.created_at DESC").all();
      const total = flats.reduce((sum, flat) => sum + flat.amount, 0);
      const collected = flats.reduce((sum, flat) => sum + flat.paid, 0);
      const overdue = flats.filter((flat) => flat.balance > 0).reduce((sum, flat) => sum + flat.balance, 0);
      const resolved = complaints.filter((item) => item.status === "Resolved");
      const avgResolutionHours = resolved.length ? Math.round(resolved.reduce((sum, item) => sum + (Date.parse(item.resolved_at) - Date.parse(item.created_at)) / 3_600_000, 0) / resolved.length) : null;
      json(res, 200, { flats, complaints, metrics: { billed: total, collected, overdue, collectionRate: total ? Math.round(collected / total * 100) : 0, avgResolutionHours } });
      return;
    }
    if (method === "POST" && route === "/api/payments") {
      const session = requireAuth(req, res, "resident");
      if (!session) return;
      const body = await readBody(req);
      const bill = billFor(session.flatId);
      if (!bill || body.billId !== bill.id) { json(res, 404, { error: "That bill could not be found." }); return; }
      const balance = bill.amount - bill.paid;
      if (balance <= 0) { json(res, 409, { error: "This bill is already paid." }); return; }
      const payment = sendReceipt(session.flatId, bill.id, balance, "Test payment");
      json(res, 201, { payment, bill: publicBill(billFor(session.flatId)) });
      return;
    }
    if (method === "POST" && route === "/api/complaints") {
      const session = requireAuth(req, res, "resident");
      if (!session) return;
      const body = await readBody(req);
      const description = String(body.description || "").trim();
      if (!safeString(description, 1000) || description.length < 8) { json(res, 400, { error: "Describe the issue in at least 8 characters (up to 1,000)." }); return; }
      const analysis = classifyComplaint(description);
      const open = db.prepare("SELECT id,description,category FROM complaints WHERE status != 'Resolved' ORDER BY created_at DESC").all();
      const normalized = description.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
      const duplicate = open.find((item) => {
        if (item.category !== analysis.category) return false;
        const words = item.description.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
        return normalized.filter((word) => words.includes(word)).length >= 2;
      });
      const id = `C-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const now = new Date();
      const team = analysis.category === "Gas" || analysis.category === "Fire" ? "Security" : (teams[analysis.category] ? analysis.category : "General");
      const assignedTo = analysis.urgency === "Critical" ? "Duty manager" : (teams[team][0]);
      const dueAt = new Date(now.getTime() + (analysis.urgency === "Critical" ? 15 : analysis.urgency === "High" ? 60 : 240) * 60_000);
      const complaint = { id, flat_id: session.flatId, description, category: analysis.category, urgency: analysis.urgency, status: "Open", team, assigned_to: assignedTo, created_at: now.toISOString(), due_at: dueAt.toISOString(), duplicate_of: duplicate?.id || null, signals: analysis.signals };
      db.prepare(`INSERT INTO complaints (id,flat_id,description,category,urgency,status,team,assigned_to,created_at,due_at,duplicate_of)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(complaint.id, complaint.flat_id, complaint.description, complaint.category, complaint.urgency, complaint.status, complaint.team, complaint.assigned_to, complaint.created_at, complaint.due_at, complaint.duplicate_of);
      json(res, 201, { complaint });
      return;
    }
    const complaintMatch = route.match(/^\/api\/complaints\/([^/]+)$/);
    if (method === "PATCH" && complaintMatch) {
      if (!requireAuth(req, res, "staff")) return;
      const body = await readBody(req);
      const complaint = db.prepare("SELECT * FROM complaints WHERE id=?").get(complaintMatch[1]);
      if (!complaint) { json(res, 404, { error: "Complaint not found." }); return; }
      if (body.category !== undefined) {
        if (![...Object.keys(teams), "Gas", "Fire"].includes(body.category)) { json(res, 400, { error: "Choose a valid category." }); return; }
        db.prepare("UPDATE complaints SET category=?,team=? WHERE id=?").run(body.category, ["Gas", "Fire"].includes(body.category) ? "Security" : body.category, complaint.id);
      }
      if (body.status !== undefined) {
        if (!["Open", "In progress", "Resolved"].includes(body.status)) { json(res, 400, { error: "Choose a valid status." }); return; }
        db.prepare("UPDATE complaints SET status=?,resolved_at=? WHERE id=?").run(body.status, body.status === "Resolved" ? new Date().toISOString() : null, complaint.id);
      }
      if (body.assignedTo !== undefined) {
        if (!safeString(body.assignedTo, 80)) { json(res, 400, { error: "Enter a valid assignee." }); return; }
        db.prepare("UPDATE complaints SET assigned_to=? WHERE id=?").run(body.assignedTo.trim(), complaint.id);
      }
      json(res, 200, { complaint: db.prepare("SELECT * FROM complaints WHERE id=?").get(complaint.id) });
      return;
    }
    if (method === "POST" && route === "/api/matches/preview") {
      if (!requireAuth(req, res, "staff")) return;
      const body = await readBody(req);
      if (!safeString(body.csv, 100_000)) { json(res, 400, { error: "Upload or paste a bank CSV (up to 100 KB)." }); return; }
      const rows = csvRows(body.csv);
      const batchId = crypto.randomUUID();
      const flats = db.prepare("SELECT id,upi_id FROM flats").all();
      const candidates = flats.map((flat) => ({ ...flat, balance: outstanding(flat.id) }));
      const insert = db.prepare("INSERT INTO bank_rows (id,batch_id,posted,raw_json,match_json) VALUES (?,?,0,?,?)");
      const results = rows.map((row) => {
        const match = matchStatementRow(row, candidates);
        const id = crypto.randomUUID();
        insert.run(id, batchId, JSON.stringify(row), JSON.stringify({ ...match, amount: row.amount }));
        return { id, ...row, ...match, posted: false };
      });
      json(res, 200, { batchId, rows: results });
      return;
    }
    const postMatch = route.match(/^\/api\/matches\/([^/]+)\/post$/);
    if (method === "POST" && postMatch) {
      if (!requireAuth(req, res, "staff")) return;
      const row = db.prepare("SELECT * FROM bank_rows WHERE id=?").get(postMatch[1]);
      if (!row) { json(res, 404, { error: "Statement row not found." }); return; }
      if (row.posted) { json(res, 409, { error: "This statement row has already been posted." }); return; }
      const match = JSON.parse(row.match_json);
      if (!match.flatId || match.status !== "Ready to post") { json(res, 409, { error: "Only a confident, exact-amount match can be posted. Review the row manually." }); return; }
      const bill = billFor(match.flatId);
      if (!bill || outstanding(match.flatId) !== match.amount) { json(res, 409, { error: "The balance changed. Preview the statement again before posting." }); return; }
      const payment = sendReceipt(match.flatId, bill.id, match.amount, "Bank transfer");
      db.prepare("UPDATE bank_rows SET posted=1 WHERE id=?").run(row.id);
      json(res, 201, { payment, posted: true });
      return;
    }
    if (method === "POST" && route === "/api/complaints/triage") {
      const session = requireAuth(req, res, "resident");
      if (!session) return;
      const body = await readBody(req);
      if (!safeString(body.description, 1000)) { json(res, 400, { error: "Enter a complaint description first." }); return; }
      json(res, 200, { ...classifyComplaint(body.description), engine: "Rule-based assistant" });
      return;
    }
    if (method === "GET" && route.startsWith("/api/")) { json(res, 404, { error: "API endpoint not found." }); return; }

    const relative = route === "/" ? "index.html" : decodeURIComponent(route.replace(/^\/+/, ""));
    const resolved = path.resolve(PUBLIC_DIR, relative);
    if (!resolved.startsWith(`${PUBLIC_DIR}${path.sep}`) && resolved !== path.join(PUBLIC_DIR, "index.html")) { json(res, 403, { error: "Forbidden." }); return; }
    const file = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : path.join(PUBLIC_DIR, "index.html");
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json; charset=utf-8" };
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    if (error.status) { json(res, error.status, { error: error.message }); return; }
    console.error(error);
    json(res, 500, { error: "Something went wrong. Please try again or contact the help desk." });
  }
}

const server = http.createServer((req, res) => void handle(req, res));
if (require.main === module) server.listen(PORT, HOST, () => console.log(`Sahavas is running at http://${HOST}:${PORT}`));
module.exports = { server, db, csvRows };
