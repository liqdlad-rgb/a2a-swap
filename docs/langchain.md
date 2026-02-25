# LangChain / CrewAI

Python tools for LangChain agents and CrewAI crews. The library wraps the CLI as a subprocess — install once, use from any Python AI framework.

**Package:** [`a2a-swap-langchain`](https://pypi.org/project/a2a-swap-langchain/)

---

## Installation

```bash
pip install a2a-swap-langchain          # LangChain only
pip install "a2a-swap-langchain[crewai]" # + CrewAI support
```

The tools call the CLI as a subprocess, so the CLI must also be installed:

```bash
cargo install a2a-swap-cli
```

---

## Configuration

Set environment variables (or pass them directly to `get_tools()`):

```bash
export A2A_KEYPAIR=~/.config/solana/id.json
export A2A_RPC_URL=https://api.mainnet-beta.solana.com  # optional, mainnet is default
```

---

## Available tools

| Tool class | Tool name | Wallet needed | Description |
|------------|-----------|:-------------:|-------------|
| `A2ASimulateTool` | `a2a_simulate_swap` | No | Preview swap: fees, estimated output, price impact |
| `A2ASwapTool` | `a2a_swap` | Yes | Execute an atomic token swap |
| `A2AProvideLiquidityTool` | `a2a_provide_liquidity` | Yes | Deposit tokens, receive LP shares |
| `A2APoolInfoTool` | `a2a_pool_info` | No | Pool reserves, spot price, fee rate |
| `A2AMyFeesTool` | `a2a_my_fees` | Yes | Accrued trading fees across all positions |
| `A2ARemoveLiquidityTool` | `a2a_remove_liquidity` | Yes | Burn LP shares, withdraw tokens |
| `A2AClaimFeesTool` | `a2a_claim_fees` | Yes | Collect or auto-compound accrued fees |

---

## LangChain

```python
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from a2a_swap_langchain import get_tools

# Load all 7 tools (reads A2A_KEYPAIR / A2A_RPC_URL from env)
tools = get_tools()
llm   = ChatOpenAI(model="gpt-4o")

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a DeFi agent on Solana. Use A2A-Swap to trade and manage liquidity."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

agent    = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# Natural language → on-chain actions
executor.invoke({"input": "What is the current SOL/USDC price on A2A-Swap?"})
executor.invoke({"input": "Simulate swapping 1 SOL for USDC and show the fee breakdown."})
executor.invoke({"input": "Swap 0.5 SOL for USDC with at most 1% slippage."})
executor.invoke({"input": "How much fees have I earned on my LP positions?"})
executor.invoke({"input": "Claim all my fees."})
```

---

## CrewAI

All tools work in CrewAI without any wrapping — pass them directly to `Agent.tools`.

```python
from crewai import Agent, Crew, Task
from a2a_swap_langchain import get_tools, A2ASimulateTool, A2APoolInfoTool

# All-tools trader
trader = Agent(
    role="DeFi Trader",
    goal="Execute optimal swaps and manage liquidity on A2A-Swap",
    backstory="An autonomous Solana trading agent.",
    tools=get_tools(),
)

# Read-only analyst (no wallet needed for these two tools)
analyst = Agent(
    role="Market Analyst",
    goal="Monitor A2A-Swap pool conditions",
    backstory="Reads on-chain data to inform trading decisions.",
    tools=[A2ASimulateTool(), A2APoolInfoTool()],
)

task = Task(
    description="Simulate selling 0.5 SOL for USDC, then execute if price impact < 1%.",
    expected_output="Simulation result and transaction signature (or reason for skipping).",
    agent=trader,
)

Crew(agents=[trader, analyst], tasks=[task]).kickoff()
```

---

## Individual tool usage

You can instantiate and call tools directly without an agent:

```python
from a2a_swap_langchain import A2ASimulateTool, A2ASwapTool, A2APoolInfoTool

# Read-only — no wallet needed
sim = A2ASimulateTool()
result = sim.run({
    "mint_in":  "SOL",
    "mint_out": "USDC",
    "amount_in": 1_000_000_000,
})
print(result)

# Pool info
info = A2APoolInfoTool()
print(info.run({"pair": "SOL-USDC"}))

# Swap — needs keypair
swap = A2ASwapTool(keypair="~/.config/solana/id.json")
print(swap.run({
    "mint_in":          "SOL",
    "mint_out":         "USDC",
    "amount_in":        500_000_000,
    "max_slippage_bps": 50,
}))
```

---

## Custom keypair / RPC per tool

```python
from a2a_swap_langchain import get_tools

# Override env vars per-call
tools = get_tools(
    keypair="~/my-agent-key.json",
    rpc_url="https://my-private-rpc.example.com",
)
```

Or set them at instantiation:

```python
from a2a_swap_langchain import A2ASwapTool

swap = A2ASwapTool(
    keypair="~/my-agent-key.json",
    rpc_url="https://my-private-rpc.example.com",
)
```

---

## Token shortcuts

`SOL`, `USDC`, and `USDT` resolve automatically. Any other token accepts a raw base-58 mint address:

```python
# Shorthand
sim.run({"mint_in": "SOL", "mint_out": "USDC", "amount_in": 1_000_000_000})

# Full mint address
sim.run({
    "mint_in":  "So11111111111111111111111111111111111111112",
    "mint_out": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount_in": 1_000_000_000,
})
```

---

## How it works

Each tool serializes its arguments to CLI flags and runs `a2a-swap <command> --json` as a subprocess. The JSON output is parsed and returned as a string to the LLM. This design means:

- **No Solana Python library required** — all RPC calls happen inside the CLI
- **Full parity with the CLI** — any CLI flag is accessible via the tool's input schema
- **Easy to debug** — run the equivalent CLI command manually to reproduce any issue

---

## Live pools (mainnet)

| Pool | Address |
|------|---------|
| SOL/USDC (30 bps) | `BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC` |

Pools are permissionless — any agent can create a new pair.
