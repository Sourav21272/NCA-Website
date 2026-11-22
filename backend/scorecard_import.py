import re

from sqlalchemy.orm import Session

from models import Player
from scorecard_parser import parse_scorecard_text


def normalize_player_name(name: str):
    return " ".join(name.split()).casefold()


def new_scorecard_player_code(name: str, existing_codes: set[str]):
    slug = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").upper() or "PLAYER"
    base = f"PDF-{slug}"[:30]
    code = base
    suffix = 2
    while code in existing_codes:
        suffix_text = f"-{suffix}"
        code = f"{base[:30 - len(suffix_text)]}{suffix_text}"
        suffix += 1
    existing_codes.add(code)
    return code


def player_registry(db: Session):
    players = db.query(Player).all()
    players_by_name = {}
    for player in players:
        players_by_name.setdefault(normalize_player_name(player.name), player)
    return players_by_name, {player.player_code for player in players}


def prepare_scorecard_review(text_content: str, filename: str, db: Session, players_by_name, existing_codes):
    parsed = parse_scorecard_text(text_content, filename)
    for row in parsed["batting"] + parsed["bowling"]:
        normalized_name = normalize_player_name(row["name"])
        player = players_by_name.get(normalized_name)
        if not player:
            player = Player(
                player_code=new_scorecard_player_code(row["name"], existing_codes),
                name=row["name"],
                role="Player",
            )
            db.add(player)
            db.flush()
            players_by_name[normalized_name] = player
        row["player_id"] = player.id
    return parsed
