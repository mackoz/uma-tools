#!/bin/bash
# Read-only tri-repo status: one line per repo (code, engine, plans) covering branch,
# ahead/behind its upstream, dirty file count, extra worktree count, and -- for the code
# repo only -- the submodule gitlink vs the engine's origin/master (PIPE-67, replaces the
# "status + branch (+ worktree list) per repo" sequence CLAUDE.md's ticket found ~120x in
# recent transcripts). Then one line per repo listing open PRs for the *current* branch.
#
#   scripts/repo-status.sh [--fetch] [--dry-run]
#
#   --fetch      run `git fetch -q` in each repo first (network; off by default)
#   --dry-run    read-only anyway -- accepted for a consistent CLI, has no extra effect
#   --help       print this usage and exit 0
set -euo pipefail

usage() {
	cat <<'EOF'
usage: scripts/repo-status.sh [--fetch] [--dry-run]

Read-only. Prints one line per repo (code, engine, plans): slot, branch (or
HEAD@<sha> when detached -- normal for the engine submodule), ahead/behind its
upstream, dirty file count, and worktree count beyond the main one. The code
repo also gets a gitlink line comparing the recorded uma-skill-tools sha
against the engine's origin/master tip.

Then one line per repo listing open PRs for the *current* branch (needs `gh`
authenticated; skipped gracefully with a note if `gh` is missing or not
logged in).

  --fetch      run `git fetch -q` in each repo first (network; off by default)
  --dry-run    accepted for a consistent CLI; this script is read-only anyway
  --help       print this usage and exit 0
EOF
}

fetch=0
for arg in "$@"; do
	case "$arg" in
		--help) usage; exit 0 ;;
		--fetch) fetch=1 ;;
		--dry-run) : ;;
		*) echo "repo-status.sh: unknown argument: $arg" >&2; exit 1 ;;
	esac
done

# Clear positional params first -- `source` inherits this script's
# leftover "$@" otherwise, which would feed repo-env.sh's own arg parser
# whatever flags this script was called with (e.g. --fetch, --dry-run).
set --
source "$(dirname "${BASH_SOURCE[0]}")/repo-env.sh"

have_gh=1
if ! command -v gh >/dev/null 2>&1; then
	have_gh=0
elif ! gh auth status >/dev/null 2>&1; then
	have_gh=0
fi

# repo_dir default_branch slot
repos=(
	"$UMA_CODE_REPO master code"
	"$UMA_ENGINE_REPO master engine"
	"$UMA_PLANS_REPO main plans"
)

status_line() {
	local dir="$1" default_branch="$2" slot="$3"

	if [ ! -d "$dir" ] || ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		echo "$slot: not present ($dir)"
		return
	fi

	if [ "$fetch" -eq 1 ]; then
		git -C "$dir" fetch -q || true
	fi

	local branch
	branch="$(git -C "$dir" symbolic-ref --short -q HEAD || true)"
	if [ -z "$branch" ]; then
		branch="HEAD@$(git -C "$dir" rev-parse --short HEAD)"
	fi

	local ahead=0 behind=0
	local upstream
	upstream="$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
	if [ -n "$upstream" ]; then
		local counts
		counts="$(git -C "$dir" rev-list --left-right --count "HEAD...$upstream" 2>/dev/null || echo "0 0")"
		ahead="$(echo "$counts" | awk '{print $1}')"
		behind="$(echo "$counts" | awk '{print $2}')"
	fi

	local dirty
	dirty="$(git -C "$dir" status --porcelain | wc -l | tr -d ' ')"

	local worktrees
	worktrees="$(git -C "$dir" worktree list --porcelain | grep -c '^worktree ' || true)"
	local extra_worktrees=$((worktrees > 0 ? worktrees - 1 : 0))

	local gitlink_note=""
	if [ "$slot" = "code" ]; then
		local recorded_sha engine_sha
		recorded_sha="$(git -C "$dir" ls-tree HEAD uma-skill-tools 2>/dev/null | awk '{print $3}')"
		engine_sha="$(git -C "$UMA_ENGINE_REPO" rev-parse origin/master 2>/dev/null || true)"
		if [ -z "$recorded_sha" ] || [ -z "$engine_sha" ]; then
			gitlink_note=" gitlink UNKNOWN (could not resolve one side)"
		elif [ "$recorded_sha" = "$engine_sha" ]; then
			gitlink_note=" gitlink OK"
		else
			gitlink_note=" gitlink MISMATCH (expected mid-review if an engine PR is open)"
		fi
	fi

	echo "$slot: branch=$branch ahead=$ahead behind=$behind dirty=$dirty worktrees+$extra_worktrees$gitlink_note"
}

pr_line() {
	local dir="$1" slot="$2"

	if [ ! -d "$dir" ] || ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		return
	fi
	if [ "$have_gh" -eq 0 ]; then
		echo "$slot: PRs: gh not available or not authenticated, skipped"
		return
	fi

	local branch
	branch="$(git -C "$dir" symbolic-ref --short -q HEAD || true)"
	if [ -z "$branch" ]; then
		echo "$slot: PRs: detached HEAD, no branch to look up"
		return
	fi

	local json
	json="$(gh pr list --repo "$(gh_repo_slug "$dir")" --head "$branch" --json number,title,isDraft 2>/dev/null || true)"
	if [ -z "$json" ] || [ "$json" = "[]" ]; then
		echo "$slot: PRs: none open for $branch"
		return
	fi
	echo "$slot: PRs for $branch:"
	echo "$json" | node -e '
		const rows = JSON.parse(require("fs").readFileSync(0, "utf8"));
		for (const r of rows) {
			console.log(`  #${r.number}${r.isDraft ? " (draft)" : ""}: ${r.title}`);
		}
	'
}

gh_repo_slug() {
	local dir="$1"
	git -C "$dir" remote get-url origin 2>/dev/null \
		| sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##'
}

for entry in "${repos[@]}"; do
	# shellcheck disable=SC2086
	set -- $entry
	status_line "$1" "$2" "$3"
done

for entry in "${repos[@]}"; do
	# shellcheck disable=SC2086
	set -- $entry
	pr_line "$1" "$3"
done
