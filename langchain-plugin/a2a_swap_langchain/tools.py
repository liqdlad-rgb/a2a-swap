"""
LangChain + CrewAI tools for A2A-Swap.

All seven tools work identically in both frameworks:

  LangChain:
      from a2a_swap_langchain import A2ASimulateTool, A2ASwapTool
      tools = [A2ASimulateTool(), A2ASwapTool()]

  CrewAI:
      from a2a_swap_langchain.crewai import A2ASimulateTool, A2ASwapTool
      agent = Agent(tools=[A2ASimulateTool(), A2ASwapTool()], ...)

Configuration (any of these works):
  - Environment:  A2A_KEYPAIR=/path/to/keypair.json  A2A_RPC_URL=https://...
  - Constructor:  A2ASwapTool(keypair="/path/to/keypair.json", rpc_url="https://...")
"""
from __future__ import annotations

from typing import Optional, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from . import _cli


# ── Input schemas ─────────────────────────────────────────────────────────────

class _SimulateInput(BaseModel):
    mint_in: str = Field(
        description=(
            "Mint address of the token to sell. "
            "Use 'SOL', 'USDC', or 'USDT' as shorthand, "
            "or a raw base-58 mint address."
        )
    )
    mint_out: str = Field(
        description=(
            "Mint address of the token to buy. "
            "Use 'SOL', 'USDC', or 'USDT' as shorthand, "
            "or a raw base-58 mint address."
        )
    )
    amount_in: int = Field(
        description=(
            "Amount to sell in atomic units (lamports for SOL, "
            "smallest denomination for tokens). "
            "Example: 1 SOL = 1000000000."
        )
    )


class _SwapInput(BaseModel):
    mint_in: str = Field(description="Mint of the token to sell (symbol or base-58 address).")
    mint_out: str = Field(description="Mint of the token to buy (symbol or base-58 address).")
    amount_in: int = Field(description="Amount to sell in atomic units.")
    max_slippage: Optional[float] = Field(
        default=0.5,
        description="Maximum acceptable slippage as a percentage (default 0.5%). "
                    "Swap is aborted if price moves more than this.",
    )


class _ProvideInput(BaseModel):
    mint_a: str = Field(description="First token mint (symbol or base-58).")
    mint_b: str = Field(description="Second token mint (symbol or base-58).")
    amount_a: int = Field(description="Amount of token A to deposit in atomic units.")
    amount_b: Optional[int] = Field(
        default=None,
        description=(
            "Amount of token B to deposit. Required only for the very first deposit "
            "into an empty pool (it sets the initial price). "
            "Omit for subsequent deposits — the program computes it from live reserves."
        ),
    )
    auto_compound: bool = Field(
        default=False,
        description="If true, accrued trading fees are automatically reinvested as "
                    "additional LP shares instead of accumulating for manual claim.",
    )


class _RemoveLiquidityInput(BaseModel):
    mint_a: str = Field(description="First token mint of the pool (symbol or base-58).")
    mint_b: str = Field(description="Second token mint of the pool (symbol or base-58).")
    lp_shares: int = Field(description="Number of LP shares to burn (use a2a_my_positions to check balance).")
    min_a: Optional[int] = Field(
        default=0,
        description="Minimum token A to accept in atomic units (slippage guard). Default 0 = no guard.",
    )
    min_b: Optional[int] = Field(
        default=0,
        description="Minimum token B to accept in atomic units (slippage guard). Default 0 = no guard.",
    )


class _ClaimFeesInput(BaseModel):
    mint_a: str = Field(description="First token mint of the pool (symbol or base-58).")
    mint_b: str = Field(description="Second token mint of the pool (symbol or base-58).")


class _PoolInfoInput(BaseModel):
    mint_a: str = Field(description="First token mint (symbol or base-58).")
    mint_b: str = Field(description="Second token mint (symbol or base-58).")


# ── Tools ─────────────────────────────────────────────────────────────────────

