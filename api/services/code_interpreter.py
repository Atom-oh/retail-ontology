"""
AgentCore Code Interpreter wrapper (Phase 4).

Spec § 4.3 Scenario C wow-moment: real pandas + matplotlib chart generation
inside an isolated Firecracker microVM, not a hand-coded mock. Each request
spins up a fresh sandbox, runs the chart-generation script, captures the
PNG bytes, returns them. Sessions auto-stop after the function returns.

API surface (verified via boto3 service model on `bedrock-agentcore`):
  - StartCodeInterpreterSession  → returns sessionId
  - InvokeCodeInterpreter        → name='executeCode', returns EventStream
  - StopCodeInterpreterSession   → terminates the microVM
"""
from __future__ import annotations

import base64
import json
import logging
import textwrap
from typing import Any, Dict, Optional

from api.aws_clients import bedrock_agentcore

logger = logging.getLogger("ontology.code_interpreter")

# `aws.codeinterpreter.v1` is the default system-managed sandbox.
_DEFAULT_INTERPRETER = "aws.codeinterpreter.v1"


class CodeInterpreterError(RuntimeError):
    """Raised when the sandbox cold-start, code execution, or PNG capture fails."""


def render_chart_png(
    *, py_code: str, data: Optional[Dict[str, Any]] = None,
    timeout_seconds: int = 60,
) -> Optional[str]:
    """Run `py_code` in an AgentCore Code Interpreter sandbox and return the
    first PNG output as base64. Caller passes `data` as a JSON dict — it's
    injected into the sandbox as a `data` global before user code runs.

    Returns base64 PNG (no `data:image/png;base64,` prefix) or None if no
    image was produced. Logs warnings on transient failures so demo runs
    don't 500 — the insights endpoint falls back to its bar chart UI.
    """
    client = bedrock_agentcore()
    session_id: Optional[str] = None
    try:
        start = client.start_code_interpreter_session(
            codeInterpreterIdentifier=_DEFAULT_INTERPRETER,
            sessionTimeoutSeconds=timeout_seconds,
        )
        session_id = start.get("sessionId")
        if not session_id:
            logger.warning("start_code_interpreter_session returned no sessionId: %s", start)
            return None

        # Bootstrap shim: expose `data` global to user script via JSON.
        bootstrap = textwrap.dedent(f"""
            import json, base64, io, os
            data = json.loads({json.dumps(json.dumps(data or {}))})
        """).strip()

        full_code = bootstrap + "\n" + py_code

        # InvokeCodeInterpreter with name='executeCode' and language='python'.
        # Response is an event-stream — `stream` field yields ResponseStream events.
        resp = client.invoke_code_interpreter(
            codeInterpreterIdentifier=_DEFAULT_INTERPRETER,
            sessionId=session_id,
            name="executeCode",
            arguments={"language": "python", "code": full_code},
        )

        png_b64 = _consume_stream(resp.get("stream"))
        return png_b64
    except Exception as e:  # noqa: BLE001
        logger.warning("code_interpreter render failed: %s", e, exc_info=True)
        return None
    finally:
        if session_id:
            try:
                client.stop_code_interpreter_session(
                    codeInterpreterIdentifier=_DEFAULT_INTERPRETER,
                    sessionId=session_id,
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("stop_code_interpreter_session failed: %s", e)


_PNG_START = "__CHART_PNG_B64_START__"
_PNG_END = "__CHART_PNG_B64_END__"


def _consume_stream(stream: Any) -> Optional[str]:
    """Iterate the EventStream, accumulate text content + structured stdout,
    and extract the base64 PNG between sentinel markers (`__CHART_PNG_B64_*__`).

    Why marker-based extraction rather than `result.content[].data`:
    matplotlib `savefig` to a BytesIO doesn't trigger inline-image capture
    in the sandbox. Encoding to base64 in Python and printing with markers
    is the most reliable single-roundtrip approach across SDK versions.
    """
    if stream is None:
        return None
    text_buf: list[str] = []
    stderr_buf: list[str] = []
    for event in stream:
        if not isinstance(event, dict):
            continue
        # Surface server-side exceptions as warnings (helps demo debugging).
        for ex_key in (
            "validationException", "accessDeniedException", "conflictException",
            "internalServerException", "throttlingException",
            "serviceQuotaExceededException", "resourceNotFoundException",
        ):
            if ex_key in event:
                logger.warning("Code Interpreter %s: %s", ex_key, event[ex_key])
                return None
        result = event.get("result")
        if not isinstance(result, dict):
            continue
        # Aggregate text content blocks (Code Interpreter emits stdout there).
        for block in result.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "text":
                t = block.get("text") or ""
                if t:
                    text_buf.append(t)
            # Also handle direct PNG blobs in case future SDK versions populate them.
            if isinstance(block, dict):
                mime = block.get("mimeType") or ""
                if mime.endswith("/png"):
                    blob = block.get("data") or block.get("blob")
                    if isinstance(blob, (bytes, bytearray)):
                        return base64.b64encode(bytes(blob)).decode("ascii")
                    if isinstance(blob, str):
                        return blob
        sc = result.get("structuredContent") or {}
        if sc.get("stdout"):
            text_buf.append(sc["stdout"])
        if sc.get("stderr"):
            stderr_buf.append(sc["stderr"])

    full = "".join(text_buf)
    start = full.find(_PNG_START)
    end = full.find(_PNG_END, start + len(_PNG_START)) if start >= 0 else -1
    if start >= 0 and end > start:
        b64 = full[start + len(_PNG_START):end].strip()
        if b64.startswith("iVBORw"):  # PNG header in base64
            return b64
        logger.warning("Captured marker block but missing PNG signature: %r", b64[:40])
    if stderr_buf:
        logger.info("Code Interpreter stderr: %s", "".join(stderr_buf)[:500])
    if text_buf and start < 0:
        logger.info("Code Interpreter ran but no PNG marker. stdout: %s", full[:500])
    return None
