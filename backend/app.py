import hashlib
import json
import os
import re
import secrets
import shutil
from pathlib import Path
from datetime import datetime, timedelta, timezone

import pdfplumber
import pypdfium2 as pdfium
import pytesseract
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from jose import JWTError, jwt
from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from database import Base, engine, get_db
from models import Admin, Announcement, DailyReport, Match, Member, Player, Rule, Scorecard, Team, ActivityLog, BattingStat, BowlingStat, RankingSnapshot, RankingEntry

Base.metadata.create_all(bind=engine)
with engine.begin() as connection:
    player_columns = {column["name"] for column in inspect(engine).get_columns("players")}
    if "username" not in player_columns:
        connection.execute(text("ALTER TABLE players ADD COLUMN username VARCHAR(120)"))
    if "password_hash" not in player_columns:
        connection.execute(text("ALTER TABLE players ADD COLUMN password_hash VARCHAR(255)"))
    if "bowling_runs_conceded" not in player_columns:
        connection.execute(text("ALTER TABLE players ADD COLUMN bowling_runs_conceded INTEGER DEFAULT 0"))
    if "bowling_overs" not in player_columns:
        connection.execute(text("ALTER TABLE players ADD COLUMN bowling_overs FLOAT DEFAULT 0"))
    if "best_bowling_wickets" not in player_columns:
        connection.execute(text("ALTER TABLE players ADD COLUMN best_bowling_wickets INTEGER DEFAULT 0"))
    if "best_bowling_runs" not in player_columns:
        connection.execute(text("ALTER TABLE players ADD COLUMN best_bowling_runs INTEGER DEFAULT 0"))
    connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_players_username_nocase ON players(username COLLATE NOCASE) WHERE username IS NOT NULL"))
    scorecard_columns = {column["name"] for column in inspect(engine).get_columns("scorecards")}
    if "review_data" not in scorecard_columns:
        connection.execute(text("ALTER TABLE scorecards ADD COLUMN review_data TEXT DEFAULT '{}'"))
    if "extraction_status" not in scorecard_columns:
        connection.execute(text("ALTER TABLE scorecards ADD COLUMN extraction_status VARCHAR(80) DEFAULT 'text_extracted'"))
    member_columns = {column["name"] for column in inspect(engine).get_columns("members")}
    if "email" not in member_columns:
        connection.execute(text("ALTER TABLE members ADD COLUMN email VARCHAR(254)"))
    if "email_verified" not in member_columns:
        connection.execute(text("ALTER TABLE members ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT 0"))
    connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_members_email_nocase ON members(email COLLATE NOCASE) WHERE email IS NOT NULL"))
    connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_members_username_nocase ON members(username COLLATE NOCASE)"))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR = Path(os.getenv("EXPORT_DIR", str(Path(__file__).resolve().parent / "exports")))
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    secret_path = Path(__file__).with_name(".jwt_secret")
    if not secret_path.exists():
        secret_path.write_text(secrets.token_urlsafe(48), encoding="utf-8")
    JWT_SECRET = secret_path.read_text(encoding="utf-8").strip()
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
bearer = HTTPBearer(auto_error=False)
with engine.begin() as connection:
    admin_count = connection.execute(text("SELECT COUNT(*) FROM admins")).scalar_one()
    if admin_count == 0 and os.getenv("ADMIN_EMAIL") and os.getenv("ADMIN_PASSWORD"):
        if len(os.getenv("ADMIN_PASSWORD")) < 12:
            raise RuntimeError("ADMIN_PASSWORD must be at least 12 characters")
        connection.execute(
            text("INSERT INTO admins (name, email, password_hash, role, active) VALUES (:name, :email, :password_hash, 'super_admin', 1)"),
            {
                "name": os.getenv("ADMIN_NAME", "NCA Administrator"),
                "email": os.getenv("ADMIN_EMAIL").strip().lower(),
                "password_hash": pwd_context.hash(os.getenv("ADMIN_PASSWORD")),
            },
        )

app = FastAPI(title="NCA Platform API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


def create_access_token(subject: str, role: str, entity_id: int):
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": subject,
        "role": role,
        "id": entity_id,
        "iat": now,
        "exp": now + timedelta(hours=12),
    }, JWT_SECRET, algorithm=JWT_ALGORITHM)


