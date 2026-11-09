const app = document.querySelector("#app");
const toastEl = document.querySelector("#toast");
const state = { user: null, page: "home", data: null, committee: null, bankRows: [], loading: false, loadError: null };
let toastTimer;

const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
const dateLabel = (value, options = { day: "numeric", month: "short", year: "numeric" }) => value ? new Date(value).toLocaleDateString("en-IN", options) : "—";
const timeLabel = (value) => value ? new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";
const initials = (name) => String(name || "Resident").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const statusClass = (value) => ({ "In progress": "progress", "Open": "open", "Resolved": "resolved", "Critical": "critical", "High": "high", "Ready to post": "ready", "Paid": "paid", "Overdue": "overdue" }[value] || "");

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}
function notify(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}
function errorBanner(message) { return `<div class="error-banner">${esc(message)}</div>`; }
function button(label, action, extra = "") { return `<button class="btn ${extra}" data-action="${action}">${label}</button>`; }
function sectionHead(title, subtitle, right = "") {
  return `<div class="card-head"><div><h2 class="section-title">${title}</h2><div class="section-subtitle">${subtitle}</div></div>${right}</div>`;
}
function statusPill(value) { return `<span class="status ${statusClass(value)}">${esc(value)}</span>`; }

function loginView(error = "") {
  app.innerHTML = `<main class="login-screen">
    <section class="login-art">
      <div class="login-logo"><span class="brand-mark">s</span><span>Sahavas</span></div>
      <div class="art-copy"><div class="eyebrow">A better kind of community</div><h1>Your home,<br>in good hands.</h1><p>Maintenance, helpful updates and the people who keep your community running — all in one quiet, simple place.</p></div>
      <div class="art-stat">Thoughtfully made for the people who call this community home.</div>
    </section>
    <section class="login-main"><div class="login-box">
      <div class="eyebrow">Welcome to Sahavas</div><h2>Sign in to your home</h2><p class="login-intro">A secure sign-in for residents and the help desk.</p>
      <div class="tabs"><button class="tab active" data-action="login-tab" data-tab="resident">I'm a resident</button><button class="tab" data-action="login-tab" data-tab="staff">Help desk</button></div>
      ${error ? errorBanner(error) : ""}
      <form id="resident-login">
        <div class="field"><label class="field-label" for="login-flat">Flat number</label><input class="input" id="login-flat" name="flat" placeholder="For example, T07-1203" autocomplete="username" required></div>
        <div class="field"><label class="field-label" for="login-otp">One-time code</label><input class="input" id="login-otp" name="otp" placeholder="6-digit code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>
        <button class="btn" type="submit" style="width:100%">Continue securely <span aria-hidden="true">→</span></button>
      </form>
      <form id="staff-login" hidden>
        <div class="field"><label class="field-label" for="staff-name">Staff username</label><input class="input" id="staff-name" name="username" placeholder="Help desk username" autocomplete="username" required></div>
        <div class="field"><label class="field-label" for="staff-password">Password</label><input class="input" id="staff-password" name="password" type="password" placeholder="Your password" autocomplete="current-password" required></div>
        <button class="btn" type="submit" style="width:100%">Sign in to staff desk <span aria-hidden="true">→</span></button>
      </form>
      <div id="demo-hint" class="login-hint">Demo resident: <span class="demo-link" data-action="fill-resident">T07-1203</span> · OTP <strong>246810</strong></div>
    </div></section>
  </main>`;
}

