import numpy as np
import pandas as pd
from math import radians, sin, cos, sqrt, atan2

EARTH_RADIUS_M = 6371000


def latlon_to_xy_m(lat, lon, lat0, lon0):
    lat, lon, lat0, lon0 = map(np.radians, [lat, lon, lat0, lon0])
    dx = (lon - lon0) * np.cos(lat0) * EARTH_RADIUS_M
    dy = (lat - lat0) * EARTH_RADIUS_M
    return dx, dy


def haversine_m(lat1, lon1, lat2, lon2):
    """Vectorised haversine, returns distance in metres."""
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arctan2(np.sqrt(a), np.sqrt(1 - a))


def remove_short_loops(df, loop_speed_kmh=0.1, min_loop_minutes=30):
    """
    Remove loops: if points A and B are separated in time by ≤ min_loop_minutes
    but the straight-line speed between them is ≤ loop_speed_kmh, everything
    strictly between A and B is considered a loop and dropped.

    Works per recording_id on an already-sorted DataFrame with columns:
    recording_id, latitude, longitude, timestamp (ms).
    """
    result_parts = []

    for rec_id, grp in df.groupby("recording_id", sort=False):
        grp = grp.reset_index(drop=True)
        n = len(grp)
        keep = np.ones(n, dtype=bool)

        i = 0
        while i < n:
            if not keep[i]:
                i += 1
                continue

            # Look ahead for a point that is "close enough" to be a loop end
            best_j = None
            for j in range(i + 2, n):  # need at least one point in between
                if not keep[j]:
                    continue
                dt_ms = grp.loc[j, "timestamp"] - grp.loc[i, "timestamp"]
                dt_hours = dt_ms / 3_600_000
                dt_minutes = dt_ms / 60_000

                if dt_minutes > min_loop_minutes:
                    break  # too far in time, no point searching further

                dist_m = haversine_m(
                    grp.loc[i, "latitude"],
                    grp.loc[i, "longitude"],
                    grp.loc[j, "latitude"],
                    grp.loc[j, "longitude"],
                )
                if dt_hours > 0:
                    speed_kmh = (dist_m / 1000) / dt_hours
                else:
                    speed_kmh = float("inf")

                if speed_kmh <= loop_speed_kmh:
                    best_j = j  # keep searching — take the furthest valid j

            if best_j is not None:
                # Mark everything strictly between i and best_j as a loop
                for k in range(i + 1, best_j):
                    keep[k] = False
                i = best_j  # continue from the loop end
            else:
                i += 1

        result_parts.append(grp[keep])

    return pd.concat(result_parts, ignore_index=True)


def merge_slow_points_grid_df(
    df,
    speed_kmh=4.0,
    grid_size_m=200,
    loop_speed_kmh=0.1,
    loop_minutes=30,
):
    """
    df columns: recording_id, latitude, longitude, timestamp (ms epoch)
    returns: merged DataFrame with seconds_spent column
    """
    # 1. MERGE POINTS INTO SEGMENTS WHERE MOVEMENT WAS LESS THAN speed_kmh
    df = df.sort_values(["recording_id", "timestamp"]).copy()

    df["lat_prev"] = df.groupby("recording_id")["latitude"].shift()
    df["lon_prev"] = df.groupby("recording_id")["longitude"].shift()
    df["ts_prev"] = df.groupby("recording_id")["timestamp"].shift()

    dt_hours = (df["timestamp"] - df["ts_prev"]) / 3_600_000
    dlat = np.radians(df["latitude"] - df["lat_prev"])
    dlon = np.radians(df["longitude"] - df["lon_prev"])
    lat1 = np.radians(df["lat_prev"])
    lat2 = np.radians(df["latitude"])
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    dist_prev = 2 * EARTH_RADIUS_M * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    speed = (dist_prev / 1000) / dt_hours

    break_mask = (dt_hours > 0) & (df["lat_prev"].isna() | (speed >= speed_kmh))
    df["segment"] = break_mask.groupby(df["recording_id"]).cumsum()

    # 2. SPLIT SEGMENTS THAT ARE FURTHER THAN ~grid_size_m APART
    df["lat_anchor"] = df.groupby(["recording_id", "segment"])["latitude"].transform("first")
    df["lon_anchor"] = df.groupby(["recording_id", "segment"])["longitude"].transform("first")

    dx, dy = latlon_to_xy_m(
        df["latitude"],
        df["longitude"],
        df["lat_anchor"],
        df["lon_anchor"],
    )
    # calculate grid locations, merge the nearest 8 grid cells with with the center cell
    df["grid_x"] = np.round(dx / grid_size_m).astype(int).replace({-1: 0, 1: 0})
    df["grid_y"] = np.round(dy / grid_size_m).astype(int).replace({-1: 0, 1: 0})

    # 3. AGGREGATE SEGMENTS — also track time span for seconds_spent
    merged = (
        df.groupby(
            ["recording_id", "segment", "grid_x", "grid_y"],
            as_index=False,
        )
        .agg(
            latitude=("latitude", "median"),
            longitude=("longitude", "median"),
            timestamp=("timestamp", "min"),
            ts_max=("timestamp", "max"),
            n_pts=("timestamp", "count"),
        )
        .drop(columns=["segment", "grid_x", "grid_y"])
    )

    # seconds_spent > 0 only for merged (slow) clusters, 0 for lone points
    merged["seconds_spent"] = ((merged["ts_max"] - merged["timestamp"]) / 1000).astype(int)
    merged = merged.drop(columns=["ts_max", "n_pts"])

    # 4. REMOVE SHORT LOOPS
    merged = merged.sort_values(["recording_id", "timestamp"])
    merged = remove_short_loops(merged, loop_speed_kmh=loop_speed_kmh, min_loop_minutes=loop_minutes)

    return merged.reset_index(drop=True)
