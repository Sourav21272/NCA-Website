# NCA Web

Full-stack foundation for the Notunpara Cricket Association.

## Stack

- React and Vite
- FastAPI and SQLAlchemy
- SQLite for local development
- pdfplumber and Tesseract OCR for scorecards

## Run locally

1. `npm install`
2. `python -m pip install -r backend/requirements.txt`
3. Install the Tesseract OCR executable and make it available on `PATH`, or set `TESSERACT_CMD` in `.env`.
4. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`.
5. Run `npm run api`
6. In another terminal, run `npm run dev`
7. Open `http://127.0.0.1:5173`

API documentation: `http://127.0.0.1:8000/docs`

## Build and run the API with Docker

The API image installs Tesseract. Use a persistent Docker volume for the SQLite database and uploaded files:

```powershell
docker build -t nca-api .
docker run --rm -p 8000:8000 --env-file .env -e DATABASE_URL=sqlite:////data/nca.db -e UPLOAD_DIR=/data/uploads -e EXPORT_DIR=/data/exports -e TESSERACT_CMD=/usr/bin/tesseract -v nca-data:/data nca-api
```

Set a strong `JWT_SECRET` in `.env` before starting the container. For production, attach persistent storage to `/data`; the container's own filesystem is not a durable location for the database or uploads. `.dockerignore` excludes local environment files, database files, secrets, uploads, and frontend dependencies from the Docker build context.

## Configuration

Copy `.env.example` to `.env`. Set a strong `JWT_SECRET` and a persistent `DATABASE_URL` for production. SQLite is suitable for a single API instance with persistent storage; a multi-instance deployment needs PostgreSQL and a compatible database driver/migration setup. The API reads `.env` when it starts. Never commit `.env` or share its credentials. `ADMIN_EMAIL` and `ADMIN_PASSWORD` can bootstrap the owner account once when the admin table is empty. On Render, set them as environment variables or provide Secret Files with those exact filenames (mounted under `/etc/secrets`); environment variables take precedence. Otherwise, use the private setup script below.

## Accounts and access

- All site pages and read APIs require a valid account session. Visitors can create a member account using **Create account** at `/register`, then sign in at `/login`. Member accounts cannot grant administrator or player access.
- Player accounts are separate and must be created or reset by the administrator. They sign in at `/player/login`.
- There is no public admin registration. Create the single owner account from a private terminal with `python backend/create_admin.py`; it prompts for an email and a unique password (at least 12 characters). The setup script refuses to create another admin once the owner account exists.
- The admin dashboard at `/admin` and all write/scorecard-review API routes require that owner account's sign-in. Do not share the password or expose terminal/database access to other users.
- Member registration and sign-in do not require email or SMTP. Email-based verification and self-service password recovery are disabled; there is currently no member self-service password-reset flow.

Scorecard uploads extract embedded text and use OCR for image-only pages when Tesseract is installed. OCR status is shown with each uploaded scorecard; the administrator must review and correct match details and every statistic before approving. Only approved scorecards update player career totals and rankings. A ranking snapshot is recorded on each approval; history begins with the first approval after this feature is installed.

## Included

- Responsive public pages
- Database-backed players, matches, reports, announcements and rules
- Player creation and ranking endpoints
- PDF upload, SHA-256 duplicate prevention, text extraction and OCR fallback
- Pending/approved scorecard workflow
- Admin editing for players, fixtures, reports, announcements and rules
- Ranking snapshots and history
- Admin-only Excel backup of database tables (password hashes and email action tokens are excluded)

The Excel backup is generated from SQLite by **Download Excel backup** on the admin overview and saved as `backend/exports/nca_data_export.xlsx` (or the configured `EXPORT_DIR`). Uploaded PDF and image files are not embedded in the workbook; their database records are exported, while the files remain in persistent upload storage.

No fabricated player records or production credentials are included. Replace the trophy emblem component with the official NCA logo before deployment.
