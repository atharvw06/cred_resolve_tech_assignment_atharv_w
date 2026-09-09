from __future__ import annotations
import sys
from app.domain.fsm import (
    agent_transition,
    call_transition,
    AGENT_TRANSITIONS,
    CALL_TRANSITIONS,
    TERMINAL_CALL_STATES,
)


def test_no_db_imports_in_fsm():
    """Verify fsm module is pure Python with zero database imports."""
    fsm_module = sys.modules.get("app.domain.fsm")
    assert fsm_module is not None
    # Check imported globals
    for name, val in vars(fsm_module).items():
        assert "sqlalchemy" not in str(type(val)).lower()
        assert "asyncpg" not in str(type(val)).lower()
        assert "psycopg" not in str(type(val)).lower()


def test_agent_legal_transitions():
    """All legal agent transitions succeed."""
    for (state, event), next_state in AGENT_TRANSITIONS.items():
        res_state, applied = agent_transition(state, event)
        assert applied is True, f"Failed for ({state}, {event})"
        assert res_state == next_state


def test_agent_illegal_transitions():
    """Illegal agent transitions return (current, False) without raising."""
    res_state, applied = agent_transition("OFFLINE", "dial")
    assert applied is False
    assert res_state == "OFFLINE"

    res_state, applied = agent_transition("CONNECTED", "reserve")
    assert applied is False
    assert res_state == "CONNECTED"


def test_call_legal_transitions():
    """All legal call transitions succeed."""
    for (state, event), next_state in CALL_TRANSITIONS.items():
        res_state, applied = call_transition(state, event)
        assert applied is True, f"Failed for ({state}, {event})"
        assert res_state == next_state


def test_call_illegal_transitions():
    """Illegal call transitions return (current, False) without raising."""
    res_state, applied = call_transition("QUEUED", "answer")
    assert applied is False
    assert res_state == "QUEUED"

    res_state, applied = call_transition("RINGING", "wrap_up")
    assert applied is False
    assert res_state == "RINGING"


def test_terminal_call_states_are_idempotent():
    """Duplicate events on terminal call states are no-ops."""
    for term_state in TERMINAL_CALL_STATES:
        res_state, applied = call_transition(term_state, "complete")
        assert applied is False
        assert res_state == term_state

        res_state, applied = call_transition(term_state, "answer")
        assert applied is False
        assert res_state == term_state


def test_convergence_completed_from_any_active_state():
    """COMPLETED is accepted from any active state for crash recovery."""
    active_states = ["QUEUED", "RESERVED", "INITIATED", "RINGING", "ANSWERED", "CONNECTED"]
    for state in active_states:
        res_state, applied = call_transition(state, "complete")
        assert applied is True
        assert res_state == "COMPLETED"


def test_duplicate_answered_sequence():
    """Sequence ANSWERED, ANSWERED, ANSWERED, COMPLETED -> final state COMPLETED."""
    state = "RINGING"
    # First answer
    state, applied1 = call_transition(state, "answer")
    assert applied1 is True
    assert state == "ANSWERED"

    # Duplicate answer 1
    state, applied2 = call_transition(state, "answer")
    assert applied2 is False
    assert state == "ANSWERED"

    # Duplicate answer 2
    state, applied3 = call_transition(state, "answer")
    assert applied3 is False
    assert state == "ANSWERED"

    # Completed arrives
    state, applied4 = call_transition(state, "complete")
    assert applied4 is True
    assert state == "COMPLETED"


def test_out_of_order_completed_answered_ringing():
    """Sequence COMPLETED, ANSWERED, RINGING -> final state COMPLETED (late events dropped)."""
    state = "INITIATED"
    # Late complete arrives first
    state, applied1 = call_transition(state, "complete")
    assert applied1 is True
    assert state == "COMPLETED"

    # Late answer arrives
    state, applied2 = call_transition(state, "answer")
    assert applied2 is False
    assert state == "COMPLETED"

    # Late ringing arrives
    state, applied3 = call_transition(state, "ringing")
    assert applied3 is False
    assert state == "COMPLETED"
