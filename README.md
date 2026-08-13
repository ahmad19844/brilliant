# BFIA Offline CBT

Windows/LAN examination system for Brilliant Footstep Int'l Academy, Sokoto. It works without internet once installed.

## Administrator setup

Install the generated NSIS installer from `release/`. Start **BFIA Offline CBT** and sign in with `admin` / `admin1234`; the application requires an immediate password change. Add exactly 50 four-option questions to each subject before publishing it. The first-release subjects are Mathematics, English, Chemistry, Physics and Biology.

Allow the app through Windows Firewall on the school private network. Students browse to `http://ADMIN-PC-IP:PORT/student` (the dashboard displays the address). Each registration receives one sequential BFIA number across all selected subjects.

Each subject is 60 minutes; answers save immediately and interrupted attempts resume. Results are scored automatically. Use the dashboard's results screen to print reports. Backup files are AES-256-GCM encrypted; retain their passwords separately and use restore only when no exam is in progress.

## Development

`npm install`, then `npm run dev`. Run `npm test` and package with `npm run dist:win`.
