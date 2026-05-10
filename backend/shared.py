import logging
import os
import secrets
from flask import Flask
from flask_mailman import Mail
from flask_sqlalchemy import SQLAlchemy
import base64
import time, hmac, hashlib

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

EMAIL = "info@hitchmap.com"

# TODO: import these from helpers.py
root_dir = os.path.join(os.path.dirname(__file__), "..")
db_dir = os.path.abspath(os.path.join(root_dir, "db"))
dist_dir = os.path.abspath(os.path.join(root_dir, "dist"))
static_dir = os.path.abspath(os.path.join(root_dir, "static"))

# TODO: Use dotenv?
if os.path.exists(os.path.join(db_dir, "prod-points.sqlite")):
    DATABASE = os.path.join(db_dir, "prod-points.sqlite")
else:
    DATABASE = os.path.join(db_dir, "points.sqlite")

SECRET_KEY_FILE = ".flask_secret_key"


def get_or_create_secret_key():
    if os.path.exists(SECRET_KEY_FILE):
        with open(SECRET_KEY_FILE) as file:
            secret_key = file.read().strip()
    else:
        secret_key = secrets.token_hex(32)
        with open(SECRET_KEY_FILE, "w") as file:
            file.write(secret_key)
        logger.info(f"Generated new SECRET_KEY and saved to {SECRET_KEY_FILE}")
    return secret_key


def short_id_to_long_id(short_id):
    return int.from_bytes(base64.urlsafe_b64decode(short_id), byteorder="big", signed=False)


def generate_sync_secret(user_id: int) -> str:
    window = int(time.time()) // (3600 * 24 * 7)  # changes every week
    mac = hmac.new(get_or_create_secret_key().encode(), f"{user_id}.{window}".encode(), hashlib.sha256).hexdigest()
    return f"{user_id}.{mac}"


def validate_sync_secret(secret: str) -> int | None:
    try:
        user_id_str, mac = secret.split(".", 1)
        user_id = int(user_id_str)
    except ValueError:
        return None
    # Accept current window and the previous one to avoid edge-case expiry
    current_window = int(time.time()) // (3600 * 24 * 7)
    for window in [current_window, current_window - 1]:
        expected = hmac.new(get_or_create_secret_key().encode(), f"{user_id}.{window}".encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, mac):
            return user_id
    return None


print(dist_dir)
app = Flask(__name__, template_folder=os.path.join(root_dir, "templates"))
app.config["DEBUG"] = DATABASE == "prod-points.sqlite"
app.config["SECRET_KEY"] = get_or_create_secret_key()
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{DATABASE}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}
app.config["SESSION_COOKIE_SAMESITE"] = "Strict"

# Flask-Mailman configuration
app.config["MAIL_SERVER"] = "mail.smtp2go.com"
app.config["MAIL_PORT"] = 587
app.config["MAIL_USE_TLS"] = True
app.config["MAIL_USE_SSL"] = False
app.config["MAIL_USERNAME"] = "hitchmap.com"
app.config["MAIL_PASSWORD"] = os.getenv("HITCHMAP_MAIL_PASSWORD", "fake-password")
app.config["MAIL_DEFAULT_SENDER"] = ("Hitchmap", "no-reply@hitchmap.com")

db = SQLAlchemy(app)
mail = Mail(app)
