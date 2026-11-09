# Sahavas Township — deployment guide

## Run locally

1. Install Node.js 22.5 or newer (the built-in `node:sqlite` module is required).
2. From the project root, run `npm test` to execute the core and API tests.
3. Run `npm start`.
4. Open `http://127.0.0.1:3000` in a browser. The SQLite database is created at `data/township.sqlite` the first time the server starts.
5. To reset demo data, stop the server and remove only `data/township.sqlite` (and its SQLite `-wal` / `-shm` sidecars if present), then start it again.

No package installation or external database is needed. The service worker caches the static app shell for a faster revisit; signed-in data and write actions require the server to be online.

## Demo sign-in

- Resident: flat `T07-1203`, OTP `246810`. Other seeded flats: `T12-0408` (Swati Joshi) and `T21-1601` (Aamir Shaikh).
- Help desk: username `helpdesk`, password `Township!26`.

These are synthetic demo credentials. The shared OTP and fixed staff password are **not production authentication**. Do not expose this demo service to real residents or use real resident, visitor, payment or contact data.

## Environment variables

The local demo has defaults; these variables may be set by the runtime. Names only:

- `NODE_ENV`
- `PORT`
- `HOST`
- `DATA_DIR`
- `DEMO_OTP`
- `STAFF_USERNAME`
- `STAFF_PASSWORD`

`NODE_ENV=production` enables the Secure cookie attribute and therefore requires HTTPS. Changing demo credentials does not make the mock OTP/password flow suitable for production.

## Deploy to Render (free demo)

The repository includes a Render Blueprint in `render.yaml`, configured for a Singapore-region **Free** web service. It binds to `0.0.0.0`, sets `NODE_ENV=production` (HTTPS-only Secure session cookies), places SQLite under `/tmp/sahavas-data`, and health-checks `/healthz`.

1. Sign in to Render and authorize access to the public `ikshith-techie/sahavas-township` GitHub repository.
2. Open the [Render deployment flow](https://render.com/deploy?repo=https://github.com/ikshith-techie/sahavas-township), review that the web service plan is **Free**, then confirm creation if you accept the limitations below.
3. Wait for the service deploy to finish. Open the `onrender.com` URL shown on the Render service page and check `/healthz` returns `{"status":"ok"}`.
4. Sign in with the demo credentials above. The app intentionally uses synthetic data only. Do not put resident data, real payment records, visitor data, or production credentials into this demo.

**Free-tier data loss is expected.** Free web services do not support persistent disks. SQLite, payment history, complaint changes and bank import previews live on ephemeral instance storage and may reset after a restart, sleep/wake, redeploy or instance replacement. This setup is for a disposable reviewer demo only—not durable accounting records. Seed rows are recreated when a fresh database is initialized.

The GitHub repository is public. A Render account is now signed in, but this workspace has not completed resource creation; the owner must review the free-plan selection and confirm creation. After deployment, add the Render URL to the TDD.

This deployment is a demo, not production-ready financial or resident-data infrastructure. Authentication, the OTP and test payments remain mocks. Do not use real resident, visitor, payment or contact data.

## Demo workflow

1. Sign in as `T07-1203` and review the maintenance bill and receipt history.
2. Use **Pay maintenance** on `T21-1601` to exercise the test payment and ledger update. No external payment is made.
3. Sign in as help desk, open **Bank matching**, load the sample CSV and preview it. Review each row; explicitly post only a confident match. Previewing alone never posts.
4. Sign in as `T12-0408`, raise a water-leak complaint, then return to the help desk and update its category or status. Safety words route to the duty manager regardless of the suggested category.
5. Open **Overview** to see the sample collection, ageing and complaint measures.

The seed contains only the three flats in the supplied problem statement. Committee totals and percentages are demonstration calculations, not a complete township report.
