import numpy as np
import pandas as pd
from math import radians, cos, sin, sqrt, atan2
from scipy.spatial import ConvexHull

EARTH_RADIUS_M = 6371000


# -----------------------
# Helper functions
# -----------------------
def latlon_to_xy_m(lat, lon, lat0, lon0):
    """Convert lat/lon to local Cartesian meters relative to (lat0, lon0)."""
    lat, lon, lat0, lon0 = map(np.radians, [lat, lon, lat0, lon0])
    dx = (lon - lon0) * np.cos(lat0) * EARTH_RADIUS_M
    dy = (lat - lat0) * EARTH_RADIUS_M
    return dx, dy


def haversine_m(lat1, lon1, lat2, lon2):
    """Vectorized haversine distance in meters."""
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arctan2(np.sqrt(a), np.sqrt(1 - a))


# -----------------------
# Outlier removal
# -----------------------
def remove_outliers(df, max_speed_kmh=200):
    """Remove points where the implied speed from previous point is unreasonably high."""
    df = df.sort_values("timestamp").reset_index(drop=True)
    lat_prev = df["latitude"].shift()
    lon_prev = df["longitude"].shift()
    ts_prev = df["timestamp"].shift()

    dt_hours = (df["timestamp"] - ts_prev) / 3_600_000
    dist_m = haversine_m(df["latitude"], df["longitude"], lat_prev, lon_prev)
    speed_kmh = (dist_m / 1000) / dt_hours

    mask = (dt_hours.isna()) | (speed_kmh <= max_speed_kmh)
    return df[mask].reset_index(drop=True)


# -----------------------
# 2D Kalman filter
# -----------------------
def kalman_smooth_2d(df, process_var=1e-4, meas_var=1e-2):
    """
    2D constant-velocity Kalman filter for latitude and longitude.
    """
    df = df.sort_values("timestamp").reset_index(drop=True)
    n = len(df)
    if n < 2:
        return df

    # Convert lat/lon to meters relative to first point
    lat0, lon0 = df.loc[0, ["latitude", "longitude"]]
    x, y = latlon_to_xy_m(df["latitude"].values, df["longitude"].values, lat0, lon0)

    # State: [x, y, vx, vy]
    state = np.array([x[0], y[0], 0.0, 0.0])
    P = np.eye(4) * 1.0  # covariance
    Q = np.eye(4) * process_var
    R = np.eye(2) * meas_var

    x_smooth = [x[0]]
    y_smooth = [y[0]]

    for i in range(1, n):
        dt = (df.loc[i, "timestamp"] - df.loc[i - 1, "timestamp"]) / 1000.0
        if dt <= 0:
            dt = 1.0

        # State transition
        F = np.array([[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]])
        state = F @ state
        P = F @ P @ F.T + Q

        # Measurement update
        z = np.array([x[i], y[i]])
        H = np.array([[1, 0, 0, 0], [0, 1, 0, 0]])
        y_residual = z - H @ state
        S = H @ P @ H.T + R
        K = P @ H.T @ np.linalg.inv(S)

        state = state + K @ y_residual
        P = (np.eye(4) - K @ H) @ P

        x_smooth.append(state[0])
        y_smooth.append(state[1])

    # Convert back to lat/lon
    lat_smooth = lat0 + np.array(y_smooth) / EARTH_RADIUS_M * (180 / np.pi)
    lon_smooth = lon0 + np.array(x_smooth) / (EARTH_RADIUS_M * np.cos(np.radians(lat0))) * (180 / np.pi)

    df = df.copy()
    df["latitude"] = lat_smooth
    df["longitude"] = lon_smooth
    return df