function navigation() {
  const staff = state.user.role === "staff";
  const nav = staff
    ? [["committee", "▦", "Overview"], ["complaints", "◉", "Complaints"], ["matches", "⇄", "Bank matching"]]
    : [["home", "⌂", "Home"], ["bills", "▤", "Maintenance"], ["complaints", "◉", "Complaints"]];
  const title = { home: "Home", bills: "Maintenance", complaints: "Complaints", matches: "Bank matching", committee: "Committee overview" }[state.page] || "Home";
  return `<aside class="sidebar" id="sidebar">
    <div class="brand"><span class="brand-mark">s</span><div><div class="brand-title">Sahavas</div><div class="brand-subtitle">Township living</div></div></div>
    <div class="nav-label">${staff ? "Workspace" : "Your home"}</div><nav class="nav-list" aria-label="Main navigation">
      ${nav.map(([page, icon, label]) => `<a href="#${page}" class="nav-link ${state.page === page ? "active" : ""}" data-action="navigate" data-page="${page}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</a>`).join("")}
    </nav>
    <div class="sidebar-bottom">
      <div class="help-card"><strong>Here when you need us</strong><span>Our help desk is available every day, 8 am–8 pm.</span></div>
      <div class="user-chip"><span class="avatar">${esc(initials(state.user.name))}</span><div class="user-copy"><strong>${esc(state.user.name)}</strong><small>${staff ? "Help desk staff" : esc(state.user.flatId)}</small></div><button class="icon-button" data-action="logout" aria-label="Sign out" title="Sign out">↗</button></div>
    </div>
  </aside>
  <main class="main-area"><header class="topbar"><div class="breadcrumbs"><button class="mobile-menu" data-action="toggle-menu" aria-label="Open menu">☰</button><span>Sahavas&nbsp; / &nbsp;<strong>${title}</strong></span></div><div class="topbar-right"><span class="live-pill"><i class="live-dot"></i>Community services online</span></div></header><div class="content" id="content"></div></main>`;
}

function residentHome() {
  const { flat, bill, complaints, payments } = state.data;
  const openComplaints = complaints.filter((item) => item.status !== "Resolved");
  const balance = bill?.balance || 0;
  const overdue = (flat?.days_overdue || 0) > 0 && balance > 0;
  return `<div class="page-heading"><div><div class="eyebrow">${dateLabel(new Date(), { month: "long", year: "numeric" })} · YOUR HOME</div><h1>Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${esc((state.user.name || "").split(" ")[0])}.</h1><p>${esc(flat.id)} <span aria-hidden="true">·</span> ${flat.area.toLocaleString("en-IN")} sq ft home</p></div></div>
    <div class="grid home-grid">
      <div>
        <section class="card dues-card">
          <div class="dues-label"><span>◷</span> ${balance ? (overdue ? "Maintenance overdue" : "Maintenance due") : "All caught up"}</div>
          <div class="dues-amount">${money(balance)}</div>
          <div class="dues-foot">${bill ? `${dateLabel(bill.period + "-01", { month: "long", year: "numeric" })} bill · Due ${dateLabel(bill.due_date, { day: "numeric", month: "short" })}` : "No bill found"}</div>
          <div class="dues-actions">${balance ? `<button class="btn btn-light" data-action="pay">Pay maintenance <span aria-hidden="true">→</span></button>` : `<span class="status paid">✓ Paid in full</span>`}<button class="quiet-link" data-action="navigate" data-page="bills">View bill</button></div>
        </section>
        <div class="grid metric-row home-section">
          <section class="card metric-card"><div class="metric-label"><span>◉</span> Open complaints</div><div class="metric-value">${openComplaints.length}</div><div class="metric-caption">${openComplaints.length ? "Updates as your request moves" : "Nothing needs your attention"}</div></section>
          <section class="card metric-card"><div class="metric-label"><span>✓</span> Last payment</div><div class="metric-value" style="font-size:19px">${payments[0] ? money(payments[0].amount) : "—"}</div><div class="metric-caption">${payments[0] ? `Received ${dateLabel(payments[0].created_at)}` : "Your receipts appear here"}</div></section>
        </div>
        <section class="card card-pad home-section">
          ${sectionHead("Your requests", "Follow every issue, from the first update.", `<button class="text-link" data-action="navigate" data-page="complaints">See all →</button>`)}
          ${openComplaints.length ? openComplaints.slice(0, 2).map((item) => `<div class="complaint-preview"><span class="status-dot"></span><div style="flex:1"><strong>${esc(item.category)} · ${esc(item.id)}</strong><p>${esc(item.description)}</p></div>${statusPill(item.status)}</div>`).join("") : `<div class="empty-state"><div class="empty-icon">✓</div><strong>All quiet for now</strong><p>When you need a hand, we're right here.</p></div>`}
        </section>
      </div>
      <div>
        <section class="notice-card"><div class="notice-top"><span>FROM YOUR COMMUNITY</span><span>${dateLabel(new Date(), { day: "numeric", month: "short" })}</span></div><strong>Welcome to your Sahavas home</strong><p>Your monthly maintenance helps keep shared spaces, lifts and essential services running smoothly.</p></section>
        <div class="quick-actions"><button class="action-card" data-action="navigate" data-page="bills"><span class="action-icon">▤</span><span><strong>Maintenance</strong><small>Bill & receipts</small></span></button><button class="action-card" data-action="navigate" data-page="complaints"><span class="action-icon">＋</span><span><strong>Get help</strong><small>Raise an issue</small></span></button></div>
        <section class="card card-pad home-section"><div class="card-head"><div><h2 class="section-title">Recent activity</h2><div class="section-subtitle">A little peace of mind.</div></div></div>
          ${payments.length ? payments.slice(0, 2).map((payment) => `<div class="complaint-preview"><span class="status-dot" style="background:#75a779"></span><div style="flex:1"><strong>${esc(payment.source)}</strong><p>${dateLabel(payment.created_at)} · ${esc(payment.reference)}</p></div><strong>${money(payment.amount)}</strong></div>`).join("") : `<div class="subtle">Payments and receipts will show here.</div>`}
        </section>
      </div>
    </div>`;
}

function billView() {
  const { flat, bill, payments } = state.data;
  if (!bill) return `<div class="page-heading"><div><div class="eyebrow">YOUR ACCOUNT</div><h1>Maintenance</h1></div></div><section class="card empty-state"><div class="empty-icon">▤</div><strong>No bill available</strong><p>Please contact the help desk if you think this is a mistake.</p></section>`;
  const balance = bill.balance;
  return `<div class="page-heading"><div><div class="eyebrow">YOUR ACCOUNT · ${esc(flat.id)}</div><h1>Maintenance</h1><p>Your monthly contribution, calculated fairly by home area.</p></div></div>
    <div class="grid two-col">
      <section class="card card-pad">
        ${sectionHead(`Monthly bill · ${dateLabel(bill.period + "-01", { month: "long", year: "numeric" })}`, "Your maintenance contribution for this billing period.", statusPill(balance ? (flat.days_overdue > 0 ? "Overdue" : "Due") : "Paid"))}
        <div class="bill-total">${money(bill.amount)}</div><div class="bill-meta">${flat.area.toLocaleString("en-IN")} sq ft at ${money(bill.rate)} per sq ft / month</div>
        <div class="bill-breakdown">
          <div class="bill-line"><span>Monthly maintenance</span><strong>${money(bill.amount)}</strong></div>
          <div class="bill-line"><span>Payments received</span><strong>− ${money(bill.paid)}</strong></div>
          <div class="bill-line total"><span>Balance due</span><strong>${money(balance)}</strong></div>
        </div>
        ${flat.days_overdue > 0 && balance > 0 ? `<div class="bill-alert">This bill is ${flat.days_overdue} days overdue. Any late fee is governed by your society's approved bye-laws; this demo does not apply an unverified charge.</div>` : ""}
        ${balance ? `<button class="btn" data-action="pay">Pay ${money(balance)} securely <span aria-hidden="true">→</span></button><div class="field-help">Payment runs in test mode. No real money is moved.</div>` : `<span class="status paid">✓ Paid in full</span>`}
      </section>
      <section class="card card-pad">${sectionHead("Payment history", "Your receipts stay with your account.")}
        ${payments.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${payments.map((payment) => `<tr><td>${dateLabel(payment.created_at)}</td><td>${esc(payment.reference)}<div class="subtle">${esc(payment.source)}</div></td><td><strong>${money(payment.amount)}</strong></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><div class="empty-icon">↗</div><strong>No payments yet</strong><p>Your payment receipts will appear here.</p></div>`}
      </section>
    </div>`;
}

function complaintCard(item, staff) {
  const ageMinutes = Math.max(0, Math.round((Date.now() - Date.parse(item.created_at)) / 60000));
  const due = Date.parse(item.due_at);
  const sla = item.status !== "Resolved" && due < Date.now() ? `<span class="status overdue">Response due</span>` : `<span class="meta-chip">Response by ${timeLabel(item.due_at)}</span>`;
  return `<article class="card complaint-card">
    <div class="complaint-top"><div><div class="complaint-id">${esc(item.id)}${staff ? ` · ${esc(item.flat_id)} · ${esc(item.resident || "")}` : ""}</div><h3>${esc(item.category)} issue</h3></div>${statusPill(item.urgency === "Critical" ? "Critical" : item.status)}</div>
    <p>${esc(item.description)}</p>
    ${item.duplicate_of ? `<span class="duplicate-note">Linked to ${esc(item.duplicate_of)} · separate request, not closed</span>` : ""}
    <div class="complaint-meta"><span class="meta-chip">${esc(item.team)} · ${esc(item.assigned_to)}</span><span class="meta-chip">Logged ${ageMinutes < 60 ? `${ageMinutes} min ago` : dateLabel(item.created_at)}</span>${sla}</div>
    ${staff ? `<div class="complaint-controls">
      <label class="subtle" for="cat-${esc(item.id)}">Category</label><select class="select-small" id="cat-${esc(item.id)}" data-action="category" data-id="${esc(item.id)}">${["General","Plumbing","Electrical","Lift","Housekeeping","Security","Gas","Fire"].map((cat) => `<option ${item.category === cat ? "selected" : ""}>${cat}</option>`).join("")}</select>
      <label class="subtle" for="status-${esc(item.id)}">Status</label><select class="select-small" id="status-${esc(item.id)}" data-action="status" data-id="${esc(item.id)}">${["Open","In progress","Resolved"].map((status) => `<option ${item.status === status ? "selected" : ""}>${status}</option>`).join("")}</select>
    </div>` : ""}
  </article>`;
}

function complaintView() {
  const staff = state.user.role === "staff";
  const items = staff ? state.data.complaints : state.data.complaints;
  const sorted = [...items].sort((a, b) => (a.status === "Resolved") - (b.status === "Resolved") || Date.parse(b.created_at) - Date.parse(a.created_at));
  return `<div class="page-heading"><div><div class="eyebrow">${staff ? "SERVICE DESK" : "YOUR HOME · SUPPORT"}</div><h1>${staff ? "Complaint queue" : "A hand when you need it"}</h1><p>${staff ? "Triage, assign and keep every resident in the loop." : "Tell us what needs attention. We'll keep you posted."}</p></div>${!staff ? `<button class="btn" data-action="new-complaint">＋ New request</button>` : ""}</div>
    ${!staff ? `<section class="card form-card" id="complaint-form-card" hidden><div class="card-head"><div><h2 class="section-title">Tell us what's going on</h2><div class="section-subtitle">A little detail helps us send the right person.</div></div><button class="icon-button" data-action="close-form" aria-label="Close">✕</button></div>
      <form id="complaint-form"><div class="field"><label class="field-label" for="complaint-description">Describe the issue</label><textarea class="textarea" id="complaint-description" name="description" placeholder="For example: water is leaking under the kitchen sink…" maxlength="1000" required></textarea><p class="field-help">Our assistant suggests a category and urgency. You can ask the help desk to change it.</p></div><div id="triage-result"></div><div class="page-toolbar"><button class="btn btn-outline btn-small" type="button" data-action="triage">✦ Suggest category</button><button class="btn btn-small" type="submit">Send request →</button></div></form>
      </section><div style="height:14px"></div>` : ""}
    ${sorted.length ? `<div class="complaint-list">${sorted.map((item) => complaintCard(item, staff)).join("")}</div>` : `<section class="card empty-state"><div class="empty-icon">◉</div><strong>${staff ? "The queue is clear" : "No requests yet"}</strong><p>${staff ? "New resident requests will appear here." : "If anything needs a repair or a closer look, let us know."}</p></section>`}`;
}

const sampleCsv = `date,amount,reference,upi_id
${new Date().toISOString().slice(0, 10)},6370,UPI/T12-0408/swati.j@okhdfcbank,swati.j@okhdfcbank
${new Date().toISOString().slice(0, 10)},5660,UPI/T21-1601/aamir.s@okicici,aamir.s@okicici
${new Date().toISOString().slice(0, 10)},1800,NEFT/UNKNOWN/flat not provided,`;
function matchesView() {
  const rows = state.bankRows;
  return `<div class="page-heading"><div><div class="eyebrow">RECONCILIATION · STAFF ONLY</div><h1>Bank matching</h1><p>Review confidence before anything is posted to a resident's ledger.</p></div><span class="status ready">Nothing posts automatically</span></div>
    <div class="grid two-col">
      <section class="card form-card">
        ${sectionHead("Import a bank statement", "CSV only · amount and reference are required.", `<button class="text-link" data-action="sample-csv">Use sample CSV</button>`)}
        <div class="field"><label class="field-label" for="csv-file">Choose a CSV file</label><input class="input" type="file" id="csv-file" accept=".csv,text/csv"><p class="field-help">The statement is processed on this server and is not sent to an external service.</p></div>
        <div class="field"><label class="field-label" for="csv-input">Or paste statement rows</label><textarea class="textarea csv-box" id="csv-input" spellcheck="false" placeholder="amount,reference,upi_id&#10;6370,UPI/T12-0408/swati.j@okhdfcbank,swati.j@okhdfcbank"></textarea></div>
        <button class="btn" data-action="preview-csv">Preview matches <span aria-hidden="true">→</span></button>
      </section>
      <section class="card card-pad">
        ${sectionHead("Matching safeguards", "A confident suggestion is still a human decision.")}
        <div class="complaint-preview"><span class="status-dot" style="background:#75a779"></span><div><strong>Exact amount</strong><p>Must equal one flat's open balance, not just a similar figure.</p></div></div>
        <div class="complaint-preview"><span class="status-dot" style="background:#75a779"></span><div><strong>Verified reference</strong><p>Must include a flat reference or match the resident's UPI ID.</p></div></div>
        <div class="complaint-preview"><span class="status-dot" style="background:#d7a24f"></span><div><strong>Unclear stays in queue</strong><p>Ambiguous or unmatched rows never post to a flat automatically.</p></div></div>
      </section>
    </div>
    ${rows.length ? `<section class="card card-pad home-section">${sectionHead(`Statement review · ${rows.length} rows`, "Post only an exact, verified match. Re-import to refresh after a ledger changes.")}${rows.map((row) => `<div class="match-row"><div><strong>${money(row.amount)}</strong><small>${esc(row.reference)}${row.upiId ? ` · ${esc(row.upiId)}` : ""}</small></div><div><strong>${esc(row.flatId || "No flat selected")}</strong><small>${esc(row.resident || row.reason)}</small></div><div class="match-state">${statusPill(row.posted ? "Paid" : row.status)}</div><div>${row.posted ? `<span class="subtle">Posted</span>` : row.status === "Ready to post" ? `<button class="btn btn-small" data-action="post-match" data-id="${esc(row.id)}">Post to ledger</button>` : `<span class="subtle">Review manually</span>`}</div></div>`).join("")}</section>` : `<section class="card empty-state home-section"><div class="empty-icon">⇄</div><strong>Ready when you are</strong><p>Import a statement to see exact matches and rows that need a closer look.</p></section>`}`;
}

function committeeView() {
  const { metrics, flats, complaints } = state.committee;
  const totalComplaints = complaints.length;
  const avg = metrics.avgResolutionHours == null ? "—" : `${metrics.avgResolutionHours}h`;
  const groups = [
    { label: "1–10 days", min: 1, max: 10 },
    { label: "11–30 days", min: 11, max: 30 },
    { label: "31+ days", min: 31, max: Infinity }
  ].map((group) => ({ ...group, flats: flats.filter((flat) => flat.balance > 0 && flat.days_overdue >= group.min && flat.days_overdue <= group.max) }));
  const highestDues = [...flats].filter((flat) => flat.balance > 0).sort((a, b) => b.days_overdue - a.days_overdue);
  return `<div class="page-heading"><div><div class="eyebrow">FEDERATION · MONTHLY SNAPSHOT</div><h1>A clear view of the community.</h1><p>${dateLabel(new Date(), { month: "long", year: "numeric" })} · ${flats.length.toLocaleString("en-IN")} active demo accounts</p></div><button class="btn btn-outline" data-action="refresh">↻ Refresh</button></div>
    <div class="grid metrics-grid">
      <section class="card stat-card"><div class="metric-label">Maintenance billed</div><div class="metric-value">${money(metrics.billed)}</div><div class="stat-accent"></div></section>
      <section class="card stat-card"><div class="metric-label">Collected to date</div><div class="metric-value">${money(metrics.collected)}</div><div class="progress-track"><div class="progress-bar" style="width:${Math.min(100, metrics.collectionRate)}%"></div></div><div class="metric-caption">${metrics.collectionRate}% of billed maintenance</div></section>
      <section class="card stat-card"><div class="metric-label">Outstanding dues</div><div class="metric-value">${money(metrics.overdue)}</div><div class="metric-caption">${flats.filter((flat) => flat.balance > 0).length} accounts with a balance</div></section>
      <section class="card stat-card"><div class="metric-label">Avg. resolution time</div><div class="metric-value">${avg}</div><div class="metric-caption">${totalComplaints} complaint${totalComplaints === 1 ? "" : "s"} in this sample</div></section>
    </div>
    <div class="grid two-col home-section">
      <section class="card card-pad">${sectionHead("Dues ageing", "Open maintenance balances, grouped by days overdue.", `<span class="subtle">${money(metrics.overdue)} total</span>`)}
        ${groups.map((group) => { const amount = group.flats.reduce((sum, flat) => sum + flat.balance, 0); const width = metrics.overdue ? amount / metrics.overdue * 100 : 0; return `<div class="aging-row"><span>${group.label}</span><div class="aging-track"><div class="aging-bar" style="width:${width}%"></div></div><span class="aging-value">${money(amount)}</span></div>`; }).join("")}
        <div class="field-help">Ageing follows the sample data supplied for this demo; this is not a full-cohort forecast.</div>
      </section>
      <section class="card card-pad">${sectionHead("Service health", "Open and resolved requests across the sample.")}
        ${complaints.length ? `<div class="complaint-preview"><span class="status-dot" style="background:#d7a24f"></span><div style="flex:1"><strong>${complaints.filter((item) => item.status !== "Resolved").length} open</strong><p>Across ${new Set(complaints.filter((item) => item.status !== "Resolved").map((item) => item.flat_id)).size} homes</p></div></div><div class="complaint-preview"><span class="status-dot" style="background:#75a779"></span><div style="flex:1"><strong>${complaints.filter((item) => item.status === "Resolved").length} resolved</strong><p>Average resolution ${avg}</p></div></div>` : `<div class="empty-state"><div class="empty-icon">✓</div><strong>No complaint history yet</strong><p>Service measures will appear as requests are resolved.</p></div>`}
      </section>
    </div>
    <section class="card card-pad home-section">${sectionHead("Accounts to follow up", "Sorted by oldest outstanding balance.", `<button class="text-link" data-action="navigate" data-page="matches">Go to bank matching →</button>`)}
      <div class="table-wrap"><table><thead><tr><th>Home</th><th>Area</th><th>Monthly bill</th><th>Paid</th><th>Balance</th><th>Days overdue</th></tr></thead><tbody>${highestDues.length ? highestDues.map((flat) => `<tr><td class="flat-cell"><strong>${esc(flat.id)}</strong><small>${esc(flat.resident)}</small></td><td>${flat.area.toLocaleString("en-IN")} sq ft</td><td>${money(flat.amount)}</td><td>${money(flat.paid)}</td><td><strong>${money(flat.balance)}</strong></td><td>${flat.days_overdue} days</td></tr>`).join("") : `<tr><td colspan="6" class="subtle">No outstanding balances.</td></tr>`}</tbody></table></div>
    </section>`;
}

function render() {
  if (!state.user) { loginView(); return; }
  app.innerHTML = navigation();
  const content = document.querySelector("#content");
  if (state.loading) { content.innerHTML = `<div class="page-heading"><div><div class="eyebrow">SAHAVAS</div><h1>Just a moment…</h1></div></div><section class="card card-pad"><div class="skeleton" style="width:28%;margin-bottom:18px"></div><div class="skeleton" style="width:100%;height:130px"></div></section>`; return; }
  if (state.loadError) { content.innerHTML = `${errorBanner(state.loadError)}<button class="btn btn-outline" data-action="refresh">Try again</button>`; return; }
  if (state.page === "home" && state.user.role === "resident") content.innerHTML = residentHome();
  else if (state.page === "bills" && state.user.role === "resident") content.innerHTML = billView();
  else if (state.page === "complaints") content.innerHTML = complaintView();
  else if (state.page === "matches" && state.user.role === "staff") content.innerHTML = matchesView();
  else content.innerHTML = committeeView();
}

async function refreshData() {
  state.loading = true;
  state.loadError = null;
  render();
  try {
    if (state.user.role === "staff") {
      state.data = await api("/api/data");
      state.committee = await api("/api/committee");
    } else state.data = await api("/api/data");
  } catch (error) {
    state.loadError = error.message;
  } finally { state.loading = false; render(); }
}
async function navigate(page) {
  state.page = page;
  document.querySelector("#sidebar")?.classList.remove("open");
  render();
  if (state.user.role === "staff" && (page === "committee" || page === "complaints" || page === "matches")) await refreshData();
}
async function login(endpoint, values) {
  try {
    const result = await api(endpoint, { method: "POST", body: JSON.stringify(values) });
    state.user = result.user;
    state.page = result.user.role === "staff" ? "committee" : "home";
    await refreshData();
  } catch (error) {
    loginView(error.message);
    if (endpoint.endsWith("/staff")) {
      document.querySelector('[data-tab="staff"]')?.click();
      const username = document.querySelector("#staff-name");
      if (username) username.value = values.username || "";
    }
  }
}
async function postComplaint(form) {
  const values = Object.fromEntries(new FormData(form));
  try {
    const result = await api("/api/complaints", { method: "POST", body: JSON.stringify(values) });
    notify(result.complaint.urgency === "Critical" ? "Safety concern escalated to the duty manager." : "Your request is with the right team.");
    await refreshData();
  } catch (error) { notify(error.message); }
}
async function triage() {
  const description = document.querySelector("#complaint-description")?.value || "";
  try {
    const result = await api("/api/complaints/triage", { method: "POST", body: JSON.stringify({ description }) });
    document.querySelector("#triage-result").innerHTML = `<div class="ai-box"><strong>✦ ${esc(result.engine)} suggestion</strong><br>${esc(result.category)} · ${esc(result.urgency)} urgency${result.signals.length ? ` · Safety rule: ${esc(result.signals.join(", "))} → duty manager` : ""}<br><span class="subtle">You can continue to submit; staff can change the category.</span></div>`;
  } catch (error) { notify(error.message); }
}
async function previewCsv() {
  const csv = document.querySelector("#csv-input")?.value || "";
  try {
    const result = await api("/api/matches/preview", { method: "POST", body: JSON.stringify({ csv }) });
    state.bankRows = result.rows;
    render();
    notify(`${result.rows.length} statement rows checked. Nothing was posted.`);
  } catch (error) { notify(error.message); }
}
async function patchComplaint(id, values) {
  try {
    await api(`/api/complaints/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) });
    notify("Complaint updated.");
    await refreshData();
  } catch (error) { notify(error.message); await refreshData(); }
}

