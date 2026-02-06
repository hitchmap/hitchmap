import numpy as np
import pandas as pd
from math import radians, sin, cos, sqrt, atan2

EARTH_RADIUS_M = 6371000


def latlon_to_xy_m(lat, lon, lat0, lon0):
    """
    Local tangent plane approximation.
    Returns dx, dy in meters relative to (lat0, lon0).
    """
    lat, lon, lat0, lon0 = map(np.radians, [lat, lon, lat0, lon0])

    dx = (lon - lon0) * np.cos(lat0) * EARTH_RADIUS_M
    dy = (lat - lat0) * EARTH_RADIUS_M
    return dx, dy


def merge_slow_points_grid_df(
    df,
    speed_kmh=4.0,
    grid_size_m=200,
):
    """
    df columns: recording_id, latitude, longitude, timestamp
    returns: merged DataFrame
    """
    # 1. MERGE POINTS INTO SEGMENTS WHERE MOVEMENT WAS LESS THAN 1 KM/H
    df = df.sort_values(["recording_id", "timestamp"]).copy()

    # --- previous point ---
    df["lat_prev"] = df.groupby("recording_id")["latitude"].shift()
    df["lon_prev"] = df.groupby("recording_id")["longitude"].shift()
    df["ts_prev"] = df.groupby("recording_id")["timestamp"].shift()

    # --- speed ---
    dt_hours = (df["timestamp"] - df["ts_prev"]) / 3600 / 1000
    print(dt_hours)

    dlat = np.radians(df["latitude"] - df["lat_prev"])
    dlon = np.radians(df["longitude"] - df["lon_prev"])
    lat1 = np.radians(df["lat_prev"])
    lat2 = np.radians(df["latitude"])

    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    dist_prev = 2 * EARTH_RADIUS_M * np.arctan2(np.sqrt(a), np.sqrt(1 - a))

    speed = (dist_prev / 1000) / dt_hours

    # --- initial segment split (speed-based) ---
    break_mask = df["lat_prev"].isna() | (dt_hours <= 0) | (speed >= speed_kmh)

    df["segment"] = break_mask.groupby(df["recording_id"]).cumsum()

    # 2. SPLIT SEGMENTS THAT ARE FURTHER THAN ~100-200M APART
    # --- segment anchor ---
    df["lat_anchor"] = df.groupby(["recording_id", "segment"])["latitude"].transform("first")

    df["lon_anchor"] = df.groupby(["recording_id", "segment"])["longitude"].transform("first")

    # --- grid coordinates relative to anchor ---
    dx, dy = latlon_to_xy_m(
        df["latitude"],
        df["longitude"],
        df["lat_anchor"],
        df["lon_anchor"],
    )

    half = grid_size_m / 2

    df["grid_x"] = np.floor((dx + half) / grid_size_m).astype(int)
    df["grid_y"] = np.floor((dy + half) / grid_size_m).astype(int)

    # 3. AVERAGE SEGMENTS
    # --- aggregate ---
    merged = (
        df.groupby(
            ["recording_id", "segment", "grid_x", "grid_y"],
            as_index=False,
        )
        .agg(
            latitude=("latitude", "median"),
            longitude=("longitude", "median"),
            timestamp=("timestamp", "mean"),
        )
        .drop(columns=["segment", "grid_x", "grid_y"])
    )

    return merged
