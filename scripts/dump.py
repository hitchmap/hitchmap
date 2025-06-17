import os
import sqlite3
import zipfile
from io import BytesIO
import pandas as pd
import random, string

root_dir = os.path.join(os.path.dirname(__file__), "..")
db_dir = os.path.abspath(os.path.join(root_dir, "db"))
dist_dir = os.path.abspath(os.path.join(root_dir, "dist"))

os.makedirs(dist_dir, exist_ok=True)

DATABASE = os.path.join(db_dir, "prod-points.sqlite")
DATABASE_DUMP = os.path.join(dist_dir, "dump.sqlite")

if not os.path.exists(DATABASE):
    print(f"DB not found: {DATABASE}")
    exit()

all_points = pd.read_sql("select * from points where not banned", sqlite3.connect(DATABASE))
all_points["ip"] = ""
all_points.to_sql("points", sqlite3.connect(DATABASE_DUMP), index=False, if_exists="replace")


duplicates = pd.read_sql("select * from duplicates where reviewed = accepted", sqlite3.connect(DATABASE))
duplicates["ip"] = ""
duplicates.to_sql("duplicates", sqlite3.connect(DATABASE_DUMP), index=False, if_exists="replace")
service_areas = pd.read_sql("select * from service_areas", sqlite3.connect(DATABASE))
service_areas.to_sql("service_areas", sqlite3.connect(DATABASE_DUMP), index=False, if_exists="replace")

road_islands = pd.read_sql("select * from road_islands", sqlite3.connect(DATABASE))
road_islands.to_sql("road_islands", sqlite3.connect(DATABASE_DUMP), index=False, if_exists="replace")

conn = sqlite3.connect(DATABASE)
cursor = conn.cursor()

user_ids = pd.read_sql("select id from user", conn)
cursor.execute("PRAGMA table_info(user)")
schema = cursor.fetchall()

# Create users DataFrame with random data
users_data = {"id": user_ids["id"].tolist()}


def generate_random_string(length=10):
    return "".join(random.choices(string.ascii_letters + string.digits, k=length))


for column_info in schema:
    print(column_info)
    column_name = column_info[1]  # Column name
    column_type = column_info[2].upper()  # Column type

    print(column_type)

    if column_name == "id":
        continue  # Skip ID as we already have it

    if column_type in ["INTEGER", "INT"]:
        users_data[column_name] = [random.randint(0, 1000) for _ in range(len(user_ids))]
    elif column_type in ["REAL", "FLOAT", "DOUBLE"]:
        users_data[column_name] = [round(random.uniform(0, 100), 2) for _ in range(len(user_ids))]
    elif column_type in ["BOOLEAN", "BOOL"]:
        users_data[column_name] = [random.choice([0, 1]) for _ in range(len(user_ids))]
    else:  # Default to TEXT/VARCHAR
        users_data[column_name] = [generate_random_string() for _ in range(len(user_ids))]

users_df = pd.DataFrame(users_data)
users_df.to_sql("user", sqlite3.connect(DATABASE_DUMP), index=False, if_exists="replace")

roles_users = pd.read_sql("select * from roles_users", sqlite3.connect(DATABASE))
roles_users.to_sql("roles_users", sqlite3.connect(DATABASE_DUMP), index=False, if_exists="replace")

# Dictionary of DataFrames with filenames
dfs = {
    "road_islands.csv": road_islands,
    "service_areas.csv": service_areas,
    "points.csv": all_points,
    "duplicates.csv": duplicates,
}

# Writing to a ZIP file
zip_filename = os.path.join(dist_dir, "csv-dump.zip")
with zipfile.ZipFile(zip_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
    for file_name, df in dfs.items():
        with BytesIO() as buff:
            df.to_csv(buff, index=False)
            zipf.writestr(file_name, buff.getvalue())