def current_identity(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    if not credentials:
        raise HTTPException(401, "Please sign in")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        role = payload.get("role")
        entity_id = int(payload["id"])
    except (JWTError, KeyError, TypeError, ValueError):
        raise HTTPException(401, "Session expired or invalid")
    if role not in {"admin", "player", "member"}:
        raise HTTPException(401, "Session expired or invalid")
    entity_type = {"admin": Admin, "player": Player, "member": Member}[role]
    entity = db.get(entity_type, entity_id)
    if not entity or (role in {"admin", "member"} and not entity.active) or (role == "player" and not entity.username):
        raise HTTPException(401, "Account is unavailable")
    return {"role": role, "id": entity_id, "entity": entity}


def require_admin(identity=Depends(current_identity)):
    if identity["role"] != "admin":
        raise HTTPException(403, "Administrator access required")
    return identity


def require_player(identity=Depends(current_identity)):
    if identity["role"] != "player":
        raise HTTPException(403, "Player access required")
    return identity


def require_member(identity=Depends(current_identity)):
    if identity["role"] != "member":
        raise HTTPException(403, "Member access required")
    return identity


class LoginIn(BaseModel):
    username: str
    password: str = Field(min_length=1, max_length=72)


class MemberRegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    username: str = Field(min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=254)
    password: str = Field(min_length=12, max_length=72)


class PlayerAccountIn(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=72)


class BattingReview(BaseModel):
    player_id: int
    runs: int = 0
    balls: int = 0
    fours: int = 0
    sixes: int = 0


class BowlingReview(BaseModel):
    player_id: int
    wickets: int = 0
    runs_conceded: int = 0
    overs: float = 0


class ScorecardReview(BaseModel):
    match_id: int | None = None
    title: str = ""
    match_date: datetime | None = None
    venue: str = ""
    result: str = ""
    batting: list[BattingReview] = []
    bowling: list[BowlingReview] = []


def suggest_scorecard_rows(text_content: str, players: list[Player]):
    mode = ""
    batting = {}
    bowling = {}
    for line in text_content.splitlines():
        normalized = line.lower()
        if "bowling" in normalized and any(word in normalized for word in ("analysis", "figures", "bowler")):
            mode = "bowling"
            continue
        if "batter" in normalized or "batsman" in normalized or "batting" in normalized:
            mode = "batting"
            continue
        if mode not in {"batting", "bowling"}:
            continue
        for player in players:
            match = re.search(rf"\b{re.escape(player.name)}\b", line, re.IGNORECASE)
            if not match:
                continue
            values = re.findall(r"(?<![A-Za-z])\d+(?:\.\d+)?", line[match.end():])
            if mode == "batting" and len(values) >= 4:
                batting[player.id] = {
                    "player_id": player.id,
                    "runs": int(float(values[0])),
                    "balls": int(float(values[1])),
                    "fours": int(float(values[2])),
                    "sixes": int(float(values[3])),
                }
            elif mode == "bowling" and len(values) >= 4:
                bowling[player.id] = {
                    "player_id": player.id,
                    "overs": float(values[0]),
                    "runs_conceded": int(float(values[2])),
                    "wickets": int(float(values[3])),
                }
            break
    return {"batting": list(batting.values()), "bowling": list(bowling.values())}


def extract_scorecard_text(path: Path):
    extracted_pages = []
    try:
        with pdfplumber.open(path) as pdf:
            if len(pdf.pages) > 50:
                return "", "page_limit_exceeded"
            pages = [(page.extract_text() or "").strip() for page in pdf.pages]
    except Exception:
        return "", "extraction_failed"

    image_only_pages = [index for index, content in enumerate(pages) if not content]
    if not image_only_pages:
        return "\n".join(pages), "text_extracted"
    if not len("\n".join(pages).strip()):
        pages = [""] * len(pages)
    tesseract_cmd = os.getenv("TESSERACT_CMD")
    if tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
    elif not shutil.which("tesseract"):
        return "\n".join(pages), "no_text_tesseract_missing"

    try:
        document = pdfium.PdfDocument(str(path))
        for index in image_only_pages:
            page = document[index]
            image = page.render(scale=2).to_pil()
            pages[index] = pytesseract.image_to_string(image).strip()
            image.close()
            page.close()
        document.close()
    except Exception:
        return "\n".join(pages), "ocr_failed"
    text_content = "\n".join(pages)
    return text_content, "ocr_extracted" if text_content.strip() else "ocr_no_text"


def record_ranking_snapshot(db: Session):
    players = db.query(Player).order_by(Player.ranking_points.desc(), Player.runs.desc(), Player.id.asc()).all()
    snapshot = RankingSnapshot()
    snapshot.entries = [
        RankingEntry(player_id=player.id, player_name=player.name, rank=rank, points=round(player.ranking_points, 1))
        for rank, player in enumerate(players, 1)
    ]
    db.add(snapshot)
    db.flush()


def excel_safe_parts(value):
    if not isinstance(value, str):
        return [value]
    parts = [value[index:index + 32766] for index in range(0, len(value), 32766)] or [""]
    return [f"'{part}" if part.lstrip().startswith(("=", "+", "-", "@")) else part for part in parts]


def write_data_export(db: Session):
    workbook = Workbook()
    info = workbook.active
    info.title = "export_info"
    info.append(["NCA data export", "Value"])
    info.append(["Generated at (UTC)", datetime.utcnow()])
    info.append(["Excluded", "Password hashes and email action tokens are not exported."])
    info.append(["Media files", "PDF/image files remain in the uploads directory; this workbook contains their database records."])

    for table in sorted(Base.metadata.sorted_tables, key=lambda item: item.name):
        if table.name == "email_action_tokens":
            continue
        columns = [
            column for column in table.columns
            if "password" not in column.name.lower() and "token" not in column.name.lower()
        ]
        rows = db.execute(select(*columns)).all()
        part_counts = [
            max((len(excel_safe_parts(row[index])) for row in rows), default=1)
            for index in range(len(columns))
        ]
        sheet = workbook.create_sheet(title=table.name[:31])
        headers = [
            f"{column.name}_part_{part + 1}" if part else column.name
            for column, count in zip(columns, part_counts)
            for part in range(count)
        ]
        sheet.append(headers)
        for cell in sheet[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="17324D")
        for row in rows:
            values = []
            for index, value in enumerate(row):
                parts = excel_safe_parts(value)
                values.extend(parts + [None] * (part_counts[index] - len(parts)))
            sheet.append(values)
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for column_index in range(1, len(headers) + 1):
            values = [
                sheet.cell(row=row_index, column=column_index).value
                for row_index in range(1, sheet.max_row + 1)
            ]
            width = max((len(str(value)) for value in values if value is not None), default=10)
            sheet.column_dimensions[get_column_letter(column_index)].width = min(max(width + 2, 12), 60)

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    export_path = EXPORT_DIR / "nca_data_export.xlsx"
    temporary_path = EXPORT_DIR / f".nca_data_export-{secrets.token_hex(8)}.tmp.xlsx"
    try:
        workbook.save(temporary_path)
        temporary_path.replace(export_path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()
    return export_path


@app.post("/api/images/upload")
async def upload_image(
    file: UploadFile = File(...),
    category: str = "gallery",
    player_id: int | None = None,
    db: Session = Depends(get_db),
    identity=Depends(require_admin),
):
    allowed = {".jpg", ".jpeg", ".png", ".webp"}
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed:
        raise HTTPException(400, "Only JPG, PNG and WebP images are accepted")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image exceeds 10 MB")

    category = re.sub(r"[^a-zA-Z0-9_-]", "", category) or "gallery"
    folder = UPLOAD_DIR / "images" / category
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}-{re.sub(r'[^A-Za-z0-9_.-]', '_', file.filename)}"
    path = folder / filename
    path.write_bytes(content)
    url = f"/uploads/images/{category}/{filename}"

    if category == "players" and player_id:
        player = db.get(Player, player_id)
        if not player:
            raise HTTPException(404, "Player not found")
        player.photo_url = url
        db.commit()

    db.add(ActivityLog(action="Image uploaded", details=f"{category}: {filename}"))
    db.commit()
    return {"success": True, "url": url, "category": category}


@app.get("/api/media/assets")
def media_assets(identity=Depends(current_identity)):
    base = UPLOAD_DIR / "images"
    result = {"logo": [], "covers": [], "gallery": []}
    if not base.exists():
        return result
    for category in result:
        folder = base / category
        if not folder.exists():
            continue
        result[category] = [
            f"/uploads/images/{category}/{path.name}"
            for path in sorted(folder.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True)
            if path.is_file()
        ]
    return result


class PlayerIn(BaseModel):
    name: str
    player_code: str
    jersey_number: int | None = None
    role: str = "Player"
    batting_style: str | None = None
    bowling_style: str | None = None
    photo_url: str | None = None
    username: str | None = None
    password: str | None = None


class MatchIn(BaseModel):
    title: str
    match_date: datetime
    venue: str = ""
    status: str = "upcoming"
    result: str | None = None


class DailyReportIn(BaseModel):
    title: str
    body: str


class AnnouncementIn(BaseModel):
    title: str
    body: str


class RuleIn(BaseModel):
    category: str
    title: str
    body: str


def player_dict(p: Player):
    avg = round(p.runs / p.innings, 2) if p.innings else 0
    strike = round(p.runs * 100 / p.balls, 1) if p.balls else 0
    economy = round(p.bowling_runs_conceded / p.bowling_overs, 2) if p.bowling_overs else 0
    bowling_average = round(p.bowling_runs_conceded / p.wickets, 2) if p.wickets else 0
    return {
        "id": p.id, "player_code": p.player_code, "name": p.name,
        "has_login": bool(p.username and p.password_hash),
        "jersey_number": p.jersey_number, "role": p.role,
        "batting_style": p.batting_style, "bowling_style": p.bowling_style,
        "photo_url": p.photo_url, "matches": p.matches, "innings": p.innings,
        "runs": p.runs, "balls": p.balls, "wickets": p.wickets,
        "high_score": p.high_score, "fours": p.fours, "sixes": p.sixes,
        "catches": p.catches, "player_of_match": p.player_of_match,
        "batting_average": avg, "strike_rate": strike, "economy": economy,
        "bowling_average": bowling_average,
        "best_bowling": f"{p.best_bowling_wickets}/{p.best_bowling_runs}" if p.best_bowling_wickets or p.best_bowling_runs else "—",
        "ranking_breakdown": ranking_breakdown(p),
        "ranking_points": round(p.ranking_points, 1),
    }


def ranking_breakdown(player: Player):
    matches = max(player.matches, 1)
    runs_per_match = player.runs / matches
    batting_average = player.runs / player.innings if player.innings else 0
    strike_rate = player.runs * 100 / player.balls if player.balls else 0
    wickets_per_match = player.wickets / matches
    economy = player.bowling_runs_conceded / player.bowling_overs if player.bowling_overs else 0
    batting_volume = min(runs_per_match / 25, 1) * 30
    batting_average_points = min(batting_average / 50, 1) * 15
    strike_rate_points = min(strike_rate / 150, 1) * 10
    bowling_volume = min(wickets_per_match / 1.5, 1) * 25
    economy_points = max(0, 10 - max(0, economy - 4) * 2) if player.bowling_overs else 0
    return {
        "runs_per_match": round(runs_per_match, 2),
        "batting_volume": round(batting_volume, 1),
        "batting_average": round(batting_average_points, 1),
        "strike_rate": round(strike_rate_points, 1),
        "wickets_per_match": round(wickets_per_match, 2),
        "bowling_volume": round(bowling_volume, 1),
        "economy": round(economy_points, 1),
    }


def recalculate_player_stats(db: Session):
    players = db.query(Player).all()
    for player in players:
        batting = db.query(BattingStat).join(Scorecard, Scorecard.match_id == BattingStat.match_id).filter(
            BattingStat.player_id == player.id, Scorecard.status == "approved"
        ).all()
        bowling = db.query(BowlingStat).join(Scorecard, Scorecard.match_id == BowlingStat.match_id).filter(
            BowlingStat.player_id == player.id, Scorecard.status == "approved"
        ).all()
        player.innings = len(batting)
        player.runs = sum(row.runs for row in batting)
        player.balls = sum(row.balls for row in batting)
        player.high_score = max((row.runs for row in batting), default=0)
        player.fours = sum(row.fours for row in batting)
        player.sixes = sum(row.sixes for row in batting)
        player.wickets = sum(row.wickets for row in bowling)
        player.bowling_runs_conceded = sum(row.runs_conceded for row in bowling)
        player.bowling_overs = sum(row.overs for row in bowling)
        best_spell = max(bowling, key=lambda row: (row.wickets, -row.runs_conceded), default=None)
        player.best_bowling_wickets = best_spell.wickets if best_spell else 0
        player.best_bowling_runs = best_spell.runs_conceded if best_spell else 0
        player.matches = len({row.match_id for row in batting} | {row.match_id for row in bowling})
        breakdown = ranking_breakdown(player)
        player.ranking_points = sum(
            breakdown[key] for key in ("batting_volume", "batting_average", "strike_rate", "bowling_volume", "economy")
        )
    db.flush()


def overs_to_decimal(overs: float) -> float:
    completed = int(overs)
    balls = round((overs - completed) * 10)
    if balls < 0 or balls > 5:
        raise HTTPException(400, "Cricket overs must use a ball digit from .0 to .5")
    return completed + balls / 6


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/admin/export.xlsx")
def export_admin_data(db: Session = Depends(get_db), identity=Depends(require_admin)):
    export_path = write_data_export(db)
    return FileResponse(
        export_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=export_path.name,
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/auth/admin/login")
def admin_login(data: LoginIn, db: Session = Depends(get_db)):
    admin = db.query(Admin).filter(func.lower(Admin.email) == data.username.lower()).first()
    if not admin or not admin.active or not pwd_context.verify(data.password, admin.password_hash):
        raise HTTPException(401, "Invalid administrator email or password")
    return {
        "access_token": create_access_token(admin.email, "admin", admin.id),
        "token_type": "bearer",
        "role": "admin",
        "name": admin.name,
    }


@app.post("/api/auth/member/register")
def member_register(data: MemberRegisterIn, db: Session = Depends(get_db)):
    name = data.name.strip()
    username = data.username.strip()
    email = data.email.strip().lower() if data.email and data.email.strip() else None
    if not name or not username:
        raise HTTPException(400, "Name and username are required")
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(400, "Enter a valid email address")
    if len(username) > 120 or len(name) > 120:
        raise HTTPException(400, "Name and username must be 120 characters or fewer")
    if len(data.password) < 12 or len(data.password) > 72:
        raise HTTPException(400, "Passwords must be 12–72 characters")
    if db.query(Member).filter(func.lower(Member.username) == username.lower()).first():
        raise HTTPException(409, "That username is already registered")
    if email and db.query(Member).filter(func.lower(Member.email) == email).first():
        raise HTTPException(409, "That email address is already registered")
    member = Member(name=name, username=username, email=email, password_hash=pwd_context.hash(data.password))
    db.add(member)
    db.commit()
    return {"success": True, "message": "Account created. You can now sign in."}


@app.post("/api/auth/member/login")
def member_login(data: LoginIn, db: Session = Depends(get_db)):
    member = db.query(Member).filter(func.lower(Member.username) == data.username.lower()).first()
    if not member or not member.active or not pwd_context.verify(data.password, member.password_hash):
        raise HTTPException(401, "Invalid username or password")
    return {
        "access_token": create_access_token(member.username, "member", member.id),
        "token_type": "bearer",
        "role": "member",
        "name": member.name,
    }


@app.post("/api/auth/player/login")
def player_login(data: LoginIn, db: Session = Depends(get_db)):
    player = db.query(Player).filter(func.lower(Player.username) == data.username.lower()).first()
    if not player or not player.password_hash or not pwd_context.verify(data.password, player.password_hash):
        raise HTTPException(401, "Invalid player username or password")
    return {
        "access_token": create_access_token(player.username, "player", player.id),
        "token_type": "bearer",
        "role": "player",
        "name": player.name,
    }


@app.get("/api/auth/me")
def auth_me(identity=Depends(current_identity)):
    entity = identity["entity"]
    return {
        "role": identity["role"],
        "id": entity.id,
        "name": entity.name,
        "username": entity.email if identity["role"] == "admin" else entity.username,
    }


@app.get("/api/player/me")
def player_me(identity=Depends(require_player)):
    return player_dict(identity["entity"])


@app.get("/api/member/me")
def member_me(identity=Depends(require_member)):
    member = identity["entity"]
    return {"id": member.id, "name": member.name, "username": member.username, "created_at": member.created_at.isoformat()}


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db), identity=Depends(current_identity)):
    players = db.query(Player).all()
    matches = db.query(Match).all()
    scorecards = db.query(Scorecard).order_by(Scorecard.created_at.desc()).limit(5).all()
    total_runs = sum(p.runs for p in players)
    total_wickets = sum(p.wickets for p in players)
    top = max(players, key=lambda p: p.ranking_points, default=None)
    high = max(players, key=lambda p: p.high_score, default=None)
    highest_wicket = max(players, key=lambda p: p.wickets, default=None)
    return {
        "total_players": len(players),
        "matches_played": sum(m.status == "completed" for m in matches),
        "upcoming_matches": sum(m.status in ("upcoming", "live") for m in matches),
        "total_runs": total_runs,
        "total_wickets": total_wickets,
        "highest_score": high.high_score if high else 0,
        "highest_wicket_taker": highest_wicket.name if highest_wicket else "-",
        "top_ranked": top.name if top else "-",
        "recent_scorecards": [{"id": s.id, "filename": s.original_filename, "status": s.status} for s in scorecards],
    }


