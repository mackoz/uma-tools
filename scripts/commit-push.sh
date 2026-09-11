#!/bin/bash
# Explicit-path add -> commit -> push -> `log -1`, replacing the hand-driven sequence
# CLAUDE.md's ticket found ~100x in recent transcripts (`git add -A` showed up 14x there --
# this script refuses that shortcut on purpose: only explicit paths).
#
#   scripts/commit-push.sh --repo <code|engine|plans> (-m "<msg>" | -F <file>)
#                           [--allow-default] [--no-push] [--dry-run] -- <path>...
#
#   --repo SLOT       code, engine, or plans -- maps to $UMA_CODE_REPO/$UMA_ENGINE_REPO/
#                      $UMA_PLANS_REPO (see scripts/repo-env.sh)
#   -m "<msg>"         commit message (mutually exclusive with -F)
#   -F <file>          read the commit message from a file
#   --allow-default    allow committing directly on the repo's default branch
#                      (master for code/engine, main for plans) -- the one legitimate
#                      case today is the plans repo's `wq.py file` convention; refused
#                      otherwise
#   --no-push          commit only, skip the push
#   --dry-run          print every git command that would run, prefixed [dry-run], and
#                       exit 0 without running any of them
#   -- <path>...       explicit paths to add (required, non-empty; no -A, no .)
set -euo pipefail

usage() {
	cat <<'EOF'
usage: scripts/commit-push.sh --repo <code|engine|plans> (-m "<msg>" | -F <file>)
                               [--allow-default] [--no-push] [--dry-run] -- <path>...

Stages explicit paths, commits, and pushes in one repo of the three-repo loop.

  --repo SLOT      code, engine, or plans (required)
  -m "<msg>"        commit message (mutually exclusive with -F)
  -F <file>         read the commit message from a file
  --allow-default   allow committing on the repo's default branch (master for
                     code/engine, main for plans). The plans repo's `wq.py file`
                     convention (commits directly on whatever branch is
                     checked out, often main) is the one legitimate case for
                     this; refused otherwise.
  --no-push         commit only, don't push
  --dry-run         print every git command that would run, prefixed
                     [dry-run], and exit 0 without running any of them
  --help            print this usage and exit 0
  -- <path>...      explicit paths to stage (required; no -A, no ., refused
                     if empty)

Refuses (exit 1, one-line reason) when: no --repo, no message, no paths, the
current branch is the default branch without --allow-default, or none of the
given paths has a staged-or-unstaged change. If *some* paths changed and
others didn't, proceeds with the changed ones and prints the skipped ones.
Idempotent: if nothing ends up staged after `git add`, prints "nothing to
commit" and exits 0 rather than failing.
EOF
}

repo_slot=""
message=""
message_file=""
allow_default=0
no_push=0
dry_run=0
paths=()

while [ $# -gt 0 ]; do
	case "$1" in
		--help) usage; exit 0 ;;
		--repo) repo_slot="$2"; shift 2 ;;
		--repo=*) repo_slot="${1#*=}"; shift ;;
		-m) message="$2"; shift 2 ;;
		-F) message_file="$2"; shift 2 ;;
		--allow-default) allow_default=1; shift ;;
		--no-push) no_push=1; shift ;;
		--dry-run) dry_run=1; shift ;;
		--) shift; paths+=("$@"); break ;;
		*) echo "commit-push.sh: unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [ -z "$repo_slot" ]; then
	echo "commit-push.sh: --repo <code|engine|plans> is required" >&2
	exit 1
fi
if [ -n "$message" ] && [ -n "$message_file" ]; then
	echo "commit-push.sh: pass only one of -m or -F" >&2
	exit 1
fi
if [ -z "$message" ] && [ -z "$message_file" ]; then
	echo "commit-push.sh: a commit message is required (-m or -F)" >&2
	exit 1
fi
if [ "${#paths[@]}" -eq 0 ]; then
	echo "commit-push.sh: refusing an empty pathspec -- pass explicit paths after --" >&2
	exit 1
fi

source "$(dirname "${BASH_SOURCE[0]}")/repo-env.sh"

case "$repo_slot" in
	code) repo_dir="$UMA_CODE_REPO"; default_branch="master" ;;
	engine) repo_dir="$UMA_ENGINE_REPO"; default_branch="master" ;;
	plans) repo_dir="$UMA_PLANS_REPO"; default_branch="main" ;;
	*) echo "commit-push.sh: --repo must be code, engine, or plans (got: $repo_slot)" >&2; exit 1 ;;
esac

if [ ! -d "$repo_dir" ] || ! git -C "$repo_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	echo "commit-push.sh: $repo_slot repo not present at $repo_dir" >&2
	exit 1
fi

branch="$(git -C "$repo_dir" symbolic-ref --short -q HEAD || true)"
if [ -z "$branch" ]; then
	echo "commit-push.sh: $repo_slot repo is in detached HEAD, refusing to commit" >&2
	exit 1
fi
if [ "$branch" = "$default_branch" ] && [ "$allow_default" -eq 0 ]; then
	echo "commit-push.sh: refusing to commit on $repo_slot's default branch ($default_branch) without --allow-default" >&2
	exit 1
fi

# Split the given paths into changed / unchanged, so a partially-stale
# pathspec still proceeds with whatever actually changed.
changed=()
skipped=()
for p in "${paths[@]}"; do
	if [ -n "$(git -C "$repo_dir" status --porcelain -- "$p")" ]; then
		changed+=("$p")
	else
		skipped+=("$p")
	fi
done

if [ "${#changed[@]}" -eq 0 ]; then
	echo "commit-push.sh: nothing to commit -- none of the given paths have a staged-or-unstaged change" >&2
	exit 1
fi
if [ "${#skipped[@]}" -gt 0 ]; then
	echo "commit-push.sh: skipping unchanged path(s): ${skipped[*]}"
fi

msg_args=(-m "$message")
[ -n "$message_file" ] && msg_args=(-F "$message_file")

if [ "$dry_run" -eq 1 ]; then
	echo "[dry-run] git -C $repo_dir add -- ${changed[*]}"
	if [ -n "$message_file" ]; then
		echo "[dry-run] git -C $repo_dir commit -F $message_file"
	else
		echo "[dry-run] git -C $repo_dir commit -m \"$message\""
	fi
	if [ "$no_push" -eq 0 ]; then
		if git -C "$repo_dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
			echo "[dry-run] git -C $repo_dir push"
		else
			echo "[dry-run] git -C $repo_dir push -u origin $branch"
		fi
	fi
	exit 0
fi

git -C "$repo_dir" add -- "${changed[@]}"

if [ -z "$(git -C "$repo_dir" diff --cached --name-only)" ]; then
	echo "commit-push.sh: nothing to commit -- git add staged no changes"
	exit 0
fi

git -C "$repo_dir" commit "${msg_args[@]}"

if [ "$no_push" -eq 0 ]; then
	if git -C "$repo_dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
		git -C "$repo_dir" push
	else
		git -C "$repo_dir" push -u origin "$branch"
	fi
fi

git -C "$repo_dir" log --oneline -1
