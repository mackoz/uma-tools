#!/bin/bash
# Pidfile-scoped dev server for a --serve-capable app, replacing the hand-driven
# `node build.mjs --serve & / curl / pkill -f` sequence CLAUDE.md's ticket found ~40x in
# recent transcripts -- notably, `pkill -f` has killed another session's server before
# (see CLAUDE.md's worktree section). This script only ever signals a process it started
# and recorded the pid of.
#
#   scripts/dev-serve.sh start  [--app umalator-global|skill-visualizer-global] [--port N] [--dry-run]
#   scripts/dev-serve.sh stop   [--app umalator-global|skill-visualizer-global] [--port N] [--dry-run]
#   scripts/dev-serve.sh status [--app umalator-global|skill-visualizer-global] [--port N] [--dry-run]
#
# Default app: umalator-global. Default port: 8000. Note: `umalator/build.mjs` has no
# `--serve` mode (see CLAUDE.md's "Build / verify commands") -- `umalator` is not a valid
# --app value here.
#
# Pidfile: ${TMPDIR:-/tmp}/uma-dev-serve-<app>-<port>.pid, log alongside it (same name,
# .log). `start` is idempotent: if the port already answers, it prints the URL and exits 0
# without starting a second server. `stop` only signals the pid in its own pidfile, and
# only after confirming that pid's command line still looks like the server it started --
# never a bare `pkill -f`.
set -euo pipefail

usage() {
	cat <<'EOF'
usage: scripts/dev-serve.sh start|stop|status [--app APP] [--port N] [--dry-run]

Manages a pidfile-scoped dev server for one of this repo's --serve-capable apps.

  --app APP    umalator-global (default) or skill-visualizer-global.
               Note: umalator/build.mjs has no --serve mode (see CLAUDE.md) --
               "umalator" is not a valid --app value here.
  --port N     port to serve on (default 8000)
  --dry-run    print what would run/be signalled, without doing it
  --help       print this usage and exit 0

Subcommands:
  start   start the server in the background if the port isn't already
          answering (idempotent -- never starts a second server on the same
          port); polls up to ~20s for it to come up
  stop    stop the server this script started, if its pidfile's pid is still
          alive and still looks like a build.mjs --serve process; otherwise
          reports "not started by this script" and does nothing
  status  report whether the pidfile's pid is alive and whether the port
          answers
EOF
}

app=umalator-global
port=8000
dry_run=0
cmd=""

while [ $# -gt 0 ]; do
	case "$1" in
		--help) usage; exit 0 ;;
		start|stop|status) cmd="$1"; shift ;;
		--app) app="$2"; shift 2 ;;
		--app=*) app="${1#*=}"; shift ;;
		--port) port="$2"; shift 2 ;;
		--port=*) port="${1#*=}"; shift ;;
		--dry-run) dry_run=1; shift ;;
		*) echo "dev-serve.sh: unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [ -z "$cmd" ]; then
	usage >&2
	exit 1
fi

case "$app" in
	umalator-global|skill-visualizer-global) : ;;
	umalator)
		echo "dev-serve.sh: umalator/build.mjs has no --serve mode (see CLAUDE.md) -- not a valid --app" >&2
		exit 1
		;;
	*)
		echo "dev-serve.sh: unknown --app: $app (expected umalator-global or skill-visualizer-global)" >&2
		exit 1
		;;
esac

source "$(dirname "${BASH_SOURCE[0]}")/repo-env.sh"

pidfile="${TMPDIR:-/tmp}/uma-dev-serve-${app}-${port}.pid"
logfile="${TMPDIR:-/tmp}/uma-dev-serve-${app}-${port}.log"
url="http://localhost:${port}/uma-tools/${app}/"

port_http_code() {
	# curl already prints %{http_code} as "000" on a connection failure (nonzero
	# exit) -- suppress the exit code with `|| true` rather than appending a
	# second "000" via `|| echo`, which would double up the output.
	curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true
}

port_answering() {
	local code
	code="$(port_http_code)"
	[ -n "$code" ] && [ "$code" != "000" ]
}

pidfile_pid_alive_and_ours() {
	[ -f "$pidfile" ] || return 1
	local pid
	pid="$(cat "$pidfile" 2>/dev/null || true)"
	[ -n "$pid" ] || return 1
	kill -0 "$pid" 2>/dev/null || return 1
	local cmdline
	cmdline="$(ps -o command= -p "$pid" 2>/dev/null || true)"
	case "$cmdline" in
		*build.mjs*--serve*) echo "$pid"; return 0 ;;
		*) return 1 ;;
	esac
}

case "$cmd" in
	start)
		if port_answering; then
			echo "already serving: $url"
			exit 0
		fi
		if [ "$dry_run" -eq 1 ]; then
			echo "[dry-run] cd $UMA_CODE_REPO/$app && nohup node build.mjs --serve $port > $logfile 2>&1 &"
			echo "[dry-run] echo <pid> > $pidfile"
			exit 0
		fi
		# The backgrounded subshell `exec`s into node so its pid stays node's pid
		# (an `&&`-chained `cd && nohup node ...` run as one backgrounded list
		# instead would make `$!` the subshell's own pid, not node's -- and a
		# pidfile pointing at the subshell fails the `ps -o command=` check
		# `stop`/`status` rely on to confirm the pid is still theirs).
		( cd "$UMA_CODE_REPO/$app" && exec nohup node build.mjs --serve "$port" >"$logfile" 2>&1 ) &
		pid=$!
		echo "$pid" >"$pidfile"
		waited=0
		while [ "$waited" -lt 20 ]; do
			if port_answering; then
				echo "serving: $url (pid $pid)"
				exit 0
			fi
			sleep 1
			waited=$((waited + 1))
		done
		echo "dev-serve.sh: $url never answered after 20s -- last log lines:" >&2
		tail -n 20 "$logfile" >&2 2>/dev/null || true
		exit 1
		;;
	stop)
		if [ "$dry_run" -eq 1 ]; then
			if pid="$(pidfile_pid_alive_and_ours)"; then
				echo "[dry-run] kill $pid  # $pidfile"
			else
				echo "[dry-run] not started by this script (no pidfile / pid not ours) -- nothing to signal"
			fi
			exit 0
		fi
		if pid="$(pidfile_pid_alive_and_ours)"; then
			kill "$pid"
			waited=0
			while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 10 ]; do
				sleep 1
				waited=$((waited + 1))
			done
			rm -f "$pidfile"
			echo "stopped: pid $pid"
			exit 0
		fi
		echo "not started by this script (no pidfile / pid not ours)"
		exit 0
		;;
	status)
		alive="no"
		pid=""
		if pid="$(pidfile_pid_alive_and_ours)"; then
			alive="yes"
		fi
		code="$(port_http_code)"
		answering="no"
		if [ -n "$code" ] && [ "$code" != "000" ]; then
			answering="yes"
		fi
		echo "app=$app port=$port pid_alive=$alive pid=${pid:-none} port_answering=$answering http_code=$code url=$url"
		exit 0
		;;
esac
