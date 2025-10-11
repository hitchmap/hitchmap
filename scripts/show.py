import html
import locale
import os
import sys
import base64
from jinja2 import Environment, FileSystemLoader

import subprocess

import networkx
import numpy as np
import pandas as pd
import geopandas
import geopandas as gpd
from helpers import get_bearing, haversine_np, root_dir, get_db, slugify, db_dir

LANG = None
for arg in sys.argv:
    if len(arg) == 2:
        LANG = arg

dist_dir_root = os.path.abspath(os.path.join(root_dir, "dist"))

if LANG:
    subprocess.run(["python", "translate-templates.py"], check=True, text=True)
    dist_dir = os.path.abspath(os.path.join(root_dir, "dist", LANG))
    template_dir = os.path.abspath(os.path.join(dist_dir, "translated-templates"))
else:
    dist_dir = dist_dir_root
    template_dir = os.path.abspath(os.path.join(root_dir, "templates"))

# Set up Jinja2 environment
env = Environment(loader=FileSystemLoader(template_dir))  # Load templates from current directory
template = env.get_template("index_template.html")  # Load template file
service_template = env.get_template("service_template.html")  # Load template file
service_index = env.get_template("service_index.html")  # Load template file
city_index = env.get_template("city_index.html")  # Load template file
city_template = env.get_template("city_template.html")  # Load template file
country_index = env.get_template("country_index.html")  # Load template file
country_template = env.get_template("country_template.html")  # Load template file

os.makedirs(dist_dir, exist_ok=True)

LIGHT = "light" in sys.argv
SERVICE_AREAS = "service" in sys.argv
CITIES = "city" in sys.argv
COUNTRIES = "country" in sys.argv

outname = os.path.join(dist_dir, "light.html") if LIGHT else os.path.join(dist_dir, "index.html")

outname_recent = os.path.join(dist_dir, "recent.html")
outname_dups = os.path.join(dist_dir, "recent-dups.html")

# keep right before reading the points
generation_date = pd.Timestamp.utcnow().isoformat()

points = pd.read_sql(
    sql="select * from points where not banned and revised_by is null order by datetime is not null desc, datetime desc",
    con=get_db(),
)

points["user_id"] = points["user_id"].astype(pd.Int64Dtype())

duplicates = pd.read_sql("select * from duplicates where reviewed = accepted", get_db())

# merging and transforming data
dup_rads = duplicates[["from_lon", "from_lat", "to_lon", "to_lat"]].values.T

duplicates["distance"] = haversine_np(*dup_rads)
duplicates["from"] = duplicates[["from_lat", "from_lon"]].apply(tuple, axis=1)
duplicates["to"] = duplicates[["to_lat", "to_lon"]].apply(tuple, axis=1)

duplicates = duplicates[duplicates.distance < 1.25]

dups = networkx.from_pandas_edgelist(duplicates, "from", "to")
islands = networkx.connected_components(dups)

replace_map = {}

for island in islands:
    parents = [node for node in island if node not in duplicates["from"].tolist()]

    if len(parents) == 1:
        for node in island:
            if node != parents[0]:
                replace_map[node] = parents[0]

print("Currently recorded duplicate spots are represented by:", dups)

points[["lat", "lon"]] = points[["lat", "lon"]].apply(lambda x: replace_map.get(tuple(x), x), axis=1, raw=True)

points = geopandas.GeoDataFrame(points, geometry=geopandas.points_from_xy(points.lon, points.lat), crs="EPSG:4326")

service_areas = pd.read_sql("select * from service_areas", get_db())
service_area_geoms = gpd.GeoDataFrame(
    service_areas[["geom_id", "name"]],
    geometry=gpd.GeoSeries.from_wkt(service_areas.geometry_wkt),
    crs="EPSG:4326",
)

points_service_area = points.sjoin(service_area_geoms, how="left").sort_values("geom_id").drop_duplicates("id")
points["service_area_id"] = points_service_area["geom_id"]
points["service_area_name"] = points_service_area["name"]

road_islands = pd.read_sql("select * from road_islands", get_db())
road_island_geoms = gpd.GeoDataFrame(
    road_islands[["id"]],
    geometry=gpd.GeoSeries.from_wkt(road_islands.geometry_wkt),
    crs="EPSG:4326",
)

