import re
from datetime import datetime, timezone
from pathlib import Path


_BATTER_ROW = re.compile(
    r"^(?P<name>.+?)\s+(?P<runs>\d+)\s+(?P<balls>\d+)\s+"
    r"(?P<fours>\d+)\s+(?P<sixes>\d+)\s+(?P<strike_rate>\d+(?:\.\d+)?)$"
)
_BOWLER_ROW = re.compile(
    r"^(?P<name>.+?)\s+(?P<overs>\d+(?:\.\d+)?)\s+(?P<maidens>\d+)\s+"
    r"(?P<runs>\d+)\s+(?P<wickets>\d+)\s+(?P<economy>\d+(?:\.\d+)?)$"
)


def _clean_player_name(name: str) -> str:
    name = re.sub(r"\s+\((?:c|vc|wk)\)\s*$", "", name, flags=re.IGNORECASE)
    return " ".join(name.rstrip("* ").split())


def _overs_to_balls(value: str) -> int | None:
    match = re.fullmatch(r"(\d+)(?:\.(\d))?", value)
    if not match:
        return None
    completed = int(match.group(1))
    balls = int(match.group(2) or 0)
    if balls > 5:
        return None
    return completed * 6 + balls


def _match_date(text: str, filename: str) -> tuple[str | None, str | None]:
    date_match = re.search(
        r"\b(?:match\s+)?date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})\b",
        text,
        flags=re.IGNORECASE,
    )
    if date_match:
        try:
            parsed = datetime.fromisoformat(date_match.group(1)).replace(tzinfo=timezone.utc)
            return parsed.isoformat(), "pdf_text"
        except ValueError:
            pass

    timestamp = re.search(r"(?<!\d)(\d{13})(?!\d)", Path(filename).name)
    if timestamp:
        parsed = datetime.fromtimestamp(int(timestamp.group(1)) / 1000, tz=timezone.utc)
        return parsed.isoformat(), "filename_timestamp"
    return None, None


def parse_scorecard_text(text: str, filename: str = "") -> dict:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    title = next(
        (
            line for line in lines
            if not line.lower().startswith(("powered by", "page "))
            and not re.fullmatch(r"\d+\s*/\s*\d+", line)
        ),
        "",
    )
    result = next(
        (
            line.rstrip(".")
            for line in lines
            if re.search(r"\bwon by\b|\bmatch is tie\b|\bmatch tied\b", line, re.IGNORECASE)
        ),
        "",
    )
    match_date, date_source = _match_date(text, filename)
    warnings = []
    if date_source == "filename_timestamp":
        warnings.append("Match date is estimated from the filename timestamp; verify it.")
    elif not match_date:
        warnings.append("Match date was not found; enter it before approval.")

    mode = ""
    batting = {}
    bowling = {}
    for line in lines:
        normalized = line.lower()
        if "batsman" in normalized or "batter" in normalized:
            mode = "batting"
            continue
        if "bowler" in normalized and "w" in normalized:
            mode = "bowling"
            continue
        if normalized.startswith(("fall of wickets", "extras", "total", "powered by", "page ")):
            if normalized.startswith("fall of wickets"):
                mode = ""
            continue

        if mode == "batting":
            match = _BATTER_ROW.fullmatch(line)
            if not match:
                continue
            name = _clean_player_name(match.group("name"))
            if not name:
                continue
            row = batting.setdefault(name, {"name": name, "runs": 0, "balls": 0, "fours": 0, "sixes": 0})
            for field in ("runs", "balls", "fours", "sixes"):
                row[field] += int(match.group(field))
        elif mode == "bowling":
            match = _BOWLER_ROW.fullmatch(line)
            if not match:
                continue
            name = _clean_player_name(match.group("name"))
            balls = _overs_to_balls(match.group("overs"))
            if not name or balls is None:
                if name:
                    warnings.append(f"Could not parse bowling overs for {name}; verify this row.")
                continue
            row = bowling.setdefault(
                name,
                {"name": name, "balls_bowled": 0, "runs_conceded": 0, "wickets": 0},
            )
            row["balls_bowled"] += balls
            row["runs_conceded"] += int(match.group("runs"))
            row["wickets"] += int(match.group("wickets"))

    bowling_rows = []
    for row in bowling.values():
        balls = row.pop("balls_bowled")
        row["overs"] = balls // 6 + (balls % 6) / 10
        bowling_rows.append(row)

    if not batting and not bowling:
        warnings.append("No batting or bowling rows could be extracted from this PDF.")

    return {
        "title": title,
        "match_date": match_date,
        "date_source": date_source,
        "venue": "",
        "result": result,
        "batting": list(batting.values()),
        "bowling": bowling_rows,
        "warnings": warnings,
    }
