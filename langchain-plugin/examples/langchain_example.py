"""
A2A-Swap × LangChain — example agent

Prerequisites:
    pip install a2a-swap-langchain langchain-openai
    cargo install a2a-swap-cli

Environment:
    OPENAI_API_KEY=sk-...
    A2A_KEYPAIR=~/.config/solana/id.json
    A2A_RPC_URL=https://api.mainnet-beta.solana.com   # optional, mainnet is default
"""

import os
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate

from a2a_swap_langchain import get_tools

# ── Configure ─────────────────────────────────────────────────────────────────

# Tools read A2A_KEYPAIR / A2A_RPC_URL from env automatically.
# You can also pass them explicitly:
#   tools = get_tools(keypair="/path/to/keypair.json", rpc_url="https://...")
tools = get_tools()

llm = ChatOpenAI(model="gpt-4o", temperature=0)

prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are an autonomous DeFi agent operating on Solana via A2A-Swap. "
     "You can simulate swaps, execute trades, provide liquidity, check pool state, "
     "and monitor your accrued fees. Always simulate before executing a real swap "
     "to check price impact. Never execute a swap with more than 2% price impact "
     "without confirming first."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# ── Example tasks ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # 1. Read-only: check pool state
    result = executor.invoke({
        "input": "What is the current SOL/USDC spot price and pool depth on A2A-Swap?"
    })
    print(result["output"])

    # 2. Simulate before trading
    result = executor.invoke({
        "input": (
            "Simulate swapping 0.5 SOL (500000000 lamports) for USDC. "
            "Show me the fee breakdown and estimated output."
        )
    })
    print(result["output"])

    # 3. Autonomous trading decision
    result = executor.invoke({
        "input": (
            "Check the SOL/USDC pool. If the price impact of selling 1 SOL "
            "is under 1%, execute the swap. Otherwise just report the simulation."
        )
    })
    print(result["output"])

    # 4. LP management
    result = executor.invoke({
        "input": "How much trading fees have I earned across all my LP positions?"
    })
    print(result["output"])