points["road_island_id"] = points.sjoin(road_island_geoms, how="left").drop_duplicates("id_left")["id_right"]


# pseudo-random cluster id based on lat/lon
points["cluster_id"] = (points.lat * 1e10 + points.lon * 1e10).round()

has_road_island = points.road_island_id.notna()
points.loc[has_road_island, "cluster_id"] = points[has_road_island].road_island_id + 1e9

has_service_area = points.service_area_id.notna()
points.loc[has_service_area, "cluster_id"] = points[has_service_area].service_area_id + 5e9

try:
    users = pd.read_sql("select * from user", get_db())
except pd.errors.DatabaseError:
    raise Exception("Run server.py to create the user table") from None

print(f"{len(points)} points currently")

# fix hitchwiki comments
points.loc[points.id.isin(range(1000000, 1040000)), "comment"] = (
    points.loc[points.id.isin(range(1000000, 1040000)), "comment"]
    .str.encode("cp1252", errors="ignore")
    .str.decode("utf-8", errors="ignore")
)

points["datetime"] = pd.to_datetime(points.datetime)
points["ride_datetime"] = pd.to_datetime(points.ride_datetime, errors="coerce")  # handels invalid dates

rads = points[["lon", "lat", "dest_lon", "dest_lat"]].values.T

points["ride_distance"] = haversine_np(*rads)
points["direction"] = get_bearing(*rads)

points.loc[(points.ride_distance < 1), "dest_lat"] = None
points.loc[(points.ride_distance < 1), "dest_lon"] = None
points.loc[(points.ride_distance < 1), "direction"] = None
points.loc[(points.ride_distance < 1), "ride_distance"] = None

rounded_dir = 45 * np.round(points.direction / 45)
points["arrows"] = rounded_dir.replace(
    {
        -90: "←",
        90: "→",
        0: "↑",
        180: "↓",
        -180: "↓",
        -45: "↖",
        45: "↗",
        135: "↘",
        -135: "↙",
    }
)


rating_text = "rating: " + points.rating.astype(int).astype(str) + "/5"
destination_text = (
    ", ride: " + np.round(points.ride_distance).astype(str).str.replace(".0", "", regex=False) + " km " + points.arrows
)


points["wait_text"] = None
has_accurate_wait = ~points.wait.isnull() & ~points.datetime.isnull()
points.loc[has_accurate_wait, "wait_text"] = (
    ", wait: "
    + points.wait[has_accurate_wait].astype(int).astype(str)
    + " min"
    + (" " + points.signal[has_accurate_wait].replace({"ask": "💬", "ask-sign": "💬+🪧", "sign": "🪧", "thumb": "👍"})).fillna("")
)


def e(s):
    s2 = s.copy()
    s2.loc[~s2.isnull()] = s2.loc[~s2.isnull()].map(lambda x: html.escape(x).replace("\n", "<br>"))
    return s2


points["extra_text"] = rating_text + points.wait_text.fillna("") + destination_text.fillna("")

comment_nl = points["comment"] + "\n\n"

# show review without comments in the sidebar if they're new; old reviews may be aggregate ratings that don't make sense
comment_nl.loc[(points.datetime.dt.year > 2021) & points.comment.isnull()] = ""

points["username"] = pd.merge(
    left=points[["user_id"]],
    right=users[["id", "username"]],
    left_on="user_id",
    right_on="id",
    how="left",
)["username"]
points["hitchhiker"] = points["nickname"].fillna(points["username"])

points["user_link"] = ("<a href='/?user=" + e(points["hitchhiker"]) + "'>" + e(points["hitchhiker"]) + "</a>").fillna("Anonymous")

# base64 encoded id
points["short_id"] = points["id"].apply(lambda x: base64.b64encode(x.to_bytes(8, "big")).decode("ascii"))

points["datetime_str"] = points.datetime.dt.strftime(", %B %Y").fillna("")
points["hitchhiker_str"] = points.hitchhiker.fillna("Anonymous")

