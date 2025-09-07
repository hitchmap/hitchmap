python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
curl https://hitchmap.com/dump.sqlite > db/points.sqlite
npm install
npm run build