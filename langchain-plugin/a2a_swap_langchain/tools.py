"""
LangChain + CrewAI tools for A2A-Swap.

All five tools work identically in both frameworks:

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
        A2APoolInfoTool(rpc_url=rpc_url),
        A2AMyFeesTool(**shared),
    ]