if LANG:
    translations_df = pd.read_sql(
        """SELECT point_id, translated_comment, is_original
        FROM comment_translations
        WHERE language = ?
        """,
        get_db(),
        params=(LANG,),
    )

    # Merge translations with points
    points = points.merge(translations_df, left_on="id", right_on="point_id", how="left")

    # Replace comment with translation where available, otherwise keep original
    points["comment"] = points["translated_comment"].fillna(points["comment"])

    # Set is_original: True if no translation exists (NaN), otherwise use the value from translations
    points["is_original"] = points["is_original"].fillna(True).astype(bool)

    # Clean up temporary columns
    points.drop(columns=["point_id", "translated_comment"], inplace=True)
else:
    points["is_original"] = True

groups = points.groupby("cluster_id")

print("After clustering:", len(groups), "Before:", len(points.geometry.drop_duplicates()))

# Create individual review data with all fields needed for rendering
review_data = points[
    [
        "lat",
        "lon",
        "rating",
        "wait",
        "comment",
        "ride_distance",
        "arrows",
        "hitchhiker",
        "datetime",
        "ride_datetime",
        "country",
        "dest_lat",
        "dest_lon",
        "short_id",
        "is_original",
    ]
].copy()

# Add a unique index for each review
review_data["review_index"] = review_data.index

# Convert to JSON-serializable format
review_data_json = review_data.to_json(orient="values")
review_columns = review_data.columns.to_series().to_json(orient="values")

places = groups[["country", "service_area_name"]].first()
places["rating"] = groups.rating.mean().round()
places["wait"] = points[~points.wait.isnull()].groupby("cluster_id").wait.mean()
places["ride_distance"] = points[~points.ride_distance.isnull()].groupby("cluster_id").ride_distance.mean()
# places["text"] = groups.text.apply(lambda t: "<hr>".join(t.dropna()))
places["text"] = ""
places["review_count"] = groups.size()
# Store indices of reviews instead of the text
places["review_indices"] = groups.apply(lambda g: g.index.tolist())

# to prevent confusion, only add a review user if they have a text written
# places["reviews"] = (
#     points.dropna(subset=["text", "hitchhiker"]).groupby("cluster_id").apply(lambda g: list(zip(g.hitchhiker, g.ride_datetime)))
# )

places["dest_lats"] = points.dropna(subset=["dest_lat", "dest_lon"]).groupby("cluster_id").dest_lat.apply(list)
places["dest_lons"] = points.dropna(subset=["dest_lat", "dest_lon"]).groupby("cluster_id").dest_lon.apply(list)
places["lat"] = groups.lat.mean()
places["lon"] = groups.lon.mean()


if LIGHT:
    places = places[(places.text.str.len() > 0) | ~places.ride_distance.isnull()]
elif SERVICE_AREAS:
    service_area_folder = os.path.join(dist_dir, "service-area")
    os.makedirs(service_area_folder, exist_ok=True)
    service_places = places.loc[places.service_area_name.notna()].copy()
    service_places["text_len"] = service_places.text.str.len()
    service_places["slug"] = service_places.service_area_name.apply(slugify)
    service_places = service_places.sort_values("text_len", ascending=False).drop_duplicates("slug")
    for _i, place in service_places.iterrows():
        rendered = service_template.render(place=place, title=place["service_area_name"])
        with open(os.path.join(service_area_folder, f"{place['slug']}.html"), "w") as f:
            f.write(rendered)
    index_rendered = service_index.render(grouped_places=service_places.groupby("country"))
    with open(os.path.join(service_area_folder, "index.html"), "w") as f:
        f.write(index_rendered)
elif CITIES:
    points.sort_values("datetime", inplace=True, ascending=False)
    cities = pd.read_csv(os.path.join(db_dir, "cities.csv")).drop_duplicates().sort_values("city")
    rendered_cities = []

    for city in cities.itertuples():
        country_folder = os.path.join(dist_dir, "city", city.country)
        os.makedirs(country_folder, exist_ok=True)
        pattern = rf"\b{city.city}\b"
        city_reviews = (
            points[points.comment.str.contains(pattern, case=False, regex=True).astype(bool)].dropna(subset="comment").iloc[:20]
        )
        rendered_cities.append(len(city_reviews) >= 3)
        if rendered_cities[-1]:
            rendered = city_template.render(city=city, title=city.city, reviews=city_reviews)
            with open(os.path.join(country_folder, f"{city.city}.html"), "w") as f:
                f.write(rendered)

    print(rendered_cities)

    index_rendered = city_index.render(grouped_cities=cities[rendered_cities].groupby("country"))
    with open(os.path.join(os.path.join(dist_dir, "city"), "index.html"), "w") as f:
        f.write(index_rendered)
