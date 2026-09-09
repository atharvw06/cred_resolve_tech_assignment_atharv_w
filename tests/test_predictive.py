from __future__ import annotations
import math
import pytest
from app.pacing.predictive import PredictivePacingEngine
from app.safety.controller import SafetyController


def test_predictive_proposal_formula():
    """Verify proposal equation: floor(alpha * (A + F) / p_hat)."""
    # A=10, F=2.0, p_hat=0.3, alpha=0.5 -> floor(0.5 * 12.0 / 0.3) = 20
    prop = PredictivePacingEngine.calculate_proposal(A=10, F=2.0, p_hat=0.3, alpha=0.5)
    assert prop == 20

    # Cold start floor: p_hat=0.01 clamped to 0.05
    prop_cold = PredictivePacingEngine.calculate_proposal(A=5, F=0.0, p_hat=0.01, alpha=0.5)
    # floor(0.5 * 5 / 0.05) = 50
    assert prop_cold == 50


def test_aimd_halving_on_abandonment():
    """AIMD halves alpha on ABANDONED down to 0.2 floor."""
    alpha = 1.0
    alpha = PredictivePacingEngine.on_abandoned_event(alpha)
    assert alpha == 0.5

    alpha = PredictivePacingEngine.on_abandoned_event(alpha)
    assert alpha == 0.25

    # Should clamp at 0.2 floor
    alpha = PredictivePacingEngine.on_abandoned_event(alpha)
    assert alpha == 0.2


def test_aimd_slow_ramp_on_clean_intervals():
    """AIMD ramps alpha by +0.05 per clean interval up to 1.0 ceiling."""
    alpha = 0.8
    alpha = PredictivePacingEngine.on_clean_interval(alpha)
    assert pytest.approx(alpha, 0.001) == 0.85

    for _ in range(5):
        alpha = PredictivePacingEngine.on_clean_interval(alpha)
    # Should clamp at 1.0 ceiling
    assert alpha == 1.0


def test_safety_controller_clamps_excessive_proposal():
    """Safety Controller clamps proposal if it exceeds the binomial bound."""
    # Propose 100 dials with only A=5 agents free, p_hat=0.5, sigma=0.05
    approval = SafetyController.approve_pure(
        n_proposed=100,
        A=5,
        R=0,
        C=0,
        p_hat=0.5,
        sigma_hat=0.05,
        alpha=1.0,
        d_hat=8.0,
        h_hat=120.0,
    )
    assert approval.n_approved < 100
    assert "binomial_safety_bound" in approval.clamp_reasons


def test_safety_controller_hard_caps():
    """Test circuit OPEN hard cap and progressive fallback on high abandonment rate."""
    # Circuit OPEN -> 0 calls approved
    app_open = SafetyController.approve_pure(
        n_proposed=20,
        A=10,
        R=0,
        C=0,
        p_hat=0.3,
        sigma_hat=0.05,
        alpha=0.8,
        d_hat=8.0,
        h_hat=120.0,
        circuit_state="OPEN",
    )
    assert app_open.n_approved == 0
    assert "circuit_open" in app_open.clamp_reasons

    # High abandonment (> 3%) -> caps to A (progressive fallback)
    app_high_aban = SafetyController.approve_pure(
        n_proposed=50,
        A=10,
        R=0,
        C=0,
        p_hat=0.3,
        sigma_hat=0.05,
        alpha=0.8,
        d_hat=8.0,
        h_hat=120.0,
        abandonment_rate=0.05,
    )
    assert app_high_aban.n_approved <= 10
    assert "abandonment_cooldown_3pct" in app_high_aban.clamp_reasons
    assert app_high_aban.mode_used == "PROGRESSIVE"
