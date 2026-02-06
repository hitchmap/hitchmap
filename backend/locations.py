import pandas as pd
from datetime import datetime
from flask import jsonify, request
from flask_security import current_user, login_required
from sqlalchemy import text

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
    created_at = db.Column(db.DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    tracking = db.Column(db.Boolean, nullable=False)  # True for tracking, False for sharing only

    user = db.relationship("User", backref="locations")


with app.app_context():
    db.session.execute(
        text("""
        CREATE UNIQUE INDEX IF NOT EXISTS user_non_tracking_locations
        ON user_locations(user_id) WHERE tracking = false;
        """)
    )
    db.session.commit()


@app.route("/location", methods=["POST"])
@login_required
def post_location():
    datalist = request.get_json() or []
    for data in datalist:
        # Add server-side fields
        data["user_id"] = current_user.id

        # replace if tracking = true due to the unique index
        sql = text("""
            INSERT OR REPLACE INTO user_locations (
                user_id, recording_id, latitude, longitude,
                accuracy, timestamp, speed, heading, tracking
            )
            VALUES (
                :user_id, :recording_id, :latitude, :longitude,
                :accuracy, :timestamp, :speed, :heading, :tracking
            )
        """)

        db.session.execute(sql, data)
        db.session.commit()

        return jsonify({"success": True}), 201


@app.route("/latest-recording/<location_share_secret>", methods=["GET"])
def get_latest_recording(location_share_secret):
    """Get the latest recording for a user via their location share secret"""
    try:
        # Use CTE to capture the latest recording state atomically
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
                ul.id,
                ul.user_id,
                ul.recording_id,
                ul.latitude,
                ul.longitude,
                ul.accuracy,
                ul.timestamp,
                ul.speed,
                ul.heading,
                ul.tracking,
                le.username
            FROM user_locations ul
            INNER JOIN latest_entry le ON ul.recording_id = le.recording_id
            WHERE
                ul.user_id = (
                    SELECT id FROM user WHERE location_share_secret = :secret
                )
                AND (
                    -- If latest entry has tracking=false, only return that one row
                    (le.tracking = 0 AND ul.timestamp = le.timestamp)
                    -- Otherwise return all rows with the recording_id
                    OR le.tracking = 1
                )
            ORDER BY ul.timestamp ASC
        """

        # Execute query and convert to DataFrame
        df = pd.read_sql(sql, db.session.connection(), params={"secret": location_share_secret})

        if df.empty:
            return jsonify({"error": "No recordings found for this user"}), 404

        # Convert to list of dictionaries
        locations = df.to_dict(orient="records")

        return jsonify(
            {
                "success": True,
                "recording_id": locations[0]["recording_id"],
                "username": locations[0]["username"],
                "tracking": bool(locations[-1]["tracking"]),
                "locations": locations,
            }
        ), 200

        return jsonify({"success": True, "recording_id": locations[0]["recording_id"], "locations": locations}), 200

    except Exception as e:
        logger.error(f"Error fetching latest recording: {e}")
        return jsonify({"error": "Failed to fetch recording"}), 500


@app.route("/delete-recording/<recording_id>", methods=["DELETE"])
@login_required
def delete_recording(recording_id):
    """Delete all locations for a specific recording"""
    try:
        # Verify the recording belongs to the current user
        count = db.session.execute(
            text("DELETE FROM user_locations WHERE user_id = :user_id AND recording_id = :recording_id"),
            {"user_id": current_user.id, "recording_id": recording_id},
        ).rowcount

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
