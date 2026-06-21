"""Shared low-level subprocess runner.

container_service.ContainerService and mcp.modules.mcp_classes.AidaMCPService
each used to carry their own near-identical ``_run_command`` implementation, and
the two drifted apart (only one had the unbound-process guard and the output-size
cap). This module centralizes the process lifecycle, timeout handling and
per-stream output cap so those reliability concerns live in ONE place. Each
service keeps a thin ``_run_command`` wrapper that adapts the result to its own
return shape.
"""
import asyncio
from typing import Any, Dict, List

DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024  # keep at most 10 MB per stream


async def run_subprocess(command: List[str], timeout: float = 30.0,
                         max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES) -> Dict[str, Any]:
    """Run a system command with a timeout and a per-stream output cap.

    Never raises. Returns a dict with a ``status`` discriminator
    (``"ok"`` / ``"timeout"`` / ``"not_found"`` / ``"failed"``) plus
    ``success``, ``returncode``, ``stdout``, ``stderr`` and, on the error paths,
    ``raw_error``. Callers adapt these fields to their own return contract.
    """
    process = None

    async def _read_capped(stream):
        """Drain a stream fully (so the child never blocks on a full pipe) but
        only keep up to ``max_output_bytes`` in memory."""
        buf = bytearray()
        truncated = False
        while True:
            chunk = await stream.read(65536)
            if not chunk:
                break
            if len(buf) < max_output_bytes:
                buf.extend(chunk[: max_output_bytes - len(buf)])
            else:
                truncated = True
        return bytes(buf), truncated

    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        (stdout, out_truncated), (stderr, err_truncated), returncode = await asyncio.wait_for(
            asyncio.gather(
                _read_capped(process.stdout),
                _read_capped(process.stderr),
                process.wait(),
            ),
            timeout=timeout,
        )

        out = stdout.decode('utf-8', errors='replace').strip()
        err = stderr.decode('utf-8', errors='replace').strip()
        if out_truncated:
            out += "\n...(output truncated)"
        if err_truncated:
            err += "\n...(output truncated)"

        return {
            "status": "ok",
            "success": returncode == 0,
            "returncode": returncode,
            "stdout": out,
            "stderr": err,
        }

    except asyncio.TimeoutError:
        if process is not None:
            try:
                process.kill()
                await process.communicate()
            except Exception:
                pass
        return {
            "status": "timeout",
            "success": False,
            "returncode": -1,
            "stdout": "",
            "stderr": f"Command timed out after {timeout}s",
        }

    except FileNotFoundError as e:
        return {
            "status": "not_found",
            "success": False,
            "returncode": -1,
            "stdout": "",
            "stderr": f"Command not found: {command[0]}",
            "raw_error": str(e),
        }

    except Exception as e:
        return {
            "status": "failed",
            "success": False,
            "returncode": -1,
            "stdout": "",
            "stderr": f"Execution failed: {e}",
            "raw_error": str(e),
        }
