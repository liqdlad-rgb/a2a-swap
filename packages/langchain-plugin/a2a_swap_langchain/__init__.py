"""
a2a-swap-langchain — LangChain and CrewAI tools for A2A-Swap on Solana.

Quick start::

    from a2a_swap_langchain import get_tools
    tools = get_tools(keypair="~/.config/solana/id.json")

See ``a2a_swap_langchain.tools`` for individual tool classes.
See ``a2a_swap_langchain.crewai`` for CrewAI-specific imports.
"""

from .tools import (
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

__version__ = "0.1.0"
