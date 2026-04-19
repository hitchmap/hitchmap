import json
import hashlib
import pandas as pd
from datetime import datetime
from flask import jsonify, request, make_response
from flask_security import current_user, login_required
from sqlalchemy import text
from backend.process_recording import process_recording

from backend.shared import app, db, logger


class UserLocation(db.Model):
    __tablename__ = "user_locations"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    recording_id = db.Column(db.String(255), nullable=False, index=True)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    accuracy = db.Column(db.Float, nullable=True)
    timestamp = db.Column(db.BigInteger, nullable=False)  # Unix timestamp in milliseconds
    speed = db.Column(db.Float, nullable=True)
    heading = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, nullable=True)

    tracking = db.Column(db.Boolean, nullable=False)  # True for tracking, False for sharing only

    user = db.relationship("User", backref="locations")


class RecordingStop(db.Model):
    """
    One row per recording that has been marked complete.
    user_submitted=True  → the app explicitly posted /tracking-completed.
    user_submitted=False → the nightly script inferred completion (no update for 3+ days).
    """

    __tablename__ = "recording_stops"

    id = db.Column(db.Integer, primary_key=True)
    recording_id = db.Column(db.String(255), nullable=False, unique=True, index=True)
    user_submitted = db.Column(db.Boolean, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


with app.app_context():
    db.session.execute(
        text("""
        CREATE UNIQUE INDEX IF NOT EXISTS user_non_tracking_locations
        ON user_locations(user_id) WHERE tracking = false;
        """)
    )
    db.session.commit()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/location", methods=["POST"])
@login_required
def post_location():
    datalist = request.get_json() or []

    print(datalist)

    if type(datalist) != list:
        datalist = [datalist]

    for data in datalist:
        data["user_id"] = current_user.id

        assert -90 <= data["latitude"] <= 90
        assert -180 <= data["longitude"] <= 180
        assert 1700000000000 < data["timestamp"] < 111700000000000
        assert 0 <= data["accuracy"] <= 10000000
        assert data["speed"] is None or 0 <= data["speed"] <= 10000000
        assert type(data["tracking"]) == bool

        sql = text("""
            INSERT OR REPLACE INTO user_locations (
                user_id, recording_id, latitude, longitude,
                accuracy, timestamp, speed, tracking, created_at
            )
            VALUES (
                :user_id, :recording_id, :latitude, :longitude,
                :accuracy, :timestamp, :speed, :tracking, CURRENT_TIMESTAMP
            )
        """)

        db.session.execute(sql, data)
        db.session.commit()

    return jsonify({"success": True}), 201


@app.route("/tracking-completed", methods=["POST"])
@login_required
def tracking_completed():
    """
    Called by the app when the user explicitly stops tracking.
    Upserts a RecordingStop row with user_submitted=True.
    """
    data = request.get_json() or {}
    recording_id = data.get("recording_id")
    if not recording_id:
        return jsonify({"error": "recording_id required"}), 400

    # Verify the recording belongs to the current user
    exists = db.session.execute(
        text("SELECT 1 FROM user_locations WHERE recording_id = :rid AND user_id = :uid LIMIT 1"),
        {"rid": recording_id, "uid": current_user.id},
    ).fetchone()
    if not exists:
        return jsonify({"error": "Recording not found"}), 404

    existing = RecordingStop.query.filter_by(recording_id=recording_id).first()
    if existing is None:
        db.session.add(RecordingStop(recording_id=recording_id, user_submitted=True))
        db.session.commit()
    elif not existing.user_submitted:
        # Upgrade inferred stop to user-submitted
        existing.user_submitted = True
        db.session.commit()

    return jsonify({"success": True}), 200


@app.route("/recording/<recording_id>", methods=["GET"])
@login_required
def get_recording(recording_id):
    """
    Returns the processed recording data for a single recording.
    Response body:
        {
            "recording_id": "...",
            "completed": true | false,
            "locations": [ ... ]
        }
    """
    stop = RecordingStop.query.filter_by(recording_id=recording_id).first()
    completed = stop is not None
    query = """
        SELECT * FROM user_locations
        WHERE recording_id = :recording_id and user_id = :user_id
        ORDER BY timestamp
    """
    with db.engine.connect() as conn:
        df = pd.read_sql(query, con=conn, params={"recording_id": recording_id, "user_id": current_user.id})
        if df.empty:
            return {"error": "Recording not found."}, 404
        simplified = process_recording(df, conn)
        records = simplified.to_dict("records")
        if not (len(simplified) > 1 or simplified["seconds_spent"].max() > 300):
            records = []

    data = {
        "recording_id": recording_id,
        "completed": completed,
        "locations": records,
    }

    response = make_response(jsonify(data))
    etag = hashlib.md5(response.get_data()).hexdigest()
    response.set_etag(etag)
    return response.make_conditional(request)


@app.route("/latest-recording/<location_share_secret>", methods=["GET"])
def get_latest_recording(location_share_secret):
    """Get the latest recording for a user via their location share secret"""
    try:
        sql = """
            WITH latest_entry AS (
                SELECT
                    ul.recording_id,
                    ul.tracking,
                    ul.timestamp,
                    u.username
                FROM user_locations ul
                INNER JOIN user u ON u.id = ul.user_id
                WHERE u.location_share_secret = :secret
                ORDER BY ul.timestamp DESC
                LIMIT 1
            )
            SELECT
                ul.*,
                le.username
            FROM user_locations ul
            INNER JOIN latest_entry le ON ul.recording_id = le.recording_id
            WHERE
                ul.user_id = (
                    SELECT id FROM user WHERE location_share_secret = :secret
                )
                AND (
                    (le.tracking = 0 AND ul.timestamp = le.timestamp)
                    OR le.tracking = 1
                )
            ORDER BY ul.timestamp ASC
        """

        df = pd.read_sql(sql, db.session.connection(), params={"secret": location_share_secret})

        if df.empty:
            return jsonify({"error": "No recordings found for this user"}), 404

        locations = df.to_dict(orient="records")

        return jsonify(
            {
                "success": True,
                "recording_id": locations[0]["recording_id"],
                "username": locations[0]["username"],
                "tracking": bool(locations[-1]["tracking"]),
                "locations": process_recording(locations),
            }
        ), 200

    except Exception as e:
        logger.error(f"Error fetching latest recording: {e}")
        return jsonify({"error": "Failed to fetch recording"}), 500


@app.route("/delete-recording/<recording_id>", methods=["DELETE"])
@login_required
def delete_recording(recording_id):
    """Delete all locations for a specific recording"""
    try:
        count = db.session.execute(
            text("DELETE FROM user_locations WHERE user_id = :user_id AND recording_id = :recording_id"),
            {"user_id": current_user.id, "recording_id": recording_id},
        ).rowcount

        if count > 0:
            # Also clean up stop row
            db.session.execute(
                text("DELETE FROM recording_stops WHERE recording_id = :rid"),
                {"rid": recording_id},
            )

        db.session.commit()

        if count > 0:
            logger.info(f"Deleted {count} locations for recording {recording_id} by user {current_user.username}")
            return jsonify({"success": True, "deleted": count}), 200
        else:
            return jsonify({"error": "Recording not found or already deleted"}), 404

    except Exception as e:
        logger.error(f"Error deleting recording: {str(e)}")
        db.session.rollback()
        return jsonify({"error": "Failed to delete recording"}), 500
