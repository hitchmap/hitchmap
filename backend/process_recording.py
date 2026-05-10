import numpy as np
import pandas as pd
from math import radians, cos, sin, sqrt, atan2
from scipy.spatial import ConvexHull
from shapely.geometry import Point, MultiPoint
import shapely

import base64

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


from scipy.ndimage import maximum_filter1d, binary_opening


def merge_soliciting_events(
    df,
    # "Fast burst" detector
    fast_window=7,  # 35 seconds
    fast_speed_kmh=10.0,
    fast_consistency_kmh=8.0,
    fast_linearity=0.6,
    # "Steady walk" detector
    walk_window=60,  # 5 minutes
    walk_median_kmh=4.0,
    walk_floor_kmh=1.5,
    walk_linearity=0.3,
    # Minimum soliciting period
    min_soliciting_period=30,
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

    n = len(df)

    def vectorized_linearity(window):
        end_idx = np.arange(n)
        start_idx = end_idx - window + 1

        dt_window_h = (ts[end_idx] - ts[np.maximum(start_idx, 0)]) / 3_600_000

        lat1_r = np.radians(lats[np.maximum(start_idx, 0)])
        lon1_r = np.radians(lons[np.maximum(start_idx, 0)])
        lat2_r = np.radians(lats[end_idx])
        lon2_r = np.radians(lons[end_idx])
        dlat_w = lat2_r - lat1_r
        dlon_w = lon2_r - lon1_r
        a_w = np.sin(dlat_w / 2) ** 2 + np.cos(lat1_r) * np.cos(lat2_r) * np.sin(dlon_w / 2) ** 2
        crow_flies_m = 2 * EARTH_RADIUS_M * np.arctan2(np.sqrt(a_w), np.sqrt(1 - a_w))
        crow_flies_kmh = (crow_flies_m / 1000) / np.where(dt_window_h > 0, dt_window_h, np.nan)

        mean_speed = spd.rolling(window=window, min_periods=window).mean().to_numpy()
        safe_mean_speed = np.where(mean_speed > 0, mean_speed, np.nan)
        lin = crow_flies_kmh / safe_mean_speed
        lin[: window - 1] = np.nan
        return lin

    # --- Detector 1: fast burst ---
    fast_p50 = spd.rolling(window=fast_window, min_periods=fast_window).quantile(0.50)
    fast_p10 = spd.rolling(window=fast_window, min_periods=fast_window).quantile(0.10)
    fast_lin = vectorized_linearity(fast_window)

    fast_mask = (
        (fast_p50 >= fast_speed_kmh).to_numpy() & (fast_p10 >= fast_consistency_kmh).to_numpy() & (fast_lin >= fast_linearity)
    )

    # --- Detector 2: steady walk ---
    walk_roll = spd.rolling(window=walk_window, min_periods=walk_window)
    walk_lin = vectorized_linearity(walk_window)

    walk_mask = (
        (walk_roll.quantile(0.50) >= walk_median_kmh).to_numpy()
        & (walk_roll.quantile(0.10) >= walk_floor_kmh).to_numpy()
        & ((walk_lin >= walk_linearity) | np.isnan(walk_lin))
    )

    # --- Expand detector windows back to all covered samples via max-pooling ---
    fast_expanded = maximum_filter1d(
        fast_mask.astype(np.uint8),
        size=fast_window,
        origin=-(fast_window // 2),
    ).astype(bool)

    walk_expanded = maximum_filter1d(
        walk_mask.astype(np.uint8),
        size=walk_window,
        origin=-(walk_window // 2),
    ).astype(bool)

    definitely_moving = fast_expanded | walk_expanded

    # --- Soliciting = ~definitely_moving, with short runs scrubbed ---
    # binary_opening erodes then dilates: any True run shorter than
    # min_soliciting_period is removed; longer runs are restored intact.
    structure = np.ones(min_soliciting_period, dtype=bool)
    soliciting = binary_opening(~definitely_moving, structure=structure)

    df["soliciting"] = soliciting
    df["walk_lin"] = np.nan_to_num(walk_lin)

    # --- Merge contiguous soliciting rows into periods ---
    def convex_hull_coords(lats, lons):
        pts = [(lon, lat) for lat, lon in zip(lats, lons)]
        if len(pts) < 2:
            return None
        try:
            return MultiPoint(pts).convex_hull
        except Exception:
            return None

    df["hitchhike_group"] = (~df["soliciting"] | ~df["soliciting"].shift(1, fill_value=False)).cumsum()
    periods = df.groupby("hitchhike_group", as_index=False).agg(
        latitude=("latitude", "median"),
        longitude=("longitude", "median"),
        accuracy=("accuracy", "median"),
        timestamp=("timestamp", "min"),
        ts_max=("timestamp", "max"),
        speed=("speed_kmh", "median"),
        walk_lin=("walk_lin", "median"),
        convex_hull=(
            "latitude",
            lambda s: convex_hull_coords(s.values, df.loc[s.index, "longitude"].values),
        ),
    )
    periods["seconds_spent"] = ((periods["ts_max"] - periods["timestamp"]) / 1000).astype(int)
    periods = periods.drop(columns=["hitchhike_group", "ts_max"])
    return periods.reset_index(drop=True)


def find_nearby_points(periods_df, db_con):
    RADIUS_M = 10.0
    PAD_M = 11.1
    PAD_DEGREES = 0.0001

    def point_near_hull(pt, hull):
        if hull.contains(pt):
            return True
        nearest = hull.exterior.interpolate(hull.exterior.project(pt))
        return haversine_m(pt.y, pt.x, nearest.y, nearest.x) <= PAD_M

    def bbox(lat, lon, hull):
        if hull is not None:
            min_lon, min_lat, max_lon, max_lat = hull.bounds
        else:
            min_lat, max_lat, min_lon, max_lon = lat, lat, lon, lon
        return min_lat - PAD_DEGREES, max_lat + PAD_DEGREES, min_lon - PAD_DEGREES, max_lon + PAD_DEGREES

    periods_df = periods_df.copy()
    periods_df["nearby_point"] = None
    for pos, (_, row) in enumerate(periods_df.iterrows()):
        if row["seconds_spent"] == 0:
            continue
        lat, lon = row["latitude"], row["longitude"]
        hull = row.get("convex_hull")
        min_lat, max_lat, min_lon, max_lon = bbox(lat, lon, hull)
        candidates = pd.read_sql(
            "SELECT id, lat, lon FROM points"
            " WHERE NOT banned AND revised_by IS NULL"
            " AND lat BETWEEN :min_lat AND :max_lat AND lon BETWEEN :min_lon AND :max_lon",
            db_con,
            params=dict(min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon),
        )
        # don't touch this
        candidates["short_id"] = candidates["id"].apply(lambda x: base64.urlsafe_b64encode(x.to_bytes(8, "big")).decode("ascii"))
        best_short_id = None
        best_dist = float("inf")
        for _, c in candidates.iterrows():
            pt = Point(c.lon, c.lat)
            hit = point_near_hull(pt, hull) if hull is not None else haversine_m(c.lat, c.lon, lat, lon) <= RADIUS_M
            if hit:
                dist = haversine_m(c.lat, c.lon, lat, lon)
                if dist < best_dist:
                    best_dist = dist
                    best_short_id = c.short_id
        periods_df.loc[pos, "nearby_point"] = best_short_id
    return periods_df


# -----------------------
# Process recording
# -----------------------
def process_recording(recording_df, db_con=None):
    """Process a single recording: outlier removal, Kalman filter, slow-point merge."""

    # Outlier removal
    recording_df = remove_outliers(recording_df)

    # 2D Kalman filter
    recording_df = kalman_smooth_2d(recording_df)

    # Merge slow points
    recording_df = merge_soliciting_events(recording_df)

    if db_con:
        recording_df = find_nearby_points(recording_df, db_con)

    del recording_df["convex_hull"]

    return recording_df
