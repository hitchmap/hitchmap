import logging
import os
import secrets
from flask import Flask
from flask_mailman import Mail
from flask_sqlalchemy import SQLAlchemy

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
