@reboot cd hitch && screen -d -m bash -c '. $HOME/.bashrc; /home/bob/.asdf/shims/waitress-serve server:app; bash'
# every minute
* * * * * cd hitch && /usr/bin/flock -n /tmp/show.lockfile bash -c '. $HOME/.bashrc; /home/bob/.asdf/shims/python scripts/show.py' > cronlog.txt 2>&1
# every 10 minutes
*/10 * * * * cd hitch && /usr/bin/flock -n /tmp/show.lockfile bash -c '. $HOME/.bashrc; /home/bob/.asdf/shims/python scripts/show.py light' > cronlog-light.txt 2>&1
# each day at 4
0 4 * * * cd hitch && bash -c '. $HOME/.bashrc; /home/bob/.asdf/shims/python scripts/show.py city; /home/bob/.asdf/shims/python scripts/show.py country; /home/bob/.asdf/shims/python scripts/show.py service;' > guidelog.txt 2>&1
# each day at 7
0 7 * * * cd hitch && bash -c '. $HOME/.bashrc; /home/bob/.asdf/shims/python scripts/translate-comments.py' > translatecommentlog.txt 2>&1
# each day at 6
0 6 * * * cd hitch && bash -c '. $HOME/.bashrc; /home/bob/.asdf/shims/python scripts/dump.py' > dumplog.txt 2>&1
# each day at 3
0 3 * * * cd hitch && bash -c '. $HOME/.bashrc; /home/bob/.asdf/shims/python scripts/fetch-roads.py' > fetchroadlog.txt 2>&1
# each day at midnight
0 0 * * * cd hitch && bash -c '. $HOME/.bashrc; /home/bob/.asdf/shims/python scripts/fetch-areas.py' > fetcharealog.txt 2>&1
# every hour
0 * * * * cd hitch && bash -c '. $HOME/.bashrc; /home/bob/.asdf/shims/python scripts/dashboard.py' > dashboard.txt 2>&1
