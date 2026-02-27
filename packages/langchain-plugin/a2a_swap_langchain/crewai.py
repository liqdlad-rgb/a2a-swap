"""
CrewAI-native tool wrappers for A2A-Swap.

CrewAI's BaseTool API mirrors LangChain's, so these are thin re-exports
with CrewAI-specific imports. If you are already using LangChain, you can
use the tools from ``a2a_swap_langchain.tools`` directly — CrewAI accepts
LangChain tools without any wrapping.

Usage::

    from a2a_swap_langchain.crewai import get_tools
    from crewai import Agent

    agent = Agent(
        role="DeFi Trader",
        goal="Maximize yield by swapping and providing liquidity on Solana",
        backstory="An autonomous agent that manages a Solana portfolio.",
        tools=get_tools(keypair="~/.config/solana/id.json"),
        verbose=True,
    )
"""
from __future__ import annotations

try:
    from crewai.tools import BaseTool as _CrewBaseTool  # noqa: F401
    _CREWAI_AVAILABLE = True
except ImportError:
    _CREWAI_AVAILABLE = False

from .tools import (  # noqa: F401  (re-export everything)
    A2ASimulateTool,
    A2ASwapTool,
    A2AProvideLiquidityTool,
    A2APoolInfoTool,
    A2AMyFeesTool,
    get_tools,
)

__all__ = [
    "A2ASimulateTool",
    "A2ASwapTool",
    "A2AProvideLiquidityTool",
    "A2APoolInfoTool",
    "A2AMyFeesTool",
    "get_tools",
]
