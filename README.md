# Sahavas Township

A polished, responsive demo for three resident accounts and a help desk, built around the core brief: maintenance billing and test payments, complaint triage/status, manual-confirmation bank CSV matching, and a committee snapshot.

## Run

Requires Node.js 22.5+ (built-in SQLite). From this directory:

```powershell
npm test
npm start
```

Open `http://127.0.0.1:3000`. Demo logins, environment variable names, workflows and limitations are in [deployment.md](./deployment.md). The design rationale and assumptions are in [Technical-Design.pdf](./Technical-Design.pdf).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ikshith-techie/sahavas-township)

The Render blueprint uses a paid Starter web service and a 1 GB persistent disk for SQLite. Review the current charges in Render before confirming deployment.

## Important demo limits

- Authentication, payment and bank matching are test-only. No SMS, payment gateway, bank or accounting system is connected.
- Complaint triage is a deterministic, local rule-based assistant, not a trained AI model.
- The database is seeded with only the three synthetic flats in the brief, not the full township.
- Do not use real resident, visitor, payment or contact data.
