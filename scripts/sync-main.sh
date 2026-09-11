#!/bin/bash
# Post-landing default-branch sync, replacing the `git checkout main && git pull --ff-only
# && git branch -d ...` sequence CLAUDE.md's ticket found ~30x in recent transcripts (the
# single-repo /project-land paths do this by hand today).
#
#   scripts/sync-main.sh [--repo <code|engine|plans>]... [--dry-run]
#
# Default (no --repo given): all three repos, in the order engine, code, plans. Per repo:
# refuses (skips that repo with a reason, continues with the others, exits non-zero at the
# end) if the tree is dirty, or if the current non-default branch has commits its upstream
# lacks. Otherwise checks out the default branch, pulls --ff-only, deletes local branches
# that are [gone] upstream or fully merged into the default (never the default itself,
# never a branch backing a listed worktree), and for the code repo runs
# `git submodule update --init` afterwards.
#
# The engine slot's detached HEAD is normal (it's a submodule checkout) -- "detached at the
# commit the code repo's gitlink records" is treated as clean and left alone unless --repo
# engine was passed explicitly, in which case master is checked out and pulled like any
# other repo.
set -euo pipefail

usage() {
	cat <<'EOF'
usage: scripts/sync-main.sh [--repo <code|engine|plans>]... [--dry-run]

Syncs one or more repos back to their default branch after a landing: checks
out the default branch, pulls --ff-only, and deletes local branches that are
gone upstream or fully merged -- never the default branch itself, never a
branch backing a listed worktree.

  --repo SLOT   code, engine, or plans; may be repeated. Default: all three,
                in order engine, code, plans.
  --dry-run     print what each repo would do, without doing it
  --help        print this usage and exit 0

A dirty tree, or a non-default branch with unpushed commits, is a per-repo
refusal: that repo is skipped (with a reason) but the others still run, and
the script exits non-zero overall if any repo was skipped.

The engine slot's detached HEAD (normal for a submodule checkout) is treated
as already clean and left alone, unless --repo engine was passed explicitly --
then it's checked out to master and pulled like any other repo.
EOF
}

dry_run=0
repos_requested=()

while [ $# -gt 0 ]; do
	case "$1" in
		--help) usage; exit 0 ;;
		--repo) repos_requested+=("$2"); shift 2 ;;
		--repo=*) repos_requested+=("${1#*=}"); shift ;;
		--dry-run) dry_run=1; shift ;;
		*) echo "sync-main.sh: unknown argument: $1" >&2; exit 1 ;;
	esac
done

# Clear positional params first -- `source` inherits this script's
# leftover "$@" otherwise, which would feed repo-env.sh's own arg parser
# whatever flags this script was called with (e.g. --fetch, --dry-run).
set --
source "$(dirname "${BASH_SOURCE[0]}")/repo-env.sh"

explicit_mode=1
if [ "${#repos_requested[@]}" -eq 0 ]; then
	repos_requested=(engine code plans)
	explicit_mode=0
fi

any_skipped=0

repo_dir_for() {
	case "$1" in
		code) echo "$UMA_CODE_REPO" ;;
		engine) echo "$UMA_ENGINE_REPO" ;;
		plans) echo "$UMA_PLANS_REPO" ;;
		*) echo "sync-main.sh: unknown repo slot: $1" >&2; exit 1 ;;
	esac
}

default_branch_for() {
	case "$1" in
		code|engine) echo "master" ;;
		plans) echo "main" ;;
	esac
}

# Local branches to delete: [gone] upstream, or fully merged into the default
# branch -- excluding the default branch itself and any branch backing a
# worktree that's still checked out.
branches_to_delete() {
	local dir="$1" default_branch="$2"
	local worktree_branches
	worktree_branches="$(git -C "$dir" worktree list --porcelain | awk -F/ '/^branch refs\/heads\// {print $NF}')"

	local gone
	gone="$(git -C "$dir" for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads/ \
		| awk '/\[gone\]/ {print $1}')"
	local merged
	merged="$(git -C "$dir" branch --merged "$default_branch" --format='%(refname:short)')"

	# awk 'NF'/sort -u, not `grep -v '^$'`/`grep -vx <default>`: under this
	# script's `set -o pipefail`, a grep that matches nothing exits 1 and
	# fails the whole pipeline (and, via the command substitution this
	# function's caller assigns, the script) -- awk selecting non-empty lines
	# never does that, and the default-branch exclusion below is a plain bash
	# string comparison instead of a second grep.
	local candidates
	candidates="$(printf '%s\n%s\n' "$gone" "$merged" | awk 'NF' | sort -u)"

	local b
	while IFS= read -r b; do
		[ -z "$b" ] && continue
		[ "$b" = "$default_branch" ] && continue
		if printf '%s\n' "$worktree_branches" | grep -qx "$b"; then
			continue
		fi
		echo "$b"
	done <<<"$candidates"
	return 0
}

