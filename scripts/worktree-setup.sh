#!/bin/bash
# Run once from inside a freshly created uma-tools worktree:
# initializes the submodule, links node_modules (parent AND submodule) and plans/
# from the main checkout, and git-excludes the node_modules symlinks so neither
# `git add -A` nor the submodule's status can ever pick them up.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git submodule update --init

main_checkout=$(dirname "$(git rev-parse --git-common-dir)")

# Three-way check (absent / symlink / real directory), not a bare `[ ! -e ]`:
# npm does not install *through* a symlinked node_modules -- it replaces the
# symlink with a real directory (PIPE-56). A bare existence guard silently
# does nothing in that case, which is exactly the state that needs saying
# something: this worktree has diverged from the shared install, and a stray
# `npm i` run from inside it may have left the *main checkout's* copy stale
# and untested (this happened for real during PIPE-52 -- the engine's
# node_modules ended up missing a then-new dependency, and nothing noticed
# until `npm test` failed from the main checkout). Never auto-delete or
# re-link a real directory here: it may hold a deliberately divergent
# install; say what's wrong and what to run instead.
check_node_modules_link() {
	local link_path="$1" target="$2" label="$3"
	if [ -L "$link_path" ]; then
		return 0
	elif [ -e "$link_path" ]; then
		echo "warning: $label is a real directory, not the shared symlink to $target -- npm has likely installed into it directly (PIPE-56), diverging this worktree from the shared install. Not touching it: if that's unintended, 'rm -rf $link_path' and re-run this script to restore the symlink; if it's a deliberate divergent install, leave it as is." >&2
		return 1
	else
		ln -s "$target" "$link_path"
		return 0
	fi
}

# `|| true`: a real-directory divergence is a warning, not a reason to abort
# the rest of setup (plans/ linking, git-excludes) under `set -e`.
check_node_modules_link node_modules "$main_checkout/node_modules" node_modules || true

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
# error this block exists to prevent. Same three-way check as the parent
# node_modules above: an `npm i` run inside the submodule from a worktree
# replaces this symlink with a real directory just as silently.
if [ -e "$main_checkout/uma-skill-tools/node_modules" ]; then
	check_node_modules_link uma-skill-tools/node_modules "$main_checkout/uma-skill-tools/node_modules" uma-skill-tools/node_modules || true
elif [ ! -e uma-skill-tools/node_modules ]; then
	echo "note: $main_checkout/uma-skill-tools has no node_modules -- run 'npm install' there first, then re-run this script, or engine tests in this worktree will fail" >&2
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
