import pandas as pd
import requests_cache
import requests
from shapely.geometry import MultiLineString, LineString, Point
import shapely
from sklearn.cluster import DBSCAN
import os
import time

from helpers import get_db, scripts_dir

cache_file = os.path.join(scripts_dir, "overpass_api_cache")
requests_cache.install_cache(cache_file, backend="sqlite", expire_after=6 * 365 * 24 * 60 * 60)

points = pd.read_sql("select * from points where not banned", get_db())

# Load coordinates (Assuming 'points' DataFrame exists with "lon" and "lat")
coords = points[["lon", "lat"]].drop_duplicates().reset_index(drop=True)

# Candidate clustering with DBSCAN
# This clustering is purely spatial, not OSM aware at all
ROAD_MERGE_DISTANCE = 100
ROAD_MERGE_DISTANCE_DEG = ROAD_MERGE_DISTANCE / 111_000  # 111km per degree
min_samples = 2  # Minimum points to form a cluster
dbscan = DBSCAN(eps=ROAD_MERGE_DISTANCE_DEG, min_samples=min_samples, metric="euclidean").fit(coords)

# Assign cluster labels
coords["cluster"] = dbscan.labels_

# Filter out the loners
clusters = coords[coords["cluster"] != -1]


# Overpass Query Function
def fetch_osm_data(lat, lon, search_size):
    query = f"""
    [out:json];
    way(around:{search_size},{lat},{lon})["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|service"];
    (._;>;);
    out body geom;
    """
    url = "http://overpass-api.de/api/interpreter"

    while True:
        try:
            response = requests.get(url, params={"data": query})
            if not response.from_cache:
                time.sleep(1)
            print(f"fetching for {lat}, {lon}")
            return response.json()
        except Exception as e:
            print(e)


# Process clusters
road_networks = []
road_islands = []
road_island_id = 0

grouped = clusters.groupby("cluster")
print(len(grouped))
for _cluster_id, group in grouped:
    lat, lon = group["lat"].mean(), group["lon"].mean()
    search_size_deg = 1.2 * (group["lat"].max() - group["lat"].min() + group["lon"].max() - group["lon"].min())
    search_size = search_size_deg * 111_000

    osm_data = fetch_osm_data(lat, lon, search_size)

    if osm_data and "elements" in osm_data:
        lines = []
        for element in osm_data["elements"]:
            if "geometry" in element:
                line_coords = [(pt["lon"], pt["lat"]) for pt in element["geometry"]]
                lines.append(LineString(line_coords))

        multilinestring = MultiLineString(lines)
        geom_wkt = multilinestring.wkt
        road_networks.append((lat, lon, search_size_deg, geom_wkt))

        # create perimeter of at least 1 meter
        perimeter = Point(lon, lat).buffer(max(search_size_deg / 1.1, 1 / 111_000), quad_segs=4)

        roads_in_perimeter = multilinestring.intersection(perimeter)

        road_network_with_boundary = shapely.unary_union([perimeter.boundary, roads_in_perimeter], grid_size=0.000001)
        # Each "hole" in the road network is its own road_island
        road_island_collection = shapely.polygonize([road_network_with_boundary])

        for road_island in road_island_collection.geoms:
            road_islands.append((road_island_id, road_island.wkt))
            road_island_id += 1


# Convert to DataFrame
road_networks_df = pd.DataFrame(road_networks, columns=["lat", "lon", "search_size_deg", "geometry_wkt"])
road_islands_df = pd.DataFrame(road_islands, columns=["id", "geometry_wkt"]).drop_duplicates("geometry_wkt")

# Store in SQLite Database
road_networks_df.to_sql("road_networks", get_db(), if_exists="replace", index=False)
road_islands_df.to_sql("road_islands", get_db(), if_exists="replace", index=False)
