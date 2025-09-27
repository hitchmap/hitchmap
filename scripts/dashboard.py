import html
import os
import sqlite3
from string import Template
from datetime import datetime, timedelta

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

# see
# https://realpython.com/python-dash/
# https://stackoverflow.com/a/47715493


root_dir = os.path.join(os.path.dirname(__file__), "..")

db_dir = os.path.abspath(os.path.join(root_dir, "db"))
dist_dir = os.path.abspath(os.path.join(root_dir, "dist"))
template_dir = os.path.abspath(os.path.join(root_dir, "templates"))

os.makedirs(dist_dir, exist_ok=True)

template_path = os.path.join(template_dir, "dashboard_template.html")
with open(template_path, encoding="utf-8") as f:
    template = f.read()

outname = os.path.join(dist_dir, "dashboard.html")

# TODO: Use dotenv?
if os.path.exists(os.path.join(db_dir, "prod-points.sqlite")):
    DATABASE = os.path.join(db_dir, "prod-points.sqlite")
else:
    DATABASE = os.path.join(db_dir, "points.sqlite")

# Spots
df = pd.read_sql(
    "select * from points where not banned and revised_by is null and datetime is not null",
    sqlite3.connect(DATABASE),
)

df["datetime"] = df["datetime"].astype("datetime64[ns]")

# Calculate expected entries for current month
now = pd.Timestamp.now()
current_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
current_month_entries = df[df["datetime"] >= current_month_start]
days_in_current_month = (now.replace(month=now.month % 12 + 1, day=1) - current_month_start).days
days_passed = (now - current_month_start).days + 1
expected_monthly_entries = len(current_month_entries) * days_in_current_month / days_passed

# Create histogram with 1-month bins
fig = px.histogram(df["datetime"], title="Entries per month", nbins=None)

# Set the histogram to use monthly bins
fig.update_traces(
    xbins=dict(
        size="M1"  # 1 month bins
    ),
    hovertemplate="<b>%{x|%b %Y}</b><br>Entries: %{y}<extra></extra>",
)

# Add expected value annotation for current month
fig.add_annotation(
    x=current_month_start + pd.Timedelta(days=15),  # Middle of current month
    y=expected_monthly_entries,
    text=f"Expected: {expected_monthly_entries:.0f}",
    showarrow=True,
    arrowhead=2,
    arrowsize=1,
    arrowwidth=2,
    arrowcolor="red",
    font=dict(color="red", size=12),
    bgcolor="rgba(255,255,255,0.8)",
    bordercolor="red",
    borderwidth=1,
)

# Add a trace for expected value
fig.add_trace(
    go.Scatter(
        x=[current_month_start + pd.Timedelta(days=15)],
        y=[expected_monthly_entries],
        mode="markers",
        marker=dict(color="red", size=8, symbol="diamond"),
        name=f"Expected this month ({expected_monthly_entries:.0f})",
        showlegend=True,
    )
)

fig.update_xaxes(
    range=[
        "2006-01-01",
        pd.Timestamp.today().strftime("%Y-%m-%d"),
    ],
    rangeselector=dict(
        buttons=list(
            [
                dict(count=1, label="1y", step="year", stepmode="backward"),
                dict(count=2, label="2y", step="year", stepmode="backward"),
                dict(count=5, label="5y", step="year", stepmode="backward"),
                dict(count=10, label="10y", step="year", stepmode="backward"),
                dict(step="all"),
            ]
        )
    ),
)

fig.update_layout(xaxis_title=None)
fig.update_layout(yaxis_title="# of entries")

timeline_plot = fig.to_html("dash.html", full_html=False)


# TODO: necessary to track user progress, move elsewhere later
### Show accounts ###
def e(s):
    return html.escape(s.replace("\n", "<br>"))


points = pd.read_sql(
    sql="select * from points where not banned and revised_by is null order by datetime is not null desc, datetime desc",
    con=sqlite3.connect(DATABASE),
)
points["user_id"] = points["user_id"].astype(pd.Int64Dtype())
users = pd.read_sql("select * from user", sqlite3.connect(DATABASE))
points["username"] = pd.merge(
    left=points[["user_id"]], right=users[["id", "username"]], left_on="user_id", right_on="id", how="left"
)["username"]
points["hitchhiker"] = points["nickname"].fillna(points["username"])
points["hitchhiker"] = points["hitchhiker"].str.lower()


def get_num_reviews(username):
    return len(points[points["hitchhiker"] == username.lower()])


user_accounts = ""
count_inactive_users = 0
for _, user in users.iterrows():
    if get_num_reviews(user.username) >= 1:
        user_accounts += (
            f'<a href="/account/{e(user.username)}">{e(user.username)}</a> - '
            + f'<a href="/?user={e(user.username)}#filters">Their spots</a>'
        )
        user_accounts += "<br>"
    else:
        count_inactive_users += 1
user_accounts += f"<br>There are {count_inactive_users} inactive users"


### Put together ###
output = Template(template).substitute(
    {
        "timeline": timeline_plot,
        "user_accounts": user_accounts,
    }
)

with open(outname, "w", encoding="utf-8") as f:
    f.write(output)
