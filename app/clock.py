from __future__ import annotations
from datetime import datetime, timezone
from typing import Protocol


class Clock(Protocol):
    """Clock protocol for deterministic time injection."""

    def now(self) -> datetime:
        """Return current datetime with UTC timezone."""
        ...

    def now_ts(self) -> float:
        """Return current timestamp in seconds."""
        ...


class WallClock:
    """Production wall clock using system UTC time."""

    def now(self) -> datetime:
        return datetime.now(timezone.utc)

    def now_ts(self) -> float:
        return datetime.now(timezone.utc).timestamp()


class SimClock:
    """Simulation clock for deterministic testing and simulations."""

    def __init__(self, start: float = 1700000000.0):
        self._t = float(start)

    def now(self) -> datetime:
        return datetime.fromtimestamp(self._t, tz=timezone.utc)

    def now_ts(self) -> float:
        return self._t

    def advance(self, dt: float) -> None:
        """Advance the simulation time by dt seconds."""
        self._t += float(dt)

    def sleep(self, dt: float, async_ctx: object = None) -> None:
        """Advance time instead of sleeping."""
        self._t += float(dt)
