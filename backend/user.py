from datetime import datetime
import pycountry
from flask import jsonify, redirect, render_template
from flask_security import Security, SQLAlchemyUserDatastore, current_user, utils
from flask_security.models import fsqla_v3 as fsqla
from flask_security.views import forgot_password
from flask_wtf import FlaskForm
from wtforms import IntegerField, SelectField, StringField, SubmitField, BooleanField
from wtforms.validators import Optional
from wtforms.widgets import NumberInput
from sqlalchemy import text

from wtforms import EmailField, ValidationError
from flask_security import ForgotPasswordForm

from backend.shared import app, db, logger, EMAIL

# Set up Flask-Security database models
fsqla.FsModels.set_db_info(db)


class MyResetForm(ForgotPasswordForm):
    def validate(self, **kwargs):
        if not super().validate():
            return False

        email = self.email.data

        # Check if user wrote a review
        res = db.session.execute(
            text("select * from user right join points where email = :email and user.id = points.user_id;"), {"email": email}
        ).fetchone()

        if not res:
            self.email.errors.append(
                "We only support automatically resetting passwords for users who have written reviews before. Send an email to info@hitchmap.com to reset your password, or create a new account."
            )
            return False

        return True


# Now we can define our models
class Role(db.Model, fsqla.FsRoleMixin):
    pass


class User(db.Model, fsqla.FsUserMixin):
    make_public = db.Column(db.Boolean, default=False)
    gender = db.Column(db.String(255), default=None)
    year_of_birth = db.Column(db.Integer, default=None)
    hitchhiking_since = db.Column(db.Integer, default=None)
    origin_country = db.Column(db.String(255), default=None)
    origin_city = db.Column(db.String(255), default=None)
    hitchwiki_username = db.Column(db.String(255), default=None)
    trustroots_username = db.Column(db.String(255), default=None)


class CountrySelectField(SelectField):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.choices = [(None, "None")] + [(country.name, country.name) for country in pycountry.countries]


class UserEditForm(FlaskForm):
    make_public = BooleanField("I agree", default=False)
    gender = SelectField(
        "Gender",
        choices=[
            (None, "None"),
            ("Female", "Female"),
            ("Male", "Male"),
            ("Non-Binary", "Non-Binary"),
            ("Prefer not to say", "Prefer not to say"),
        ],
    )
    year_of_birth = IntegerField(
        "Year of Birth",
        widget=NumberInput(min=1900, max=datetime.now().year),
        validators=[Optional()],
    )
    hitchhiking_since = IntegerField(
        "Hitchhiking Since",
        widget=NumberInput(min=1900, max=datetime.now().year),
        validators=[Optional()],
    )
    origin_country = CountrySelectField("Where are you from?")
    origin_city = StringField("Which city are you from?", validators=[Optional()])
    hitchwiki_username = StringField("Hitchwiki Username", validators=[Optional()], default=None)
    trustroots_username = StringField("Trustroots Username", validators=[Optional()], default=None)
    submit = SubmitField("Submit")


# Security configuration
app.config["SECURITY_PASSWORD_HASH"] = "argon2"
app.config["SECURITY_PASSWORD_SALT"] = "146585145368132386173505678016728509634"
app.config["SECURITY_REGISTERABLE"] = True
app.config["SECURITY_SEND_REGISTER_EMAIL"] = False
app.config["SECURITY_CONFIRMABLE"] = False
app.config["SECURITY_RECOVERABLE"] = True
app.config["SECURITY_USERNAME_ENABLE"] = True
app.config["SECURITY_USERNAME_REQUIRED"] = True
app.config["SECURITY_USERNAME_MIN_LENGTH"] = 3
app.config["SECURITY_USERNAME_MAX_LENGTH"] = 32
app.config["SECURITY_USER_IDENTITY_ATTRIBUTES"] = [{"username": {"mapper": utils.uia_username_mapper, "case_insensitive": True}}]
app.config["SECURITY_MSG_USERNAME_ALREADY_ASSOCIATED"] = (
    (
        f"%(username)s is already associated with an account. Please reach out to {EMAIL} if you want to claim this username "
        + "because you used it before as a nickname on hitchmap.com and/ or you use this username on hitchwiki.org as well."
    ),
    "error",
)
app.config["SECURITY_POST_REGISTER_VIEW"] = "/#registered"
app.config["SECURITY_CHANGE_EMAIL"] = True

