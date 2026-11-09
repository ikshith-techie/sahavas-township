const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyComplaint, parseCsv, matchStatementRow } = require("../src/core");

test("classifies common complaint categories and preserves safety escalation", () => {
  assert.equal(classifyComplaint("There is water leaking from the kitchen tap.").category, "Plumbing");
  assert.equal(classifyComplaint("The lift is stuck between floors.").urgency, "Critical");
  assert.equal(classifyComplaint("I smell gas near the lobby.").assignedTo, "Duty manager");
  assert.equal(classifyComplaint("The fire alarm is going off.").category, "Fire");
});

test("parses quoted CSV fields and escaped quotes", () => {
  assert.deepEqual(parseCsv('amount,reference,upi_id\r\n7475,"UPI, T07-1203",neeraj.k@okaxis'), [
    ["amount", "reference", "upi_id"], ["7475", "UPI, T07-1203", "neeraj.k@okaxis"]
  ]);
});

test("statement matching requires an exact balance and a flat or UPI identifier", () => {
  const flats = [{ id: "T07-1203", resident: "Neeraj", upi_id: "neeraj@upi", balance: 7475 }];
  assert.equal(matchStatementRow({ amount: 7475, reference: "T07-1203", upiId: "" }, flats).status, "Ready to post");
  assert.equal(matchStatementRow({ amount: 7475, reference: "unknown", upiId: "" }, flats).status, "Needs review");
  assert.equal(matchStatementRow({ amount: 500, reference: "T07-1203", upiId: "" }, flats).status, "Unmatched");
});
