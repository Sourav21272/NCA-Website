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
4. Copy `.env.example` to `.env` and configure SMTP settings for account verification and password recovery.
5. Run `npm run api`
6. In another terminal, run `npm run dev`
7. Open `http://127.0.0.1:5173`

API documentation: `http://127.0.0.1:8000/docs`

## Configuration

Copy `.env.example` to `.env`. Set a strong `JWT_SECRET` and a PostgreSQL `DATABASE_URL` for production. The API reads `.env` when it starts. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `FRONTEND_URL` using your local mail provider’s settings. Use `SMTP_USE_SSL=true` for implicit TLS, or leave it false to use STARTTLS (`SMTP_STARTTLS=true`). Never commit `.env` or share its credentials. `ADMIN_EMAIL` and `ADMIN_PASSWORD` can bootstrap the owner account once when the admin table is empty; otherwise use the private setup script below.

## Accounts and access

- All site pages and read APIs require a valid account session. Visitors can create a member account using **Create account** at `/register`, then sign in at `/login`. Member accounts cannot grant administrator or player access.
- Player accounts are separate and must be created or reset by the administrator. They sign in at `/player/login`.
- There is no public admin registration. Create the single owner account from a private terminal with `python backend/create_admin.py`; it prompts for an email and a unique password (at least 12 characters). The setup script refuses to create another admin once the owner account exists.
- The admin dashboard at `/admin` and all write/scorecard-review API routes require that owner account's sign-in. Do not share the password or expose terminal/database access to other users.
- New member accounts require a verified email before sign-in. Verification links expire after 24 hours; password reset links expire after one hour and can only be used once. Existing accounts created before email support have no email address and can continue signing in, but must be recreated or migrated with a verified email to use password recovery.

Scorecard uploads extract embedded text and use OCR for image-only pages when Tesseract is installed. OCR status is shown with each uploaded scorecard; the administrator must review and correct match details and every statistic before approving. Only approved scorecards update player career totals and rankings. A ranking snapshot is recorded on each approval; history begins with the first approval after this feature is installed.

## Included

- Responsive public pages
- Database-backed players, matches, reports, announcements and rules
- Player creation and ranking endpoints
- PDF upload, SHA-256 duplicate prevention, text extraction and OCR fallback
- Pending/approved scorecard workflow
- Admin editing for players, fixtures, reports, announcements and rules
- Ranking snapshots and history
- Member email verification and password recovery over configured SMTP

No fabricated player records or production credentials are included. Replace the trophy emblem component with the official NCA logo before deployment.
