# Deploy BFIA CBT Online on Render

This project is now prepared for a **paid Render Starter web service with a 1 GB persistent disk**. The persistent disk is required because the system uses SQLite; without it, registrations, questions, answers, and results disappear when the service restarts or is redeployed.

## What changes online

- The Electron application remains available for offline school-LAN use.
- The Render service exposes the student page at `https://YOUR-SERVICE.onrender.com/student/` and the administrator dashboard at `https://YOUR-SERVICE.onrender.com/admin/`.
- Each student now needs both their BFIA number and a six-digit access code. The code is displayed once immediately after registration; record it on the student’s receipt.
- Use a paid service. Render free services have no persistent disk and can sleep, which is unsuitable for an examination system.

## Deploy

1. Create a private GitHub repository and upload this project, including `render.yaml` and `package-lock.json`. Do not upload `node_modules`, `release`, local `data`, or a database file.
2. Create or sign in to a Render account.
3. In Render, select **New** then **Blueprint** and connect the GitHub repository.
4. Confirm the `bfia-cbt-online` service from `render.yaml`. Choose the preferred region if Frankfurt is not appropriate for your school.
5. Create the Blueprint. Render installs dependencies, attaches the persistent disk at `/var/data`, and starts the service on Render’s assigned `PORT`.
6. When the deploy is live, open the public URL shown by Render. Check `https://YOUR-SERVICE.onrender.com/healthz`; it should return `{ "status": "ok" }`.
7. Visit `/admin/`, sign in with `admin` / `admin1234`, and change the password immediately.
8. Add and publish exactly 50 questions for each subject before registering students.

## Essential operations

- Keep the service on one instance. A SQLite database on a persistent disk cannot be shared safely across multiple Render instances.
- Do not change the persistent-disk mount path after students have registered.
- Use the dashboard’s encrypted backup feature before and after each exam session. Retain the backup password separately.
- Do not perform a Restore while an examination is in progress.
- Restrict administrator credentials to trusted staff. The app uses secure, same-site cookies in the hosted environment and limits repeated login attempts.

## Data migration

The offline database is separate from the hosted database. To move existing offline data online, create an encrypted backup from the offline app, then use the online admin restore flow only during a planned maintenance window. Existing registrations will receive an access code during database migration; issue those codes to candidates before they continue.

## Important limitations

This first online edition uses SQLite on one persistent disk. It is appropriate for a modest, single-school deployment but not for multiple simultaneously scaled web servers. A later PostgreSQL migration is recommended for larger use, high availability, or multiple campuses.
