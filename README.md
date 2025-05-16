# Hitchmap

The map to hitchhiking the world. Read more [here](https://hitchwiki.org/en/Hitchwiki:Maps).


## Description

Hitchmap is a [static site generator](https://en.wikipedia.org/wiki/Static_site_generator) that runs every few minutes.

- `server.py` runs the server
- `scripts/show.py` builds the main HTML page (`index.html`). This is where the magic happens.
- `scripts/dump.py` runs the monthly dump
- `cron.sh` is the crontab running above files
- `hitchmap.conf` is the NGINX configuration
- `js/map.js` is the entry point of the homepage's JavaScript
- `js/pending.js` is responsible for adding temporary markers

A few developers have taken it upon themselves to rewrite Hitchmap to a more traditional MVC structure.

For contributors and users, we recommend reviewing both repositories to determine which best fits your needs. In virtually all cases, user-facing contributions will eventually end up in both repositories.

## License

The software provided in this repository is licensed under AGPL 3.0. The Hitchmap database is licensed under the ODBL, the license used by OpenStreetMap.

## Installation (on Linux)

Install Python and Node.js, then:

```bash
python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
curl https://hitchmap.com/dump.sqlite > db/points.sqlite
npm install
npm run build
```

## Getting started
### Running

```
python3 scripts/show.py
python3 server.py
```

### Linting

We use Ruff for linting [https://docs.astral.sh/ruff/](https://docs.astral.sh/ruff/).

The settings can be found in `ruff.toml`.

To configure automatic linting for VS Code check out the extension [https://github.com/astral-sh/ruff-vscode](https://github.com/astral-sh/ruff-vscode).

## Contributing
Join the conversation about a map for hitchhiking in our [Signal Chat](https://signal.group/#CjQKIDyYgIxcOUCEPYu8-JawC_tv1bcgkAhvbISRZkN45MMVEhCtydy3DOOCKEAE_tsR6g9s).

File an [issue](https://github.com/bopjesvla/hitch/issues) if you have a feature request or found a bug.

Perform a [pull request](https://github.com/bopjesvla/hitch/pulls) from your [fork](https://github.com/bopjesvla/hitch/fork) of the repository if you solved an issue. (It's best to file an issue first so we can discuss it and reference it in the PR.)

## Data
If you find the data collected and provided by hitchmap.com helpful, feel free to cite it using:
```
@misc{hitchhiking,
author = {Bob de Ruiter, Till Wenke},
title = {Dataset of Hitchhiking Trips},
year = {2024},
url = {https://hitchmap.com},
}
```

