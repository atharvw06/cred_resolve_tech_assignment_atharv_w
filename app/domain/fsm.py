from __future__ import annotations
"""Pure-Python table-driven state machines. No DB imports."""

AGENT_TRANSITIONS: dict[tuple[str, str], str] = {
    ("OFFLINE", "login"): "AVAILABLE",
    ("AVAILABLE", "reserve"): "RESERVED",  # via SKIP LOCKED SQL
    ("RESERVED", "dial"): "DIALING",
    ("DIALING", "connect"): "CONNECTED",
    ("CONNECTED", "wrap_up"): "WRAP_UP",
    ("WRAP_UP", "ready"): "AVAILABLE",
    ("AVAILABLE", "pause"): "PAUSED",
    ("PAUSED", "resume"): "AVAILABLE",
    ("RESERVED", "release"): "AVAILABLE",  # explicit release / cancel
    ("RESERVED", "expire"): "AVAILABLE",  # TTL expiry (reaper)
    ("DIALING", "call_failed"): "AVAILABLE",  # provider returned FAILED
    # Predictive atomic attach: AVAILABLE -> CONNECTED in one UPDATE
    # (used when a predictive ANSWERED arrives and an agent is free)
    ("AVAILABLE", "atomic_attach"): "CONNECTED",
}

CALL_TRANSITIONS: dict[tuple[str, str], str] = {
    # Progressive: bind agent first
    ("QUEUED", "reserve"): "RESERVED",
    ("RESERVED", "initiate"): "INITIATED",
    # Predictive: initiate unbound (no agent yet)
    ("QUEUED", "initiate"): "INITIATED",
    ("INITIATED", "ringing"): "RINGING",
    ("INITIATED", "fail"): "FAILED",
    ("RINGING", "answer"): "ANSWERED",
    ("RINGING", "fail"): "FAILED",
    ("INITIATED", "cancel"): "CANCELLED",
    ("RINGING", "cancel"): "CANCELLED",
    ("ANSWERED", "connect"): "CONNECTED",  # agent bound (predictive path)
    ("ANSWERED", "abandon"): "ABANDONED",  # no agent — COMPLIANCE EVENT, feeds AIMD
    ("CONNECTED", "complete"): "COMPLETED",
    # Ambiguous timeout and provider reconciliation path
    ("INITIATED", "timeout"): "UNKNOWN",
    ("RINGING", "timeout"): "UNKNOWN",
    ("UNKNOWN", "answer"): "ANSWERED",
    ("UNKNOWN", "fail"): "FAILED",
    ("UNKNOWN", "complete"): "COMPLETED",
}

TERMINAL_CALL_STATES: frozenset[str] = frozenset({"COMPLETED", "FAILED", "CANCELLED", "ABANDONED"})


def transition(transitions: dict[tuple[str, str], str], current: str, event: str) -> tuple[str, bool]:
    """
    Pure function. Returns (new_state, applied).
    Never raises. All illegal/duplicate/late events are log-and-ignored.
    """
    # Already terminal: idempotent no-op (duplicate COMPLETED, late ANSWERED, etc.)
    if current in TERMINAL_CALL_STATES:
        return current, False
    # Convergence rule: COMPLETED is accepted from any active state.
    if event in ("complete", "completed"):
        return "COMPLETED", True
    key = (current, event)
    if key in transitions:
        return transitions[key], True
    # Illegal transition — log-and-ignore (the caller logs).
    return current, False


def agent_transition(current: str, event: str) -> tuple[str, bool]:
    """Transition agent lifecycle state. Heartbeat-stale to OFFLINE handled by reaper."""
    if event == "offline":
        return "OFFLINE", True
    return transition(AGENT_TRANSITIONS, current, event)


def call_transition(current: str, event: str) -> tuple[str, bool]:
    """Transition call lifecycle state with convergence guarantees."""
    return transition(CALL_TRANSITIONS, current, event)
