import requests_cache
import requests
import pandas as pd
from shapely.geometry import Polygon
import shapely
import os
import time
from helpers import get_db, scripts_dir
from sklearn.cluster import DBSCAN

cache_file = os.path.join(scripts_dir, "overpass_api_cache")
requests_cache.install_cache(cache_file, backend="sqlite", expire_after=6 * 365 * 24 * 60 * 60)

points = pd.read_sql("select * from points where not banned and revised_by is null", get_db())

# Load coordinates (Assuming 'points' DataFrame exists with "lon" and "lat")
coords = points[["lon", "lat"]].drop_duplicates().reset_index(drop=True)

# Candidate clustering with DBSCAN
# This clustering is purely spatial, not OSM aware at all
AREA_MERGE_DISTANCE = 800
AREA_MERGE_DISTANCE_DEG = AREA_MERGE_DISTANCE / 111_000  # 111km per degree
min_samples = 2  # Minimum points to form a cluster
dbscan = DBSCAN(eps=AREA_MERGE_DISTANCE_DEG, min_samples=min_samples, metric="euclidean").fit(coords)

coords["cluster"] = dbscan.labels_

print(sum(coords["cluster"] != -1), len(coords))

# Filter out the loners
clusters = coords[coords["cluster"] != -1]


def get_service_area(lat, lon):
    overpass_url = "http://overpass-api.de/api/interpreter"
    overpass_query = f"""
    [out:json];
    is_in({lat}, {lon})->.a;
    (
        area.a["amenity"="fuel"];
        area.a["highway"="service_area"];
        area.a["highway"="rest_area"];
        area.a["highway"="parking"];
        area.a["highway"="services"];
    );
    wr(pivot);
    out geom;
    """
    # Query Overpass API
    data = None
    while data is None:
        try:
            response = requests.get(overpass_url, params={"data": overpass_query})
            if not response.from_cache:
                print("getting service area", lat, lon)
                time.sleep(1)
            data = response.json()
        except Exception as e:
            print(e)
            pass
    max_size = -1
    largest_geom_name = largest_geom = largest_geom_id = None

    if "elements" not in data:
        return None

    # Convert results into polygons and check size
    for element in data["elements"]:
        if "geometry" in element:
            coords = [(node["lon"], node["lat"]) for node in element["geometry"]]

            if len(coords) < 3:
                continue

            polygon = Polygon(coords)
            size = polygon.area
        elif "members" in element:
            size = 0
            for member in element["members"]:
                coords = [(node["lon"], node["lat"]) for node in member["geometry"]]
                if len(coords) < 3:
                    continue
                polygon = Polygon(coords)
                size += polygon.area
        else:
            continue

        if size > max_size:  # Check if this is the largest containing parking/station
            max_size = size
            largest_geom_id = element["id"]
            largest_geom = polygon
            tags = element.get("tags", {})
            largest_geom_name = (
                tags["official_name"] + " - " + tags["branch"]
                if "official_name" in tags and "branch" in tags
                else tags.get("name")
            )

    if largest_geom:
        print("SERVICE", largest_geom_id)
    return largest_geom_id, largest_geom, largest_geom_name


areas = []
for lon, lat, _cluster in clusters.values:
    geom_id, geom, name = get_service_area(lat, lon)
    if geom is not None:
        areas.append((geom_id, shapely.convex_hull(geom).wkt, name))

areas_df = pd.DataFrame(areas, columns=["geom_id", "geometry_wkt", "name"]).drop_duplicates("geometry_wkt")
areas_df.to_sql("service_areas", get_db(), if_exists="replace", index=False)