class A2ASimulateTool(BaseTool):
    """
    Simulate a token swap on A2A-Swap and return the full fee breakdown.

    Use this before executing a swap to check the estimated output, price
    impact, and fees — without spending any funds or sending a transaction.
    """

    name: str = "a2a_simulate_swap"
    description: str = (
        "Simulate a token swap on the A2A-Swap decentralized exchange on Solana. "
        "Returns the estimated output amount, protocol fee (0.020%), LP fee, "
        "effective exchange rate, and price impact. "
        "No wallet or funds required — this is read-only. "
        "Use this to preview any swap before executing it."
    )
    args_schema: Type[BaseModel] = _SimulateInput

    rpc_url: Optional[str] = None

    def _run(self, mint_in: str, mint_out: str, amount_in: int) -> str:
        try:
            data = _cli.run(
                "simulate",
                "--in", mint_in,
                "--out", mint_out,
                "--amount", str(amount_in),
                rpc_url=self.rpc_url,
            )
            return (
                f"Swap simulation: {mint_in} → {mint_out}\n"
                f"  Amount in:      {data.get('amount_in', amount_in)}\n"
                f"  Protocol fee:   {data.get('protocol_fee')} (0.020%)\n"
                f"  LP fee:         {data.get('lp_fee')} ({data.get('fee_rate_bps')} bps)\n"
                f"  Estimated out:  {data.get('estimated_out')}\n"
                f"  Effective rate: {data.get('effective_rate')}\n"
                f"  Price impact:   {data.get('price_impact_pct')}%\n"
                f"  Pool:           {data.get('pool')}"
            )
        except RuntimeError as exc:
            return f"Simulation failed: {exc}"


class A2ASwapTool(BaseTool):
    """
    Execute an atomic token swap on A2A-Swap.

    Requires a funded agent wallet (set A2A_KEYPAIR env var or pass keypair=).
    Simulates first, then executes if slippage is within tolerance.
    """

    name: str = "a2a_swap"
    description: str = (
        "Execute a token swap on the A2A-Swap DEX on Solana. "
        "Atomically sells one token for another using a constant-product pool. "
        "Requires: A2A_KEYPAIR environment variable pointing to the agent's keypair file. "
        "Optional: A2A_RPC_URL for a custom RPC endpoint. "
        "Returns the transaction signature and amounts exchanged."
    )
    args_schema: Type[BaseModel] = _SwapInput

    keypair: Optional[str] = None
    rpc_url: Optional[str] = None

    def _run(
        self,
        mint_in: str,
        mint_out: str,
        amount_in: int,
        max_slippage: Optional[float] = 0.5,
    ) -> str:
        try:
            args = [
                "--in", mint_in,
                "--out", mint_out,
                "--amount", str(amount_in),
            ]
            if max_slippage is not None:
                args += ["--max-slippage", str(max_slippage)]

            data = _cli.run(
                "convert",
                *args,
                keypair=self.keypair,
                rpc_url=self.rpc_url,
            )
            return (
                f"Swap executed: {mint_in} → {mint_out}\n"
                f"  Amount in:     {data.get('amount_in', amount_in)}\n"
                f"  Estimated out: {data.get('estimated_out')}\n"
                f"  Signature:     {data.get('signature')}\n"
                f"  Explorer:      https://explorer.solana.com/tx/{data.get('signature')}"
            )
        except RuntimeError as exc:
            return f"Swap failed: {exc}"


class A2AProvideLiquidityTool(BaseTool):
    """
    Deposit tokens into an A2A-Swap pool to earn trading fees.

    Requires a funded agent wallet. Returns LP share count and position address.
    Enable auto_compound to reinvest fees automatically as additional LP shares.
    """

    name: str = "a2a_provide_liquidity"
    description: str = (
        "Deposit tokens into an A2A-Swap liquidity pool and earn trading fees. "
        "The agent receives LP shares proportional to its deposit. "
        "Set auto_compound=true to automatically reinvest accrued fees as more LP shares. "
        "For the first deposit into a new pool, both amount_a AND amount_b are required "
        "(they set the initial price). Subsequent deposits only need amount_a. "
        "Requires: A2A_KEYPAIR environment variable."
    )
    args_schema: Type[BaseModel] = _ProvideInput

    keypair: Optional[str] = None
    rpc_url: Optional[str] = None

    def _run(
        self,
        mint_a: str,
        mint_b: str,
        amount_a: int,
        amount_b: Optional[int] = None,
        auto_compound: bool = False,
    ) -> str:
        try:
            args = [
                "--pair", f"{mint_a}-{mint_b}",
                "--amount", str(amount_a),
            ]
            if amount_b is not None:
                args += ["--amount-b", str(amount_b)]
            if auto_compound:
                args.append("--auto-compound")

            data = _cli.run(
                "provide",
                *args,
                keypair=self.keypair,
                rpc_url=self.rpc_url,
            )
            return (
                f"Liquidity provided to {mint_a}/{mint_b} pool\n"
                f"  Deposited A:  {data.get('amount_a', amount_a)}\n"
                f"  Deposited B:  {data.get('amount_b', amount_b)}\n"
                f"  LP shares:    {data.get('lp_shares')}\n"
                f"  Position:     {data.get('position')}\n"
                f"  Signature:    {data.get('signature')}"
            )
        except RuntimeError as exc:
            return f"Provide liquidity failed: {exc}"


