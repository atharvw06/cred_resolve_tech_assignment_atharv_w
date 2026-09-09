from __future__ import annotations
from dataclasses import dataclass
from typing import Callable


@dataclass
class ScenarioConfig:
    name: str
    description: str
    get_answer_rate: Callable[[float], float]
    get_talk_time: Callable[[float], float]
    get_provider: Callable[[float], str]


def scenario_a() -> ScenarioConfig:
    return ScenarioConfig(
        name="A",
        description="Low answer (20%), long talk (120s) - Predictive dialer shines",
        get_answer_rate=lambda t: 0.20,
        get_talk_time=lambda t: 120.0,
        get_provider=lambda t: "A",
    )


def scenario_b() -> ScenarioConfig:
    return ScenarioConfig(
        name="B",
        description="Balanced answer (50%), medium talk (90s)",
        get_answer_rate=lambda t: 0.50,
        get_talk_time=lambda t: 90.0,
        get_provider=lambda t: "A",
    )


def scenario_c() -> ScenarioConfig:
    return ScenarioConfig(
        name="C",
        description="High answer (70%), long talk (180s) - Safety stress test",
        get_answer_rate=lambda t: 0.70,
        get_talk_time=lambda t: 180.0,
        get_provider=lambda t: "A",
    )


def scenario_d() -> ScenarioConfig:
    def answer_rate_d(t: float) -> float:
        # 0 - 180s: 20%
        # 180s - 360s: 70%
        # 360s+: sudden drop to 10%
        if t < 180.0:
            return 0.20
        elif t < 360.0:
            return 0.70
        else:
            return 0.10

    def talk_time_d(t: float) -> float:
        if t < 180.0:
            return 60.0
        elif t < 360.0:
            return 120.0
        else:
            return 180.0

    def provider_d(t: float) -> str:
        # At minute 5 (300s), switch to Provider B (chaos)
        return "B" if t >= 300.0 else "A"

    return ScenarioConfig(
        name="D",
        description="Drifting regime: 20% -> 70% -> 10%, Provider B at min 5, tests AIMD adaptivity",
        get_answer_rate=answer_rate_d,
        get_talk_time=talk_time_d,
        get_provider=provider_d,
    )


SCENARIOS: dict[str, Callable[[], ScenarioConfig]] = {
    "A": scenario_a,
    "B": scenario_b,
    "C": scenario_c,
    "D": scenario_d,
}


def get_scenario(name: str) -> ScenarioConfig:
    upper = name.upper()
    if upper not in SCENARIOS:
        raise ValueError(f"Unknown scenario '{name}'. Available: {list(SCENARIOS.keys())}")
    return SCENARIOS[upper]()