def merge_soliciting_events(
    df,
    # "Fast burst" detector
    fast_window=3,
    fast_speed_kmh=8.0,  # p50 must exceed this
    fast_consistency_kmh=4.0,  # p10 must exceed this
    fast_linearity=0.6,  # crow-flies / avg-speed ratio must exceed this
    # "Steady walk" detector
    walk_window=60,
    walk_median_kmh=4.0,
    walk_floor_kmh=1.5,
    # Grace period: how many consecutive not-moving samples before soliciting
    grace_samples=30,
):
    df = df.sort_values("timestamp").copy().reset_index(drop=True)

    # --- Sample-to-sample speed (km/h) ---
    lat_prev = df["latitude"].shift()
    lon_prev = df["longitude"].shift()
    ts_prev = df["timestamp"].shift()
    dt_hours = (df["timestamp"] - ts_prev) / 3_600_000
    dlat = np.radians(df["latitude"] - lat_prev)
    dlon = np.radians(df["longitude"] - lon_prev)
    lat1 = np.radians(lat_prev)
    lat2 = np.radians(df["latitude"])
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    dist_m = 2 * EARTH_RADIUS_M * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    df["speed_kmh"] = (dist_m / 1000) / dt_hours
    df["speed_kmh"] = df["speed_kmh"].fillna(0)

    spd = df["speed_kmh"]
    lats = df["latitude"].to_numpy()
    lons = df["longitude"].to_numpy()
    ts = df["timestamp"].to_numpy()

    # --- Detector 1: fast burst (directional) ---
    # For each window ending at `end`, compute:
    #   - p50 and p10 of per-sample speeds  (noise-robust speed check)
    #   - linearity = crow-flies speed / mean per-sample speed  (direction check)
    fast_p50 = spd.rolling(window=fast_window, min_periods=fast_window).quantile(0.50)
    fast_p10 = spd.rolling(window=fast_window, min_periods=fast_window).quantile(0.10)

    n = len(df)
    linearity = np.full(n, np.nan)
    for end in range(fast_window - 1, n):
        start = end - fast_window + 1
        dt_window_h = (ts[end] - ts[start]) / 3_600_000
        if dt_window_h <= 0:
            continue
        crow_flies_kmh = 1000 * haversine_m(lats[start], lons[start], lats[end], lons[end]) / dt_window_h
        mean_speed = spd.iloc[start : end + 1].mean()
        if mean_speed > 0:
            linearity[end] = crow_flies_kmh / mean_speed

    fast_mask = (
        (fast_p50 >= fast_speed_kmh).to_numpy() & (fast_p10 >= fast_consistency_kmh).to_numpy() & (linearity >= fast_linearity)
    )

    # --- Detector 2: steady walk (no direction requirement — walking meanders) ---
    walk_roll = spd.rolling(window=walk_window, min_periods=walk_window)
    walk_mask = ((walk_roll.quantile(0.50) >= walk_median_kmh) & (walk_roll.quantile(0.10) >= walk_floor_kmh)).to_numpy()

    # --- Expand each window back to all samples it covers ---
    definitely_moving = np.zeros(n, dtype=bool)
    for end in np.where(fast_mask)[0]:
        definitely_moving[max(0, end - fast_window + 1) : end + 1] = True
    for end in np.where(walk_mask)[0]:
        definitely_moving[max(0, end - walk_window + 1) : end + 1] = True

    # --- Grace period: only flip to soliciting after N consecutive not-moving samples ---
    hitchhiking = np.zeros(n, dtype=bool)
    not_moving_streak = 0
    for i in range(n):
        if definitely_moving[i]:
            not_moving_streak = 0
            hitchhiking[i] = False
        else:
            not_moving_streak += 1
            hitchhiking[i] = not_moving_streak >= grace_samples

    df["hitchhiking"] = hitchhiking

    # --- Merge contiguous hitchhiking rows into periods ---
    def convex_hull_coords(lats, lons):
        pts = np.column_stack([lats, lons])
        if len(pts) < 3:
            return None
        try:
            hull = ConvexHull(pts)
            vertices = pts[hull.vertices].tolist()
            return vertices + [vertices[0]]
        except Exception:
            return None

    # df["hitch_group"] = (True | ~df["hitchhiking"] | ~df["hitchhiking"].shift(1, fill_value=False)).cumsum()
    df["hitch_group"] = (~df["hitchhiking"] | ~df["hitchhiking"].shift(1, fill_value=False)).cumsum()
    periods = df.groupby("hitch_group", as_index=False).agg(
        latitude=("latitude", "median"),
        longitude=("longitude", "median"),
        accuracy=("accuracy", "median"),
        timestamp=("timestamp", "min"),
        ts_max=("timestamp", "max"),
        speed=("speed_kmh", "median"),
        convex_hull=(
            "latitude",
            lambda s: convex_hull_coords(s.values, df.loc[s.index, "longitude"].values),
        ),
    )
    periods["seconds_spent"] = ((periods["ts_max"] - periods["timestamp"]) / 1000).astype(int)
    periods = periods.drop(columns=["hitch_group", "ts_max"])
    return periods.reset_index(drop=True)


# -----------------------
# Simplify recording
# -----------------------
def simplify_recording(recording_df):
    """Process a single recording: outlier removal, Kalman filter, slow-point merge."""

    # Outlier removal
    recording_df = remove_outliers(recording_df)

    # 2D Kalman filter
    recording_df = kalman_smooth_2d(recording_df)

    # Merge slow points
    recording_df = merge_soliciting_events(recording_df)

    return recording_df
