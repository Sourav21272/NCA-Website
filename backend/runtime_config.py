import os
from pathlib import Path


def read_config_value(name: str, secret_dir: Path = Path("/etc/secrets")) -> str | None:
    value = os.getenv(name)
    if value is not None:
        return value

    try:
        return (secret_dir / name).read_text(encoding="utf-8").rstrip("\r\n")
    except FileNotFoundError:
        return None
