"""
Subprocess wrapper for the a2a-swap CLI binary.
Install the CLI with:  cargo install a2a-swap-cli
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any


_INSTALL_MSG = (
    "a2a-swap CLI not found in PATH. "
    "Install it with:  cargo install a2a-swap-cli\n"
    "Then ensure ~/.cargo/bin is in your PATH."
)

_DEFAULT_RPC = "https://api.mainnet-beta.solana.com"


def _find_cli() -> str:
    binary = shutil.which("a2a-swap")
    if not binary:
        raise RuntimeError(_INSTALL_MSG)
    return binary


def run(
    subcommand: str,
    *args: str,
    keypair: str | None = None,
    rpc_url: str | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    """
    Run ``a2a-swap <global_opts> <subcommand> [args...] --json``
    and return the parsed JSON response.

    Global opts (keypair / rpc_url) are resolved in priority order:
      1. Explicit keyword argument
      2. Environment variable (A2A_KEYPAIR / A2A_RPC_URL)
      3. Default RPC (mainnet-beta); keypair has no default and is
         omitted for read-only commands.
    """
    cli = _find_cli()

    resolved_rpc = rpc_url or os.environ.get("A2A_RPC_URL", _DEFAULT_RPC)
    resolved_kp = keypair or os.environ.get("A2A_KEYPAIR")

    cmd: list[str] = [cli, "--rpc-url", resolved_rpc]
    if resolved_kp:
        cmd += ["--keypair", resolved_kp]

    cmd.append(subcommand)
    cmd.extend(args)
    cmd.append("--json")

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"a2a-swap {subcommand} failed:\n{result.stderr.strip() or result.stdout.strip()}"
        )

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"a2a-swap returned non-JSON output:\n{result.stdout[:500]}"
        ) from exc