sync_one() {
	local slot="$1"
	local dir default_branch
	dir="$(repo_dir_for "$slot")"
	default_branch="$(default_branch_for "$slot")"

	if [ ! -d "$dir" ] || ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		echo "$slot: skipped -- not present ($dir)"
		any_skipped=1
		return
	fi

	local branch
	branch="$(git -C "$dir" symbolic-ref --short -q HEAD || true)"

	if [ -z "$branch" ]; then
		# Detached HEAD. Normal for the engine submodule; only act on it if
		# --repo engine was explicitly requested (explicit_mode=1 means the
		# user passed at least one --repo, so this run is specifically about
		# this repo, not the "sync everything" default).
		if [ "$slot" = "engine" ] && [ "$explicit_mode" -eq 0 ]; then
			echo "$slot: detached HEAD (normal for the submodule), skipping checkout/pull"
			return
		fi
		if [ "$slot" != "engine" ]; then
			echo "$slot: skipped -- detached HEAD, refusing to guess a branch"
			any_skipped=1
			return
		fi
		# --repo engine passed explicitly: fall through to the normal
		# checkout/pull path below.
	fi

	if [ -n "$(git -C "$dir" status --porcelain)" ]; then
		echo "$slot: skipped -- working tree is dirty"
		any_skipped=1
		return
	fi

	if [ -n "$branch" ] && [ "$branch" != "$default_branch" ]; then
		local upstream
		upstream="$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
		if [ -n "$upstream" ]; then
			local ahead
			ahead="$(git -C "$dir" rev-list --count "$upstream..HEAD" 2>/dev/null || echo 0)"
			if [ "$ahead" -gt 0 ]; then
				echo "$slot: skipped -- branch $branch has $ahead commit(s) not on $upstream"
				any_skipped=1
				return
			fi
		fi
	fi

	if [ "$dry_run" -eq 1 ]; then
		echo "[dry-run] $slot: git -C $dir checkout $default_branch"
		echo "[dry-run] $slot: git -C $dir pull --ff-only"
		local to_delete
		to_delete="$(branches_to_delete "$dir" "$default_branch")"
		if [ -n "$to_delete" ]; then
			while IFS= read -r b; do
				echo "[dry-run] $slot: git -C $dir branch -d $b"
			done <<<"$to_delete"
		fi
		if [ "$slot" = "code" ]; then
			echo "[dry-run] $slot: git -C $dir submodule update --init"
		fi
		return
	fi

	local did_something=0
	if [ -z "$branch" ] || [ "$branch" != "$default_branch" ]; then
		git -C "$dir" checkout -q "$default_branch"
		did_something=1
	fi

	local before after
	before="$(git -C "$dir" rev-parse HEAD)"
	git -C "$dir" pull -q --ff-only
	after="$(git -C "$dir" rev-parse HEAD)"
	[ "$before" != "$after" ] && did_something=1

	local to_delete
	to_delete="$(branches_to_delete "$dir" "$default_branch")"
	local deleted=()
	if [ -n "$to_delete" ]; then
		while IFS= read -r b; do
			[ -z "$b" ] && continue
			if git -C "$dir" branch -d "$b" >/dev/null 2>&1; then
				deleted+=("$b")
				did_something=1
			fi
		done <<<"$to_delete"
	fi

	if [ "$slot" = "code" ]; then
		git -C "$dir" submodule update --init -q
	fi

	if [ "$did_something" -eq 1 ]; then
		local note=""
		[ "${#deleted[@]}" -gt 0 ] && note=", deleted: ${deleted[*]}"
		echo "$slot: synced to $default_branch$note"
	else
		echo "$slot: up to date, nothing to delete"
	fi
}

for slot in "${repos_requested[@]}"; do
	sync_one "$slot"
done

exit $any_skipped
