const CATEGORY_RULES = [
  ["Plumbing", /\b(water|leak|leaking|pipe|tap|drain|sewage|flush|plumb)\b/i],
  ["Electrical", /\b(electric|power|wire|wiring|socket|switch|light|shock|sparking)\b/i],
  ["Lift", /\b(lift|elevator)\b/i],
  ["Housekeeping", /\b(clean|cleaning|garbage|rubbish|pest|mosquito|waste)\b/i],
  ["Security", /\b(guard|security|theft|trespass|noise)\b/i]
];
const SAFETY_WORDS = [
  ["fire", /\bfire\b/i],
  ["gas", /\bgas\b/i],
  ["lift stuck", /\b(?:lift|elevator)\s+(?:is\s+)?stuck\b/i],
  ["shock", /\bshock(?:ed)?\b/i]
];

function classifyComplaint(description) {
  const text = String(description || "");
  const signals = SAFETY_WORDS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  let category = "General";
  for (const [name, pattern] of CATEGORY_RULES) {
    if (pattern.test(text)) { category = name; break; }
  }
  if (signals.includes("fire")) category = "Fire";
  else if (signals.includes("gas")) category = "Gas";
  const urgency = signals.length ? "Critical" : /\b(urgent|flood|burst|sparking|smoke|unsafe|emergency)\b/i.test(text) ? "High" : "Normal";
  return {
    category,
    urgency,
    team: signals.length ? "Security" : category,
    assignedTo: signals.length ? "Duty manager" : (category === "General" ? "Help desk" : "Auto-assigned"),
    signals
  };
}

function parseCsv(input) {
  const text = String(input || "").replace(/^\uFEFF/, "");
  const records = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.trim())) records.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw Object.assign(new Error("CSV contains an unclosed quoted field."), { status: 400 });
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) records.push(row);
  }
  return records;
}

function matchStatementRow(row, flats) {
  const reference = String(row.reference || "").toLowerCase();
  const upiId = String(row.upiId || "").trim().toLowerCase();
  const amountMatches = flats.filter((flat) => flat.balance === row.amount);
  const referencedFlats = flats.filter((flat) => reference.includes(flat.id.toLowerCase()));
  const upiMatches = flats.filter((flat) => upiId && upiId === flat.upi_id.toLowerCase());
  if (referencedFlats.length > 1 || upiMatches.length > 1 ||
      (referencedFlats.length && upiId && (upiMatches.length !== 1 || upiMatches[0].id !== referencedFlats[0].id))) {
    return { status: "Needs review", flatId: null, resident: null, reason: "Flat reference and UPI ID are missing, ambiguous or conflict." };
  }
  const identified = referencedFlats[0] || upiMatches[0];
  if (identified && amountMatches.some((flat) => flat.id === identified.id)) {
    return { status: "Ready to post", flatId: identified.id, resident: identified.resident, reason: "Exact balance and verified flat reference." };
  }
  if (amountMatches.length) return { status: "Needs review", flatId: null, resident: null, reason: "Amount matches, but the flat reference or UPI ID is missing or different." };
  return { status: "Unmatched", flatId: null, resident: null, reason: "No outstanding flat balance matches this amount and reference." };
}

module.exports = { classifyComplaint, parseCsv, matchStatementRow };