class A2ARemoveLiquidityTool(BaseTool):
    """
    Burn LP shares and withdraw proportional tokens from an A2A-Swap pool.

    Fees are synced before withdrawal but not transferred — use A2AClaimFeesTool
    to collect them. Requires a funded agent wallet.
    """

    name: str = "a2a_remove_liquidity"
    description: str = (
        "Withdraw liquidity from an A2A-Swap pool by burning LP shares. "
        "Returns proportional token A and token B amounts to the agent's wallet. "
        "Use a2a_my_positions to check your current LP share balance first. "
        "Optional min_a / min_b provide slippage guards (reject if output is below). "
        "Fees are synced but NOT transferred — run a2a_claim_fees after to collect them. "
        "Requires: A2A_KEYPAIR environment variable."
    )
    args_schema: Type[BaseModel] = _RemoveLiquidityInput

    keypair: Optional[str] = None
    rpc_url: Optional[str] = None

    def _run(
        self,
        mint_a: str,
        mint_b: str,
        lp_shares: int,
        min_a: Optional[int] = 0,
        min_b: Optional[int] = 0,
    ) -> str:
        try:
            args = [
                "--pair", f"{mint_a}-{mint_b}",
                "--shares", str(lp_shares),
            ]
            if min_a:
                args += ["--min-a", str(min_a)]
            if min_b:
                args += ["--min-b", str(min_b)]

            data = _cli.run(
                "remove-liquidity",
                *args,
                keypair=self.keypair,
                rpc_url=self.rpc_url,
            )
            return (
                f"Liquidity removed from {mint_a}/{mint_b} pool\n"
                f"  LP shares burnt:  {data.get('lp_shares', lp_shares)}\n"
                f"  Expected A:       {data.get('expected_a')}\n"
                f"  Expected B:       {data.get('expected_b')}\n"
                f"  Position:         {data.get('position')}\n"
                f"  Signature:        {data.get('tx')}\n"
                f"  Run a2a_claim_fees to collect any accrued fees."
            )
        except RuntimeError as exc:
            return f"Remove liquidity failed: {exc}"


class A2AClaimFeesTool(BaseTool):
    """
    Claim accrued LP trading fees for one A2A-Swap pool position.

    If the position has auto_compound enabled, fees are reinvested as
    additional LP shares instead of being transferred out.
    Requires a funded agent wallet.
    """

    name: str = "a2a_claim_fees"
    description: str = (
        "Claim accrued LP trading fees from an A2A-Swap pool position. "
        "If auto_compound is enabled, fees are converted to additional LP shares "
        "instead of being sent to the wallet. "
        "Use a2a_my_fees first to preview claimable amounts without sending a transaction. "
        "Requires: A2A_KEYPAIR environment variable."
    )
    args_schema: Type[BaseModel] = _ClaimFeesInput

    keypair: Optional[str] = None
    rpc_url: Optional[str] = None

    def _run(self, mint_a: str, mint_b: str) -> str:
        try:
            data = _cli.run(
                "claim-fees",
                "--pair", f"{mint_a}-{mint_b}",
                keypair=self.keypair,
                rpc_url=self.rpc_url,
            )
            if data.get("note") == "No fees to claim":
                return f"No fees to claim for {mint_a}/{mint_b} position."
            mode = "auto-compounded into LP shares" if data.get("auto_compound") else "transferred to wallet"
            return (
                f"Fees claimed from {mint_a}/{mint_b} pool\n"
                f"  Fees A:    {data.get('fees_a')}\n"
                f"  Fees B:    {data.get('fees_b')}\n"
                f"  Mode:      {mode}\n"
                f"  Signature: {data.get('tx')}"
            )
        except RuntimeError as exc:
            return f"Claim fees failed: {exc}"


