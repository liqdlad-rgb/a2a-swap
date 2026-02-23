#!/usr/bin/env bash
# test-local.sh — Run the full A2A-Swap test suite against a local Solana validator.
#
# Steps:
#   1. Kill any existing solana-test-validator
#   2. Start a fresh validator (reset ledger)
#   3. Wait until the validator accepts RPC calls
#   4. Airdrop SOL to the deployer wallet
#   5. Build the on-chain program  (skip with: SKIP_BUILD=1 ./test-local.sh)
#   6. Deploy to the local validator
#   7. Run Anchor unit tests  (tests/a2a-swap.ts)
#   8. Run SDK integration tests  (tests/cli-integration.test.ts)
#   9. Stop the validator and report results
#
# Usage:
#   ./test-local.sh                   # full run (build + deploy + test)
#   SKIP_BUILD=1 ./test-local.sh      # reuse existing .so (faster)

set -euo pipefail

# ── Paths ──────────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEDGER_DIR="$REPO_ROOT/test-ledger"
VALIDATOR_URL="http://127.0.0.1:8899"
WALLET_PATH="${HOME}/.config/solana/id.json"
VALIDATOR_PID=""

cd "$REPO_ROOT"

# ── Colours ────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
  BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; NC=''
fi

step() { echo -e "${BOLD}${GREEN}▶ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
die()  { echo -e "${RED}✗  $*${NC}" >&2; exit 1; }

# ── Prereq check ───────────────────────────────────────────────────────────────
for cmd in solana-test-validator anchor solana yarn; do
  command -v "$cmd" &>/dev/null || die "'$cmd' not found. Please install Solana toolchain and Anchor."
done

[[ -f "$WALLET_PATH" ]] || die "Wallet not found at $WALLET_PATH. Run: solana-keygen new -o $WALLET_PATH"

# ── Cleanup trap ───────────────────────────────────────────────────────────────
cleanup() {
  local code=$?
  echo ""
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    step "Stopping solana-test-validator (pid $VALIDATOR_PID)…"
    kill "$VALIDATOR_PID" 2>/dev/null || true
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi
  echo ""
  if [[ $code -eq 0 ]]; then
    echo -e "${BOLD}${GREEN}✔  All tests passed${NC}"
  else
    echo -e "${BOLD}${RED}✗  Tests failed (exit $code)${NC}"
  fi
  exit $code
}
trap cleanup EXIT INT TERM

# ── 1. Kill any running validator ──────────────────────────────────────────────
if pgrep -f "solana-test-validator" > /dev/null 2>&1; then
  warn "Killing existing solana-test-validator…"
  pkill -f "solana-test-validator" 2>/dev/null || true
  sleep 2
fi

# ── 2. Start validator ─────────────────────────────────────────────────────────
step "Starting solana-test-validator  (ledger: $LEDGER_DIR)…"
solana-test-validator \
  --ledger     "$LEDGER_DIR" \
  --reset \
  --quiet \
  --bind-address 127.0.0.1 \
  --rpc-port   8899 \
  --faucet-port 9900 \
  2>/dev/null &
VALIDATOR_PID=$!

# ── 3. Wait for RPC to be ready ────────────────────────────────────────────────
step "Waiting for validator to accept RPC calls…"
MAX_WAIT=40
READY=0
for i in $(seq 1 $MAX_WAIT); do
  if curl -sf "$VALIDATOR_URL/health" > /dev/null 2>&1; then
    echo "  Ready after ${i}s  (pid $VALIDATOR_PID)"
    READY=1
    break
  fi
  sleep 1
done
[[ $READY -eq 1 ]] || die "Validator did not become ready after ${MAX_WAIT}s"

# ── 4. Fund deployer wallet ────────────────────────────────────────────────────
WALLET_ADDR="$(solana-keygen pubkey "$WALLET_PATH")"
step "Funding deployer wallet  ($WALLET_ADDR)…"
# solana-test-validator pre-funds the genesis wallet, but airdrop is harmless
solana airdrop 100 "$WALLET_ADDR" --url "$VALIDATOR_URL" > /dev/null 2>&1 || true
BALANCE="$(solana balance --url "$VALIDATOR_URL" "$WALLET_ADDR" 2>/dev/null)"
echo "  Balance: $BALANCE"

# ── 5. Build ───────────────────────────────────────────────────────────────────
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  warn "SKIP_BUILD=1 — skipping anchor build"
  [[ -f "$REPO_ROOT/target/deploy/a2a_swap.so" ]] \
    || die "No .so found at target/deploy/a2a_swap.so — run without SKIP_BUILD=1 first"
else
  step "Building on-chain program  (anchor build)…"
  _BUILD_LOG="$(mktemp)"
  if anchor build > "$_BUILD_LOG" 2>&1; then
    grep -E "^(Compiling|Finished)" "$_BUILD_LOG" || true
    echo "  Built: $(du -sh "$REPO_ROOT/target/deploy/a2a_swap.so" | cut -f1)  target/deploy/a2a_swap.so"
  else
    cat "$_BUILD_LOG" >&2
    rm -f "$_BUILD_LOG"
    die "anchor build failed — see output above"
  fi
  rm -f "$_BUILD_LOG"
fi

# ── 6. Deploy ──────────────────────────────────────────────────────────────────
step "Deploying a2a-swap to local validator…"
_DEPLOY_LOG="$(mktemp)"
if ANCHOR_WALLET="$WALLET_PATH" anchor deploy --provider.cluster localnet > "$_DEPLOY_LOG" 2>&1; then
  grep -v "^Deploying cluster" "$_DEPLOY_LOG" || true
else
  cat "$_DEPLOY_LOG" >&2
  rm -f "$_DEPLOY_LOG"
  die "anchor deploy failed — see output above"
fi
rm -f "$_DEPLOY_LOG"

# Confirm the program is live
PROG_ID="8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq"
if solana program show "$PROG_ID" --url "$VALIDATOR_URL" &>/dev/null; then
  echo "  Program live: $PROG_ID"
else
  # Not a fatal error — program ID check can lag a block
  warn "Program show returned an error (may still be processing)"
fi

# ── 7 & 8. Run all tests ───────────────────────────────────────────────────────
echo ""
step "Running full test suite…"
echo "  Files: tests/a2a-swap.ts  +  tests/cli-integration.test.ts"
echo ""

# anchor test handles setting ANCHOR_PROVIDER_URL + ANCHOR_WALLET from Anchor.toml
# --skip-local-validator  → don't try to start another validator
# --skip-deploy           → program already deployed above
ANCHOR_WALLET="$WALLET_PATH" \
  anchor test --skip-local-validator --skip-deploy 2>&1
