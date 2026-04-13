#!/usr/bin/env python3
"""
cache_recordings.py
-------------------
Maintenance script to back-fill inferred recording stops and cache processed recordings.

Run directly:
    python cache_recordings.py
"""

import logging
import sqlite3
import json
import hashlib
from datetime import datetime, timedelta

import pandas as pd

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.process_recording import process_recording
from helpers import get_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

STALE_DAYS = 3

DDL = """
CREATE TABLE IF NOT EXISTS recording_stops (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id   TEXT    NOT NULL UNIQUE,
    user_submitted INTEGER NOT NULL,
    created_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS cached_recordings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id   TEXT NOT NULL UNIQUE,
    user_id        INTEGER NOT NULL,
    data           TEXT NOT NULL,
    data_hash      TEXT NOT NULL,
    created_at     TEXT NOT NULL
);
"""

cutoff = datetime.utcnow() - timedelta(days=STALE_DAYS)
log.info("Cutoff for inferred stops: %s UTC", cutoff.isoformat())

con = get_db()
con.row_factory = sqlite3.Row
con.executescript(DDL)

# ── Step 1: back-fill inferred stops ─────────────────────────────────────────

cutoff_str = cutoff.isoformat(sep=" ", timespec="seconds")
now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")

rows = con.execute(
    """
    SELECT ul.recording_id
    FROM user_locations ul
    LEFT JOIN recording_stops rs ON rs.recording_id = ul.recording_id
    WHERE rs.id IS NULL
    GROUP BY ul.recording_id
    HAVING MAX(ul.created_at) < ?
    """,
    (cutoff_str,),
).fetchall()

inserted = 0
for (recording_id,) in rows:
    con.execute(
        "INSERT OR IGNORE INTO recording_stops (recording_id, user_submitted, created_at) VALUES (?, 0, ?)",
        (recording_id, now),
    )
    inserted += con.execute("SELECT changes()").fetchone()[0]

con.commit()
if inserted:
    log.info("Inserted %d inferred stop events (user_submitted=0)", inserted)

# ── Step 2: recompute + cache all completed recordings ────────────────────────

completed_ids = [r[0] for r in con.execute("SELECT recording_id FROM recording_stops").fetchall()]
log.info("Recomputing %d completed recordings …", len(completed_ids))

written = skipped = missing = 0
for recording_id in completed_ids:
    df = pd.read_sql(
        "SELECT * FROM user_locations WHERE recording_id = ? ORDER BY timestamp",
        con,
        params=(recording_id,),
    )
    if df.empty:
        log.debug("  %s → no data", recording_id)
        missing += 1
        continue

    user_id = df["user_id"].iloc[0]

    simplified = process_recording(df, con)

    if not (len(simplified) > 1 or simplified["seconds_spent"].max() > 300):
        log.debug("  %s → filtered out", recording_id)
        missing += 1
        continue

    records = simplified.to_dict("records")
    data_str = json.dumps(records, default=str)
    data_hash = hashlib.sha256(data_str.encode()).hexdigest()
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")

    existing = con.execute(
        "SELECT data_hash FROM cached_recordings WHERE recording_id = ?",
        (recording_id,),
    ).fetchone()

    if existing is None:
        con.execute(
            "INSERT INTO cached_recordings (recording_id, user_id, data, data_hash, created_at) VALUES (?, ?, ?, ?, ?)",
            (recording_id, user_id, data_str, data_hash, now),
        )
        con.commit()
        log.info("  %s → cached (%d points)", recording_id, len(records))
        written += 1
    elif existing[0] != data_hash:
        con.execute(
            "UPDATE cached_recordings SET user_id = ?, data = ?, data_hash = ?, created_at = ? WHERE recording_id = ?",
            (user_id, data_str, data_hash, now, recording_id),
        )
        con.commit()
        log.info("  %s → updated (%d points)", recording_id, len(records))
        written += 1
    else:
        log.debug("  %s → unchanged, skipped", recording_id)
        skipped += 1

log.info("Done. written=%d  unchanged=%d  filtered/empty=%d", written, skipped, missing)
con.close()
