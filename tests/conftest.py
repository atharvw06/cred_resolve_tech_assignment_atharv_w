from __future__ import annotations
import pytest
from app.clock import SimClock, WallClock


@pytest.fixture
def sim_clock() -> SimClock:
    """Fixture providing a deterministic simulation clock."""
    return SimClock(start=1700000000.0)


@pytest.fixture
def wall_clock() -> WallClock:
    """Fixture providing a live wall clock."""
    return WallClock()
