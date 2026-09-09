from __future__ import annotations
import random


class SeededRNG:
    """Deterministic random number generator for simulation reproducibility."""

    def __init__(self, seed: int):
        self._seed = seed
        self._r = random.Random(seed)

    def should_answer(self, answer_rate: float) -> bool:
        """Return True if borrower answers based on given probability."""
        return self._r.random() < answer_rate

    def call_duration(self, mean_secs: float) -> float:
        """Sample call duration using exponential distribution bounded at min 10s."""
        dur = self._r.expovariate(1.0 / max(10.0, mean_secs))
        return max(10.0, dur)

    def setup_latency(self, mean_secs: float = 8.0) -> float:
        """Sample call originate-to-answer setup time (e.g. 5-12s)."""
        return max(3.0, self._r.gauss(mean_secs, 1.5))