elif COUNTRIES:
    points.sort_values("datetime", inplace=True, ascending=False)
    countries = pd.read_csv(os.path.join(db_dir, "countries.csv")).drop_duplicates().sort_values("country")
    rendered_countries = []
    country_folder = os.path.join(dist_dir, "country")
    os.makedirs(country_folder, exist_ok=True)

    for country in countries.itertuples():
        pattern = rf"\b{country.name}\b"
        mention_reviews = (
            points[points.comment.str.contains(pattern, case=False, regex=True).astype(bool)].dropna(subset="comment").iloc[:20]
        )
        country_reviews = points[points.country == country.country].dropna(subset="comment").iloc[:20]
        rendered_countries.append(len(mention_reviews) >= 3)
        if rendered_countries[-1]:
            rendered = country_template.render(
                country=country, title=country.country, mention_reviews=mention_reviews, country_reviews=country_reviews
            )
            with open(os.path.join(country_folder, f"{country.name}.html"), "w") as f:
                f.write(rendered)
    print(rendered_countries)
    index_rendered = country_index.render(countries=countries[rendered_countries])
    with open(os.path.join(country_folder, "index.html"), "w") as f:
        f.write(index_rendered)


# z-index is rating + 2 * number of reviews + 2 * number of reviews with destination
places["z-index"] = places["rating"] + 2 * places["review_count"] + 2 * places["dest_lats"].str.len().fillna(0)

places.reset_index(inplace=True)
# make sure high-rated are on top
places.sort_values("z-index", inplace=True, ascending=True)

marker_data = places[["lat", "lon", "rating", "text", "wait", "ride_distance", "review_indices"]].to_json(orient="values")

try:
    subprocess.run(["npm", "run", "build"], check=True, text=True)
except subprocess.CalledProcessError as e:
    print("DID NOT BUILD JS")

js_output_file = os.path.join(dist_dir_root, "out.js")

# We embed everything directly into the HTML page so our service worker can't serve inconsistent files
# For example, if we add a new attribute to the spot which is shown in the front-end, but the user only gets the new
# presentation layer, not the new data, the application would break
# Because the HTML file contains everything, this is not a problem

with open(js_output_file, encoding="utf-8") as f:
    hitch_script = f.read()

with open(os.path.join(root_dir, "static", "style.css"), encoding="utf-8") as f:
    hitch_style = f.read()

output = template.render(
    {
        "hitch_script": hitch_script,
        "hitch_style": hitch_style,
        "markers": marker_data,
        "review_data": review_data_json,
        "review_columns": review_columns,
        "generation_date": generation_date,
    }
)

with open(outname, "w", encoding="utf-8") as f:
    f.write(output)

if not LIGHT:
    recent = points.dropna(subset=["datetime"]).sort_values("datetime", ascending=False).iloc[:1000]
    recent["url"] = "https://hitchmap.com/#" + recent.lat.astype(str) + "," + recent.lon.astype(str)
    recent["text"] = points.comment.fillna("") + " " + points.extra_text.fillna("")
    recent["hitchhiker"] = recent.hitchhiker.str.replace("://", "", regex=False)
    recent["distance"] = recent["ride_distance"].round(1)
    recent["datetime"] = recent["datetime"].astype(str)
    recent["datetime"] += np.where(~recent.ride_datetime.isnull(), " 🕒", "")

    recent[["url", "country", "datetime", "hitchhiker", "rating", "distance", "text"]].to_html(
        outname_recent, render_links=True, index=False
    )

    duplicates["from_url"] = "https://hitchmap.com/#" + duplicates.from_lat.astype(str) + "," + duplicates.from_lon.astype(str)
    duplicates["to_url"] = "https://hitchmap.com/#" + duplicates.to_lat.astype(str) + "," + duplicates.to_lon.astype(str)
    duplicates[["id", "from_url", "to_url", "distance", "reviewed", "accepted"]].to_html(
        outname_dups, render_links=True, index=False
    )
