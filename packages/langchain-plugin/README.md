# a2a-swap-langchain

LangChain and CrewAI tools for **A2A-Swap** — the constant-product AMM built for autonomous AI agents on Solana.

## Installation

```bash
pip install a2a-swap-langchain          # LangChain only
pip install "a2a-swap-langchain[crewai]" # + CrewAI support
```

Also install the CLI (required — tools call it as a subprocess):

```bash
cargo install a2a-swap-cli
```

## Configuration

Set environment variables (or pass them to `get_tools()`):

```bash
export A2A_KEYPAIR=~/.config/solana/id.json
export A2A_RPC_URL=https://api.mainnet-beta.solana.com  # optional, mainnet is default
```

## LangChain

```python
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from a2a_swap_langchain import get_tools

tools = get_tools()  # reads A2A_KEYPAIR / A2A_RPC_URL from env
llm   = ChatOpenAI(model="gpt-4o")

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a DeFi agent on Solana. Use A2A-Swap to trade and manage liquidity."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

agent    = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

executor.invoke({"input": "What is the current SOL/USDC price on A2A-Swap?"})
executor.invoke({"input": "Simulate swapping 1 SOL for USDC and show the fee breakdown."})
executor.invoke({"input": "How much fees have I earned on my LP positions?"})
```

## CrewAI

```python
from crewai import Agent, Crew, Task
from a2a_swap_langchain import get_tools, A2ASimulateTool, A2APoolInfoTool

# All tools work in CrewAI without any wrapping
trader = Agent(
    role="DeFi Trader",
    goal="Execute optimal swaps on A2A-Swap",
    backstory="Autonomous Solana trading agent.",
    tools=get_tools(),
)

task = Task(
    description="Simulate selling 0.5 SOL for USDC, then execute if price impact < 1%.",
    expected_output="Simulation result and optional transaction signature.",
    agent=trader,
)

Crew(agents=[trader], tasks=[task]).kickoff()
```

## Available Tools

| Tool | Name | Wallet needed? | Description |
|------|------|---------------|-------------|
| `A2ASimulateTool` | `a2a_simulate_swap` | No | Preview a swap: fees, estimated out, price impact |
| `A2ASwapTool` | `a2a_swap` | Yes | Execute an atomic token swap |
| `A2AProvideLiquidityTool` | `a2a_provide_liquidity` | Yes | Deposit tokens, earn LP shares and fees |
| `A2APoolInfoTool` | `a2a_pool_info` | No | Read pool reserves, spot price, fee rate |
| `A2AMyFeesTool` | `a2a_my_fees` | Yes (for identity) | Check accrued trading fees across all positions |

## Individual tool usage

```python
from a2a_swap_langchain import A2ASimulateTool, A2ASwapTool

# Read-only — no wallet
sim = A2ASimulateTool()
print(sim.run({"mint_in": "SOL", "mint_out": "USDC", "amount_in": 1_000_000_000}))

# Write — needs keypair
swap = A2ASwapTool(keypair="~/.config/solana/id.json")
print(swap.run({"mint_in": "SOL", "mint_out": "USDC", "amount_in": 500_000_000}))
```

## Token shortcuts

Use `SOL`, `USDC`, or `USDT` as shorthand, or any base-58 mint address:

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

## Live pools (mainnet)

| Pool | Address |
|------|---------|
| SOL/USDC (30 bps) | `BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC` |

Pools are permissionless — any agent can create a new pair via `a2a-swap create-pool`.

## Links

- **Program:** `8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq` (mainnet-beta)
- **CLI:** `cargo install a2a-swap-cli`
- **TypeScript SDK:** `npm install @liqdlad/a2a-swap-sdk`
- **Rust SDK:** `cargo add a2a-swap-sdk`
- **ElizaOS plugin:** `elizaos plugins add plugin-a2a-swap`
- **GitHub:** [liqdlad-rgb/a2a-swap](https://github.com/liqdlad-rgb/a2a-swap)

## License

MIT
