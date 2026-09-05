#!/bin/bash
# Run once from inside a freshly created uma-tools worktree:
# initializes the submodule, links node_modules (parent AND submodule) and plans/
# from the main checkout, and git-excludes the node_modules symlinks so neither
# `git add -A` nor the submodule's status can ever pick them up.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git submodule update --init

main_checkout=$(dirname "$(git rev-parse --git-common-dir)")
if [ ! -e node_modules ]; then
	ln -s "$main_checkout/node_modules" node_modules
fi

# plans/ is a symlink to the sibling uma-tools-plans repo in the main checkout (and
# .gitignore'd there); without it, worktree sessions can't reach work-queue tickets.
# Guarded: a checkout without the private plans repo just skips it.
if [ ! -e plans ] && [ -e "$main_checkout/plans" ]; then
	ln -s "$main_checkout/plans" plans
fi

# The submodule is its own npm project with its own node_modules; without it,
# `npx ts-node` inside uma-skill-tools/ silently falls through to an unrelated
# npx-cached copy and dies with a misleading TypeError deep in ts-node itself
# (PIPE-47). Sharing the main checkout's install is safe: same commit, same
# package.json. Never create a dangling symlink — that reproduces the exact
# error this block exists to prevent.
if [ ! -e uma-skill-tools/node_modules ]; then
	if [ -e "$main_checkout/uma-skill-tools/node_modules" ]; then
		ln -s "$main_checkout/uma-skill-tools/node_modules" uma-skill-tools/node_modules
	else
		echo "note: $main_checkout/uma-skill-tools has no node_modules -- run 'npm install' there first, then re-run this script, or engine tests in this worktree will fail" >&2
	fi
fi

# The engine's .gitignore entry is 'node_modules/' (trailing slash: directories
# only), which does NOT match a symlink -- without an exclude the submodule's
# status shows '?? node_modules' forever and stage-for-review.sh refuses
# teardown. A submodule inside a worktree has its own git dir, so resolve the
# exclude file through git, never by assuming a path under .git/.
if [ -e uma-skill-tools/node_modules ]; then
	sub_exclude=$(git -C uma-skill-tools rev-parse --path-format=absolute --git-path info/exclude)
	mkdir -p "$(dirname "$sub_exclude")"
	grep -qx node_modules "$sub_exclude" 2>/dev/null || echo node_modules >> "$sub_exclude"
fi

# The exclude file git actually honors lives in the common dir (the one under
# .git/worktrees/<name>/info/ is never read); --git-path resolves it correctly.
exclude_file=$(git rev-parse --path-format=absolute --git-path info/exclude)
mkdir -p "$(dirname "$exclude_file")"
grep -qx node_modules "$exclude_file" 2>/dev/null || echo node_modules >> "$exclude_file"

echo "worktree ready: submodule initialized, node_modules (parent + submodule) and plans linked and git-excluded"
