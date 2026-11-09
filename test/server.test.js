const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sahavas-test-"));
process.env.DATA_DIR = dataDir;
process.env.DEMO_OTP = "246810";
process.env.STAFF_USERNAME = "helpdesk";
process.env.STAFF_PASSWORD = "Township!26";
const { server, db } = require("../server");
let origin;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("deployment health check confirms the server and database are ready", async () => {
  const { response, body } = await request("/healthz");
  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
});

async function request(route, options = {}, cookie = "") {
  const response = await fetch(`${origin}${route}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...options.headers }
  });
  return { response, body: await response.json() };
}
async function loginResident(flat) {
  const { response, body } = await request("/api/login/otp", { method: "POST", body: JSON.stringify({ flat, otp: "246810" }) });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}
async function loginStaff() {
  const { response } = await request("/api/login/staff", { method: "POST", body: JSON.stringify({ username: "helpdesk", password: "Township!26" }) });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("auth protects ledgers and the resident can pay a test-mode balance", async () => {
  const anonymous = await request("/api/data");
  assert.equal(anonymous.response.status, 401);
  const resident = await loginResident("T21-1601");
  const forbidden = await request("/api/committee", {}, resident);
  assert.equal(forbidden.response.status, 403);
  const { body: data } = await request("/api/data", {}, resident);
  assert.equal(data.bill.balance, 5660);
  const payment = await request("/api/payments", { method: "POST", body: JSON.stringify({ billId: data.bill.id }) }, resident);
  assert.equal(payment.response.status, 201);
  assert.equal(payment.body.bill.balance, 0);
  assert.match(payment.body.payment.reference, /^TXN-/);
});

test("bank previews never post automatically and only exact, verified rows can post", async () => {
  const staff = await loginStaff();
  const csv = "amount,reference,upi_id\n6370,UPI/T12-0408,swati.j@okhdfcbank\n6370,unknown,\n1800,unknown,";
  const preview = await request("/api/matches/preview", { method: "POST", body: JSON.stringify({ csv }) }, staff);
  assert.equal(preview.response.status, 200);
  assert.deepEqual(preview.body.rows.map((row) => row.status), ["Ready to post", "Needs review", "Unmatched"]);
  const before = await request("/api/committee", {}, staff);
  assert.equal(before.body.metrics.collected, 18135);
  const posted = await request(`/api/matches/${preview.body.rows[0].id}/post`, { method: "POST", body: "{}" }, staff);
  assert.equal(posted.response.status, 201);
  const doublePost = await request(`/api/matches/${preview.body.rows[0].id}/post`, { method: "POST", body: "{}" }, staff);
  assert.equal(doublePost.response.status, 409);
  const after = await request("/api/committee", {}, staff);
  assert.equal(after.body.metrics.collected, 24505);
});

test("safety complaints escalate and similar reports are linked without closing them", async () => {
  const resident = await loginResident("T07-1203");
  const first = await request("/api/complaints", {
    method: "POST",
    body: JSON.stringify({ description: "Lift is stuck between floors, please help." })
  }, resident);
  assert.equal(first.response.status, 201);
  assert.equal(first.body.complaint.urgency, "Critical");
  assert.equal(first.body.complaint.assigned_to, "Duty manager");
  const duplicate = await request("/api/complaints", {
    method: "POST",
    body: JSON.stringify({ description: "The lift is stuck between floors, please help." })
  }, resident);
  assert.equal(duplicate.body.complaint.duplicate_of, first.body.complaint.id);
  assert.equal(duplicate.body.complaint.status, "Open");

  const staff = await loginStaff();
  const updated = await request(`/api/complaints/${first.body.complaint.id}`, {
    method: "PATCH",
    body: JSON.stringify({ category: "General", status: "In progress" })
  }, staff);
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.complaint.category, "General");
  assert.equal(updated.body.complaint.status, "In progress");
  const stillOpen = await request("/api/data", {}, resident);
  assert.equal(stillOpen.body.complaints.find((item) => item.id === duplicate.body.complaint.id).status, "Open");
});
