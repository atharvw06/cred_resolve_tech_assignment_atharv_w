from __future__ import annotations
import math
from hypothesis import given, settings, strategies as st
from app.safety.controller import SafetyController, clamp


@given(
    A=st.integers(min_value=0, max_value=200),
    R=st.integers(min_value=0, max_value=200),
    C=st.integers(min_value=0, max_value=200),
    p_hat=st.floats(min_value=0.05, max_value=0.98),
    sigma_hat=st.floats(min_value=0.0, max_value=0.2),
    alpha=st.floats(min_value=0.2, max_value=1.0),
    d_hat=st.floats(min_value=1.0, max_value=30.0),
    h_hat=st.floats(min_value=10.0, max_value=300.0),
)
@settings(max_examples=10000, deadline=None)
def test_safety_never_violates_binomial_bound(A, R, C, p_hat, sigma_hat, alpha, d_hat, h_hat):
    """
    Hypothesis property test: 10,000 random valid operational states.
    Assert that for every single approved n, the inequality:
      u*(R + n_approved) + z*sqrt((R + n_approved)*u*(1-u)) <= A + F + 1e-6
    is NEVER violated.
    """
    decision = SafetyController.approve_pure(
        n_proposed=10**6,
        A=A,
        R=R,
        C=C,
        p_hat=p_hat,
        sigma_hat=sigma_hat,
        alpha=alpha,
        d_hat=d_hat,
        h_hat=h_hat,
    )
    n = decision.n_approved
    u = clamp(p_hat + 2.0 * sigma_hat, 0.05, 0.98)
    z = 2.33
    lhs = u * (R + n) + z * math.sqrt((R + n) * u * (1.0 - u))
    F = C * min(1.0, d_hat / max(h_hat, 1.0))
    rhs = A + F

    # If initial ringing/initiated calls R already exceed capacity A+F,
    # the controller cannot un-dial active calls; it must approve 0 new calls.
    initial_lhs = u * R + z * math.sqrt(R * u * (1.0 - u))
    if initial_lhs > rhs:
        assert n == 0, f"Expected 0 new calls when R already exceeds capacity, got {n}"
    else:
        assert lhs <= rhs + 1e-5, (
            f"Binomial safety bound VIOLATION!\n"
            f"Approved n: {n}, LHS: {lhs}, RHS: {rhs}\n"
            f"Inputs: A={A}, R={R}, C={C}, p_hat={p_hat}, sigma={sigma_hat}, F={F}, u={u}"
        )