# Initialize Flask-Security
user_datastore = SQLAlchemyUserDatastore(db, User, Role)
security = Security(app, user_datastore, forgot_password_form=MyResetForm)


def init_security():
    with app.app_context():
        security.datastore.db.create_all()
        security.datastore.find_or_create_role(
            name="point-admin",
            permissions={"read-points", "write-points"},
        )
        security.datastore.find_or_create_role(
            name="user-admin",
            permissions={"read-user-roles", "write-user-roles"},
        )
        security.datastore.db.session.commit()


def get_origin_string(user):
    origin_string = (
        (user.origin_city if user.origin_city is not None else "")
        + (", " if (user.origin_city != "" and user.origin_city is not None) else " ")
        + (user.origin_country if user.origin_country is not None else "")
    )
    return origin_string


# Routes
@app.route("/edit-user", methods=["GET", "POST"])
def form():
    if current_user.is_anonymous:
        return redirect("/login")

    form = UserEditForm()

    if form.validate_on_submit():
        updated_user = security.datastore.find_user(case_insensitive=True, username=current_user.username)
        updated_user.make_public = form.make_public.data
        updated_user.gender = form.gender.data
        updated_user.year_of_birth = form.year_of_birth.data
        updated_user.hitchhiking_since = form.hitchhiking_since.data
        updated_user.origin_country = form.origin_country.data
        updated_user.origin_city = form.origin_city.data
        updated_user.hitchwiki_username = form.hitchwiki_username.data
        updated_user.trustroots_username = form.trustroots_username.data
        security.datastore.put(updated_user)
        security.datastore.commit()
        return redirect("/me")

    form.make_public.data = current_user.make_public
    form.gender.data = current_user.gender
    form.year_of_birth.data = current_user.year_of_birth
    form.hitchhiking_since.data = current_user.hitchhiking_since
    form.origin_country.data = current_user.origin_country
    form.origin_city.data = current_user.origin_city
    form.hitchwiki_username.data = current_user.hitchwiki_username
    form.trustroots_username.data = current_user.trustroots_username

    return render_template("edit_user.html", form=form)


@app.route("/user", methods=["GET"])
def get_user():
    print(current_user.roles)
    if current_user.is_anonymous:
        return jsonify({"logged_in": False, "_permissions": []})
    else:
        permissions = list(set(perm for role in current_user.roles for perm in role.permissions))

        return jsonify({"logged_in": True, "username": current_user.username, "_permissions": permissions})


@app.route("/delete-user", methods=["GET"])
def delete_user():
    return f"To delete your account please send an email to {EMAIL} with the subject 'Delete my account'."


@app.route("/me", methods=["GET"])
def show_current_user():
    if current_user.is_anonymous:
        return redirect("/login")

    user = current_user
    origin_string = get_origin_string(user)

    return render_template(
        "me.html",
        username=user.username,
        email=user.email,
        gender=user.gender,
        origin_string=origin_string,
        hitchwiki_username=user.hitchwiki_username,
        trustroots_username=user.trustroots_username,
        hitchhiking_since=user.hitchhiking_since,
        year_of_birth=user.year_of_birth,
    )


@app.route("/is_username_used/<username>", methods=["GET"])
def is_username_used(username):
    user = security.datastore.find_user(case_insensitive=True, username=username)
    return jsonify({"used": bool(user)})


@app.route("/account/<username>", methods=["GET"])
def show_account(username):
    logger.info(f"Received request to show user {username}.")
    user = security.datastore.find_user(case_insensitive=True, username=username)
    if user:
        origin_string = get_origin_string(user)
        return render_template(
            "account.html",
            username=user.username,
            email=user.email,
            gender=user.gender,
            origin_string=origin_string,
            hitchwiki_username=user.hitchwiki_username,
            trustroots_username=user.trustroots_username,
            hitchhiking_since=user.hitchhiking_since,
            year_of_birth=user.year_of_birth,
        )
    return "User not found."
