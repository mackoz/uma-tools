#!/bin/bash
# Run once from inside a freshly created uma-tools worktree:
# initializes the submodule, links node_modules from the main checkout,
# and git-excludes the symlink so `git add -A` can never commit it.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git submodule update --init

main_checkout=$(dirname "$(git rev-parse --git-common-dir)")
if [ ! -e node_modules ]; then
	ln -s "$main_checkout/node_modules" node_modules
fi

gitdir=$(git rev-parse --absolute-git-dir)
mkdir -p "$gitdir/info"
grep -qx node_modules "$gitdir/info/exclude" 2>/dev/null || echo node_modules >> "$gitdir/info/exclude"

echo "worktree ready: submodule initialized, node_modules linked and git-excluded"