@app.get("/api/players")
def list_players(db: Session = Depends(get_db), identity=Depends(current_identity)):
    return [player_dict(p) for p in db.query(Player).order_by(Player.ranking_points.desc(), Player.runs.desc()).all()]


@app.post("/api/players")
def create_player(data: PlayerIn, db: Session = Depends(get_db), identity=Depends(require_admin)):
    if db.query(Player).filter(Player.player_code == data.player_code).first():
        raise HTTPException(409, "Player code already exists")
    if bool(data.username) != bool(data.password):
        raise HTTPException(400, "Provide both a player username and password, or leave both empty")
    if data.password and (len(data.password) < 12 or len(data.password) > 72):
        raise HTTPException(400, "Player passwords must be 12–72 characters")
    values = data.model_dump(exclude={"username", "password"})
    p = Player(**values)
    if data.username:
        if db.query(Player).filter(func.lower(Player.username) == data.username.lower()).first():
            raise HTTPException(409, "Player username already exists")
        p.username = data.username.strip()
        p.password_hash = pwd_context.hash(data.password)
    db.add(p)
    db.commit()
    db.refresh(p)
    db.add(ActivityLog(action="Player created", details=p.name))
    db.commit()
    return player_dict(p)


@app.put("/api/players/{player_id}/account")
def update_player_account(
    player_id: int,
    data: PlayerAccountIn,
    db: Session = Depends(get_db),
    identity=Depends(require_admin),
):
    player = db.get(Player, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    username = data.username.strip()
    if len(data.password) < 12 or len(data.password) > 72:
        raise HTTPException(400, "Player passwords must be 12–72 characters")
    duplicate = db.query(Player).filter(func.lower(Player.username) == username.lower(), Player.id != player.id).first()
    if duplicate:
        raise HTTPException(409, "Player username already exists")
    player.username = username
    player.password_hash = pwd_context.hash(data.password)
    db.commit()
    return {"success": True, "message": "Player login credentials updated"}


@app.put("/api/players/{player_id}")
def update_player(player_id: int, data: PlayerIn, db: Session = Depends(get_db), identity=Depends(require_admin)):
    p = db.get(Player, player_id)
    if not p:
        raise HTTPException(404, "Player not found")
    duplicate_code = db.query(Player).filter(Player.player_code == data.player_code, Player.id != p.id).first()
    if duplicate_code:
        raise HTTPException(409, "Player code already exists")
    if bool(data.username) != bool(data.password):
        raise HTTPException(400, "Provide both a player username and password, or leave both empty")
    if data.password and (len(data.password) < 12 or len(data.password) > 72):
        raise HTTPException(400, "Player passwords must be 12–72 characters")
    for key, value in data.model_dump(exclude={"username", "password"}).items():
        setattr(p, key, value)
    if data.username and data.password:
        duplicate = db.query(Player).filter(func.lower(Player.username) == data.username.lower(), Player.id != p.id).first()
        if duplicate:
            raise HTTPException(409, "Player username already exists")
        p.username = data.username.strip()
        if not p.username:
            raise HTTPException(400, "Player username is required")
        p.password_hash = pwd_context.hash(data.password)
    db.commit()
    db.refresh(p)
    return player_dict(p)


@app.delete("/api/players/{player_id}")
def delete_player(player_id: int, db: Session = Depends(get_db), identity=Depends(require_admin)):
    p = db.get(Player, player_id)
    if not p:
        raise HTTPException(404, "Player not found")
    db.delete(p)
    db.commit()
    return {"success": True}


@app.get("/api/rankings")
def rankings(db: Session = Depends(get_db), identity=Depends(current_identity)):
    players = db.query(Player).order_by(Player.ranking_points.desc()).all()
    return [{"rank": i, **player_dict(p)} for i, p in enumerate(players, 1)]


@app.get("/api/rankings/history")
def ranking_history(db: Session = Depends(get_db), identity=Depends(current_identity)):
    snapshots = db.query(RankingSnapshot).order_by(RankingSnapshot.created_at.desc()).limit(50).all()
    return [{
        "id": snapshot.id,
        "created_at": snapshot.created_at.isoformat(),
        "entries": [
            {"player_id": entry.player_id, "player_name": entry.player_name, "rank": entry.rank, "points": entry.points}
            for entry in sorted(snapshot.entries, key=lambda row: row.rank)
        ],
    } for snapshot in snapshots]


@app.get("/api/matches")
def matches(db: Session = Depends(get_db), identity=Depends(current_identity)):
    return [
        {"id": m.id, "title": m.title, "match_date": m.match_date.isoformat(),
         "venue": m.venue, "status": m.status, "result": m.result}
        for m in db.query(Match).order_by(Match.match_date.desc()).all()
    ]


@app.post("/api/matches")
def create_match(data: MatchIn, db: Session = Depends(get_db), identity=Depends(require_admin)):
    m = Match(**data.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"id": m.id, "title": m.title, "match_date": m.match_date.isoformat(), "venue": m.venue, "status": m.status, "result": m.result}


@app.put("/api/matches/{match_id}")
def update_match(match_id: int, data: MatchIn, db: Session = Depends(get_db), identity=Depends(require_admin)):
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    for key, value in data.model_dump().items():
        setattr(m, key, value)
    db.commit()
    db.refresh(m)
    return {"id": m.id, "title": m.title, "match_date": m.match_date.isoformat(), "venue": m.venue, "status": m.status, "result": m.result}


@app.delete("/api/matches/{match_id}")
def delete_match(match_id: int, db: Session = Depends(get_db), identity=Depends(require_admin)):
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    db.delete(m)
    db.commit()
    return {"success": True}


@app.post("/api/scorecards/upload")
async def upload_scorecard(file: UploadFile = File(...), db: Session = Depends(get_db), identity=Depends(require_admin)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(413, "PDF exceeds 20 MB")
    digest = hashlib.sha256(content).hexdigest()
    existing = db.query(Scorecard).filter(Scorecard.file_hash == digest).first()
    if existing:
        raise HTTPException(409, "This scorecard PDF has already been uploaded")
    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{re.sub(r'[^A-Za-z0-9_.-]', '_', file.filename)}"
    path = UPLOAD_DIR / filename
    path.write_bytes(content)
    text_content, extraction_status = extract_scorecard_text(path)
    scorecard = Scorecard(original_filename=file.filename, stored_path=str(path), file_hash=digest, status="pending", extracted_text=text_content, extraction_status=extraction_status)
    db.add(scorecard)
    db.commit()
    db.refresh(scorecard)
    suggestions = suggest_scorecard_rows(text_content, db.query(Player).all())
    scorecard.review_data = json.dumps(suggestions)
    db.commit()
    return {"id": scorecard.id, "filename": scorecard.original_filename, "status": "pending", "extraction_status": extraction_status, "extracted_text": text_content[:12000], **suggestions}


@app.post("/api/scorecards/upload-multiple")
async def upload_scorecards(files: list[UploadFile] = File(...), db: Session = Depends(get_db), identity=Depends(require_admin)):
    if not files:
        raise HTTPException(400, "No PDF files were selected")

    results = []
    for file in files:
        if not (file.filename or "").lower().endswith(".pdf"):
            results.append({"filename": file.filename, "success": False, "message": "Only PDF files are accepted"})
            continue

        content = await file.read()
        if len(content) > 20 * 1024 * 1024:
            results.append({"filename": file.filename, "success": False, "message": "PDF exceeds 20 MB"})
            continue

        digest = hashlib.sha256(content).hexdigest()
        existing = db.query(Scorecard).filter(Scorecard.file_hash == digest).first()
        if existing:
            results.append({"filename": file.filename, "success": False, "message": "Duplicate PDF"})
            continue

        filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}-{re.sub(r'[^A-Za-z0-9_.-]', '_', file.filename)}"
        path = UPLOAD_DIR / filename
        path.write_bytes(content)
        text_content, extraction_status = extract_scorecard_text(path)

        scorecard = Scorecard(
            original_filename=file.filename,
            stored_path=str(path),
            file_hash=digest,
            status="pending",
            extracted_text=text_content,
            extraction_status=extraction_status,
        )
        scorecard.review_data = json.dumps(suggest_scorecard_rows(text_content, db.query(Player).all()))
        db.add(scorecard)
        db.flush()
        results.append({
            "id": scorecard.id,
            "filename": scorecard.original_filename,
            "success": True,
            "status": "pending",
            "extraction_status": extraction_status,
            "extracted_text": text_content[:12000],
            **json.loads(scorecard.review_data),
        })

    db.commit()
    return {"success": True, "uploads": results}


@app.get("/api/scorecards")
def list_scorecards(db: Session = Depends(get_db), identity=Depends(require_admin)):
    scorecards = db.query(Scorecard).order_by(Scorecard.created_at.desc()).all()
    return [{
        "id": s.id,
        "filename": s.original_filename,
        "status": s.status,
        "extraction_status": s.extraction_status,
        "created_at": s.created_at.isoformat(),
        "match_id": s.match_id,
        "extracted_text": s.extracted_text[:12000],
        "review_data": json.loads(s.review_data or "{}"),
        "download_url": f"/uploads/{Path(s.stored_path).name}",
    } for s in scorecards]


@app.delete("/api/scorecards/{scorecard_id}")
def delete_scorecard(scorecard_id: int, db: Session = Depends(get_db), identity=Depends(require_admin)):
    scorecard = db.get(Scorecard, scorecard_id)
    if not scorecard:
        raise HTTPException(404, "Scorecard not found")
    if scorecard.status == "approved":
        raise HTTPException(409, "Approved scorecards cannot be deleted")
    path = Path(scorecard.stored_path)
    if path.exists():
        path.unlink()
    db.delete(scorecard)
    db.commit()
    return {"success": True}


@app.post("/api/scorecards/{scorecard_id}/approve")
def approve_scorecard(scorecard_id: int, data: ScorecardReview, db: Session = Depends(get_db), identity=Depends(require_admin)):
    scorecard = db.get(Scorecard, scorecard_id)
    if not scorecard:
        raise HTTPException(404, "Scorecard not found")
    if scorecard.status == "approved":
        return {"success": True, "message": "Already approved"}
    if len({row.player_id for row in data.batting}) != len(data.batting):
        raise HTTPException(400, "A player can appear only once in the batting summary")
    if len({row.player_id for row in data.bowling}) != len(data.bowling):
        raise HTTPException(400, "A player can appear only once in the bowling summary")
    if not data.batting and not data.bowling:
        raise HTTPException(400, "Add at least one reviewed batting or bowling record")
    if data.match_id:
        match = db.get(Match, data.match_id)
        if not match:
            raise HTTPException(404, "Match not found")
        existing_card = db.query(Scorecard).filter(
            Scorecard.match_id == match.id, Scorecard.status == "approved", Scorecard.id != scorecard.id
        ).first()
        if existing_card:
            raise HTTPException(409, "An approved scorecard already exists for this match")
    else:
        if not data.title.strip() or not data.match_date:
            raise HTTPException(400, "Enter the match title and date")
        match = Match(
            title=data.title.strip(),
            match_date=data.match_date,
            venue=data.venue.strip(),
            status="completed",
            result=data.result.strip() or None,
        )
        db.add(match)
        db.flush()

    all_player_ids = {row.player_id for row in data.batting} | {row.player_id for row in data.bowling}
    existing_players = {player.id for player in db.query(Player).filter(Player.id.in_(all_player_ids)).all()}
    if all_player_ids != existing_players:
        raise HTTPException(400, "One or more selected players do not exist")
    if any(min(row.runs, row.balls, row.fours, row.sixes) < 0 for row in data.batting):
        raise HTTPException(400, "Batting statistics cannot be negative")
    if any(min(row.wickets, row.runs_conceded, row.overs) < 0 for row in data.bowling):
        raise HTTPException(400, "Bowling statistics cannot be negative")

    scorecard.match_id = match.id
    scorecard.review_data = data.model_dump_json()
    match.result = data.result.strip() or match.result
    match.status = "completed"
    for row in data.batting:
        db.add(BattingStat(match_id=match.id, **row.model_dump()))
    for row in data.bowling:
        bowling_values = row.model_dump()
        bowling_values["overs"] = overs_to_decimal(row.overs)
        db.add(BowlingStat(match_id=match.id, **bowling_values))
    scorecard.status = "approved"
    db.flush()
    recalculate_player_stats(db)
    record_ranking_snapshot(db)
    db.add(ActivityLog(action="Scorecard approved", details=scorecard.original_filename))
    db.commit()
    return {"success": True, "message": "Scorecard verified; career statistics and rankings recalculated"}


@app.get("/api/reports")
def reports(db: Session = Depends(get_db), identity=Depends(current_identity)):
    return [{"id": r.id, "title": r.title, "body": r.body, "published_at": r.published_at.isoformat()} for r in db.query(DailyReport).order_by(DailyReport.published_at.desc()).all()]


@app.post("/api/reports")
def create_report(data: DailyReportIn, db: Session = Depends(get_db), identity=Depends(require_admin)):
    r = DailyReport(**data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"id": r.id, "title": r.title, "body": r.body, "published_at": r.published_at.isoformat()}


@app.put("/api/reports/{report_id}")
def update_report(report_id: int, data: DailyReportIn, db: Session = Depends(get_db), identity=Depends(require_admin)):
    r = db.get(DailyReport, report_id)
    if not r:
        raise HTTPException(404, "Report not found")
    r.title = data.title
    r.body = data.body
    db.commit()
    db.refresh(r)
    return {"id": r.id, "title": r.title, "body": r.body, "published_at": r.published_at.isoformat()}


@app.delete("/api/reports/{report_id}")
def delete_report(report_id: int, db: Session = Depends(get_db), identity=Depends(require_admin)):
    r = db.get(DailyReport, report_id)
    if not r:
        raise HTTPException(404, "Report not found")
    db.delete(r)
    db.commit()
    return {"success": True}


@app.get("/api/announcements")
def announcements(db: Session = Depends(get_db), identity=Depends(current_identity)):
    return [{"id": a.id, "title": a.title, "body": a.body, "published_at": a.published_at.isoformat()} for a in db.query(Announcement).order_by(Announcement.published_at.desc()).all()]


@app.post("/api/announcements")
def create_announcement(data: AnnouncementIn, db: Session = Depends(get_db), identity=Depends(require_admin)):
    a = Announcement(**data.model_dump())
    db.add(a)
    db.commit()
    db.refresh(a)
    return {"id": a.id, "title": a.title, "body": a.body, "published_at": a.published_at.isoformat()}


@app.put("/api/announcements/{announcement_id}")
def update_announcement(announcement_id: int, data: AnnouncementIn, db: Session = Depends(get_db), identity=Depends(require_admin)):
    a = db.get(Announcement, announcement_id)
    if not a:
        raise HTTPException(404, "Announcement not found")
    a.title = data.title
    a.body = data.body
    db.commit()
    db.refresh(a)
    return {"id": a.id, "title": a.title, "body": a.body, "published_at": a.published_at.isoformat()}


@app.delete("/api/announcements/{announcement_id}")
def delete_announcement(announcement_id: int, db: Session = Depends(get_db), identity=Depends(require_admin)):
    a = db.get(Announcement, announcement_id)
    if not a:
        raise HTTPException(404, "Announcement not found")
    db.delete(a)
    db.commit()
    return {"success": True}


@app.get("/api/rules")
def rules(db: Session = Depends(get_db), identity=Depends(current_identity)):
    return [{"id": r.id, "category": r.category, "title": r.title, "body": r.body, "updated_at": r.updated_at.isoformat()} for r in db.query(Rule).order_by(Rule.category, Rule.title).all()]


@app.post("/api/rules")
def create_rule(data: RuleIn, db: Session = Depends(get_db), identity=Depends(require_admin)):
    r = Rule(**data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"id": r.id, "category": r.category, "title": r.title, "body": r.body, "updated_at": r.updated_at.isoformat()}


@app.put("/api/rules/{rule_id}")
def update_rule(rule_id: int, data: RuleIn, db: Session = Depends(get_db), identity=Depends(require_admin)):
    r = db.get(Rule, rule_id)
    if not r:
        raise HTTPException(404, "Rule not found")
    r.category = data.category
    r.title = data.title
    r.body = data.body
    r.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(r)
    return {"id": r.id, "category": r.category, "title": r.title, "body": r.body, "updated_at": r.updated_at.isoformat()}


@app.delete("/api/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db), identity=Depends(require_admin)):
    r = db.get(Rule, rule_id)
    if not r:
        raise HTTPException(404, "Rule not found")
    db.delete(r)
    db.commit()
    return {"success": True}