class A2APoolInfoTool(BaseTool):
    """
    Fetch live pool state from A2A-Swap: reserves, spot price, LP supply, fee rate.
    Read-only — no wallet required.
    """

    name: str = "a2a_pool_info"
    description: str = (
        "Fetch live information about an A2A-Swap liquidity pool on Solana. "
        "Returns: reserve balances, current spot price, total LP supply, and fee rate. "
        "This is read-only — no wallet or funds required. "
        "Use this to check pool depth before swapping or to monitor LP positions."
    )
    args_schema: Type[BaseModel] = _PoolInfoInput

    rpc_url: Optional[str] = None

    def _run(self, mint_a: str, mint_b: str) -> str:
        try:
            data = _cli.run(
                "pool-info",
                "--pair", f"{mint_a}-{mint_b}",
                rpc_url=self.rpc_url,
            )
            return (
                f"Pool info: {mint_a} / {mint_b}\n"
                f"  Pool:       {data.get('pool')}\n"
                f"  Reserve A:  {data.get('reserve_a')}\n"
                f"  Reserve B:  {data.get('reserve_b')}\n"
                f"  LP supply:  {data.get('lp_supply')}\n"
                f"  Fee rate:   {data.get('fee_rate_bps')} bps "
                f"({float(data.get('fee_rate_bps', 0)) / 100:.2f}%)\n"
                f"  Spot price: {data.get('spot_price')}"
            )
        except RuntimeError as exc:
            return f"Pool info failed: {exc}"


class A2AMyFeesTool(BaseTool):
    """
    Show accrued trading fees across all A2A-Swap LP positions for the agent wallet.
    Read-only — safe to poll frequently.
    """

    name: str = "a2a_my_fees"
    description: str = (
        "Check accrued (claimable) trading fees for the agent's LP positions on A2A-Swap. "
        "Shows each position's LP share count, pending fees in both tokens, and totals. "
        "Read-only — no transaction is sent. Safe to poll on any schedule. "
        "Requires: A2A_KEYPAIR to identify which positions belong to this agent."
    )
    args_schema: Type[BaseModel] = BaseModel  # no inputs needed

    keypair: Optional[str] = None
    rpc_url: Optional[str] = None

    def _run(self) -> str:
        try:
            data = _cli.run(
                "my-fees",
                keypair=self.keypair,
                rpc_url=self.rpc_url,
            )
            positions = data.get("positions", [])
            if not positions:
                return "No LP positions found for this agent."

            lines = []
            for i, pos in enumerate(positions):
                lines.append(
                    f"  [{i}] {str(pos.get('address', ''))[:8]}…  "
                    f"LP: {pos.get('lp_shares')}  "
                    f"fees A: {pos.get('fees_a')}  "
                    f"fees B: {pos.get('fees_b')}"
                )
            return (
                f"Fee summary ({len(positions)} position{'s' if len(positions) != 1 else ''}):\n"
                + "\n".join(lines)
                + f"\n  Total fees A: {data.get('total_fees_a')}"
                + f"\n  Total fees B: {data.get('total_fees_b')}"
            )
        except RuntimeError as exc:
            return f"Fee check failed: {exc}"


# ── Convenience bundle ────────────────────────────────────────────────────────

def get_tools(
    keypair: str | None = None,
    rpc_url: str | None = None,
) -> list[BaseTool]:
    """
    Return all five A2A-Swap tools pre-configured with keypair / rpc_url.

    Usage::

        from a2a_swap_langchain import get_tools
        tools = get_tools(keypair="~/.config/solana/id.json")
    """
    shared = {"keypair": keypair, "rpc_url": rpc_url}
    return [
        A2ASimulateTool(rpc_url=rpc_url),
        A2ASwapTool(**shared),
        A2AProvideLiquidityTool(**shared),
        A2ARemoveLiquidityTool(**shared),
        A2AClaimFeesTool(**shared),
        A2APoolInfoTool(rpc_url=rpc_url),
        A2AMyFeesTool(**shared),
    ]