document.addEventListener("submit", (event) => {
  if (event.target.id === "resident-login") {
    event.preventDefault();
    login("/api/login/otp", Object.fromEntries(new FormData(event.target)));
  }
  if (event.target.id === "staff-login") {
    event.preventDefault();
    login("/api/login/staff", Object.fromEntries(new FormData(event.target)));
  }
  if (event.target.id === "complaint-form") {
    event.preventDefault();
    postComplaint(event.target);
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "csv-file" && event.target.files?.[0]) {
    const file = event.target.files[0];
    if (file.size > 100_000) { notify("Please choose a CSV under 100 KB."); event.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => { const input = document.querySelector("#csv-input"); if (input) input.value = String(reader.result || ""); };
    reader.onerror = () => notify("Could not read that file. Try pasting the CSV instead.");
    reader.readAsText(file);
  }
  if (event.target.dataset.action === "category") patchComplaint(event.target.dataset.id, { category: event.target.value });
  if (event.target.dataset.action === "status") patchComplaint(event.target.dataset.id, { status: event.target.value });
});
document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "login-tab") {
    const staff = target.dataset.tab === "staff";
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === target));
    document.querySelector("#resident-login").hidden = staff;
    document.querySelector("#staff-login").hidden = !staff;
    document.querySelector("#demo-hint").hidden = staff;
  } else if (action === "fill-resident") {
    document.querySelector("#login-flat").value = "T07-1203";
    document.querySelector("#login-otp").value = "246810";
  } else if (action === "navigate") {
    event.preventDefault();
    await navigate(target.dataset.page);
  } else if (action === "toggle-menu") document.querySelector("#sidebar")?.classList.toggle("open");
  else if (action === "logout") {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    state.user = null; state.data = null; state.committee = null; state.bankRows = [];
    loginView();
  } else if (action === "refresh") await refreshData();
  else if (action === "pay") {
    target.disabled = true;
    try {
      const result = await api("/api/payments", { method: "POST", body: JSON.stringify({ billId: state.data.bill.id }) });
      notify(`Payment successful · receipt ${result.payment.reference}`);
      await refreshData();
    } catch (error) { target.disabled = false; notify(error.message); }
  } else if (action === "new-complaint") {
    const form = document.querySelector("#complaint-form-card");
    form.hidden = false;
    document.querySelector("#complaint-description")?.focus();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action === "close-form") document.querySelector("#complaint-form-card").hidden = true;
  else if (action === "triage") await triage();
  else if (action === "sample-csv") document.querySelector("#csv-input").value = sampleCsv;
  else if (action === "preview-csv") await previewCsv();
  else if (action === "post-match") {
    target.disabled = true;
    try {
      await api(`/api/matches/${encodeURIComponent(target.dataset.id)}/post`, { method: "POST", body: "{}" });
      state.bankRows = state.bankRows.map((row) => row.id === target.dataset.id ? { ...row, posted: true } : row);
      render();
      notify("Payment posted to the flat ledger and receipt created.");
    } catch (error) { target.disabled = false; notify(error.message); }
  }
});

async function start() {
  try {
    const result = await api("/api/session");
    if (!result.user) { state.user = null; loginView(); return; }
    state.user = result.user;
    state.page = result.user.role === "staff" ? "committee" : "home";
    await refreshData();
  } catch { state.user = null; loginView(); }
}
start();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
