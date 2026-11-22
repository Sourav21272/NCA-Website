from getpass import getpass

from dotenv import load_dotenv

load_dotenv(".env")

from database import Base, SessionLocal, engine
from models import Admin
from passlib.context import CryptContext

Base.metadata.create_all(bind=engine)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

email = input("Administrator email: ").strip().lower()
name = input("Administrator name: ").strip() or "NCA Administrator"
password = getpass("Password (minimum 12 characters): ")
confirmation = getpass("Confirm password: ")

if not email or "@" not in email:
    raise SystemExit("Enter a valid administrator email address.")
if len(password) < 12:
    raise SystemExit("Password must contain at least 12 characters.")
if len(password) > 72:
    raise SystemExit("Password must contain 72 characters or fewer.")
if password != confirmation:
    raise SystemExit("Passwords do not match.")

with SessionLocal() as db:
    if db.query(Admin).count():
        raise SystemExit("The owner administrator is already set up. Admin accounts cannot be created through the website.")
    if db.query(Admin).filter(Admin.email == email).first():
        raise SystemExit("An administrator already uses that email.")
    db.add(Admin(name=name, email=email, password_hash=pwd_context.hash(password), role="super_admin"))
    db.commit()

print(f"Administrator account created for {email}.")
