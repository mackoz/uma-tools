#!/bin/bash
# Run from the main uma-tools checkout after a feature branch's work is pushed:
# removes the .claude worktree holding <branch> (refusing if anything would be
# lost), checks the branch out here, and runs the verify build so the local
# deploy check can start immediately.
#
#   scripts/stage-for-review.sh <branch>
set -euo pipefail

branch=${1:?usage: stage-for-review.sh <branch>}
cd "$(git rev-parse --show-toplevel)"

wt=$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '
	$1 == "worktree" { w = $2 }
	$1 == "branch" && $2 == b { print w }')

if [ -n "$wt" ]; then
	if [ -n "$(git -C "$wt" status --porcelain)" ]; then
		echo "refusing: worktree $wt has uncommitted changes" >&2
		exit 1
	fi
	if ! git rev-parse --verify -q "origin/$branch" > /dev/null; then
		echo "refusing: branch $branch was never pushed" >&2
		exit 1
	fi
	if [ -n "$(git log --oneline "origin/$branch..$branch")" ]; then
		echo "refusing: branch $branch has unpushed commits" >&2
		exit 1
	fi
	# git worktree remove refuses on worktrees containing submodules; rm+prune
	# is the documented workaround for this repo.
	rm -rf "$wt"
	git worktree prune
fi

git checkout "$branch"
git submodule update --init
npm run verify
