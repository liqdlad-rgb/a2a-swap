"""
A2A-Swap × CrewAI — multi-agent DeFi crew example

A two-agent crew:
  - Analyst: monitors prices and simulates trades (read-only tools)
  - Trader:  executes swaps and manages liquidity (write tools)

Prerequisites:
    pip install "a2a-swap-langchain[crewai]" crewai langchain-openai
    cargo install a2a-swap-cli

Environment:
    OPENAI_API_KEY=sk-...
    A2A_KEYPAIR=~/.config/solana/id.json
"""

import os
from crewai import Agent, Crew, Task
from a2a_swap_langchain import (
    A2ASimulateTool,
    A2APoolInfoTool,
    A2ASwapTool,
    A2AProvideLiquidityTool,
    A2AMyFeesTool,
)

# ── Tools ─────────────────────────────────────────────────────────────────────

# Read-only tools — safe for the analyst
read_tools = [
    A2ASimulateTool(),
    A2APoolInfoTool(),
    A2AMyFeesTool(),
]

# Write tools — restricted to the trader
write_tools = [
    A2ASwapTool(),
    A2AProvideLiquidityTool(),
]

# ── Agents ────────────────────────────────────────────────────────────────────

analyst = Agent(
    role="DeFi Market Analyst",
    goal=(
        "Monitor A2A-Swap pool conditions and identify profitable trading "
        "or liquidity-providing opportunities. Always check price impact "
        "before recommending a trade."
    ),
    backstory=(
        "You are a meticulous on-chain analyst. You never execute trades — "
        "you only gather data and make recommendations backed by numbers."
    ),
    tools=read_tools,
    verbose=True,
)

trader = Agent(
    role="Autonomous DeFi Trader",
    goal=(
        "Execute token swaps and manage liquidity positions on A2A-Swap "
        "based on the analyst's recommendations."
    ),
    backstory=(
        "You are a disciplined trader. You only execute trades when the "
        "analyst has confirmed price impact is acceptable (< 1%). "
        "You always report the transaction signature after execution."
    ),
    tools=write_tools,
    verbose=True,
)

# ── Tasks ─────────────────────────────────────────────────────────────────────

analyse_task = Task(
    description=(
        "1. Fetch SOL/USDC pool info — reserves, spot price, fee rate.\n"
        "2. Simulate selling 0.5 SOL (500000000 lamports) for USDC.\n"
        "3. Report: estimated USDC out, price impact %, protocol fee, LP fee.\n"
        "4. Recommend whether to execute (price impact < 1%) or wait."
    ),
    expected_output=(
        "A summary with pool state, simulation numbers, and a clear "
        "BUY / WAIT recommendation with reasoning."
    ),
    agent=analyst,
)

trade_task = Task(
    description=(
        "Based on the analyst's recommendation:\n"
        "- If BUY: execute the swap of 0.5 SOL for USDC with max 0.5% slippage.\n"
        "- If WAIT: report that no trade was executed and explain why.\n"
        "Always show the transaction signature if a trade was made."
    ),
    expected_output=(
        "Either a confirmation with tx signature and amounts, "
        "or a clear explanation of why the trade was skipped."
    ),
    agent=trader,
    context=[analyse_task],
)

fees_task = Task(
    description=(
        "Check all accrued trading fees for this agent's LP positions on A2A-Swap. "
        "Report total claimable fees in both tokens."
    ),
    expected_output="A fee summary showing each position and total claimable amounts.",
    agent=analyst,
)

# ── Crew ──────────────────────────────────────────────────────────────────────

crew = Crew(
    agents=[analyst, trader],
    tasks=[analyse_task, trade_task, fees_task],
    verbose=True,
)

if __name__ == "__main__":
    result = crew.kickoff()
    print("\n=== Crew result ===")
    print(result)
