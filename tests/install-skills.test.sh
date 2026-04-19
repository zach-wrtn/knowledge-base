#!/usr/bin/env bash
# Test install-skills.sh idempotency. Uses HOME sandbox to avoid touching the
# real ~/.claude/skills/ dir.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL="$REPO_ROOT/scripts/install-skills.sh"

SANDBOX="$(mktemp -d -t kb-install-test-XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

pass=0
fail=0

run()           { HOME="$SANDBOX" bash "$INSTALL" "$@"; }
run_force()     { HOME="$SANDBOX" ZZEM_KB_FORCE_LINK=1 bash "$INSTALL" "$@"; }
link_path()     { echo "$SANDBOX/.claude/skills/zzem-kb"; }
target_of()     { readlink "$1"; }
reset_sandbox() { rm -rf "$SANDBOX"; mkdir -p "$SANDBOX"; }

check() {
  local label="$1"; shift
  if "$@"; then pass=$((pass+1)); echo "PASS  $label"
  else fail=$((fail+1)); echo "FAIL  $label"
  fi
}

# Case 1: fresh install creates the link
reset_sandbox
run > /dev/null 2>&1
check "case1: link created" test -L "$(link_path)"
check "case1: points to repo skills" test "$(target_of "$(link_path)")" = "$REPO_ROOT/skills"

# Case 2: re-run with same target is a silent no-op (exit 0)
run > /dev/null 2>&1
rc=$?
check "case2: re-run exits 0" test "$rc" -eq 0
check "case2: link unchanged" test "$(target_of "$(link_path)")" = "$REPO_ROOT/skills"

# Case 3: different target, no FORCE — must refuse and leave link alone
reset_sandbox
mkdir -p "$SANDBOX/.claude/skills" "$SANDBOX/other-skills"
ln -s "$SANDBOX/other-skills" "$(link_path)"
if run > /dev/null 2>&1; then
  fail=$((fail+1)); echo "FAIL  case3: should have exited non-zero"
else
  pass=$((pass+1)); echo "PASS  case3: exited non-zero"
fi
check "case3: link not clobbered" test "$(target_of "$(link_path)")" = "$SANDBOX/other-skills"

# Case 4: different target + FORCE — re-link
run_force > /dev/null 2>&1
check "case4: force-relinked" test "$(target_of "$(link_path)")" = "$REPO_ROOT/skills"

echo "---"
echo "$pass passed, $fail failed"
test "$fail" -eq 0
