from __future__ import annotations
import argparse
import math
import os
import sys
from collections import deque
from typing import Any
from app.clock import SimClock
from app.pacing.predictive import PredictivePacingEngine, update_ewma
from app.safety.controller import SafetyController
from app.sim.reports import write_csv_report, write_json_report
from app.sim.rng import SeededRNG
from app.sim.scenarios import get_scenario


class SimAgent:
    def __init__(self, agent_id: int):
        self.id = agent_id
        self.status = "AVAILABLE"  # AVAILABLE, CONNECTED, WRAP_UP
        self.free_at = 0.0


class SimCall:
    def __init__(self, call_id: int, dial_at: float, answer_at: float, will_answer: bool, bound_agent_id: int | None = None):
        self.id = call_id
        self.dial_at = dial_at
        self.answer_at = answer_at
        self.will_answer = will_answer
        self.bound_agent_id = bound_agent_id
        self.state = "INITIATED"


def run_simulation(
    scenario_name: str = "A",
    seed: int = 42,
    duration: int = 600,
    num_agents: int = 50,
    mode: str = "PREDICTIVE",
    reports_dir: str = "reports",
) -> dict[str, Any]:
    scenario = get_scenario(scenario_name)
    clock = SimClock(start=0.0)
    rng = SeededRNG(seed)

    agents = [SimAgent(i) for i in range(num_agents)]
    in_flight_calls: list[SimCall] = []

    # Estimators & state
    p_hat = 0.3
    d_hat = 8.0
    h_hat = 120.0
    sigma_hat = 0.1
    alpha = 0.5
    last_abandoned_t = -999.0
    last_clean_check_t = 0.0

    call_seq = 0
    total_initiated = 0
    total_answered = 0
    total_connected = 0
    total_completed = 0
    total_abandoned = 0
    total_failed = 0

    clamp_histogram: dict[str, int] = {}
    recent_calls_window: deque[bool] = deque(maxlen=100)  # True if abandoned, False otherwise
    tick_records: list[dict[str, Any]] = []
    decisions_trace: list[dict[str, Any]] = []

    for tick in range(duration):
        t = clock.now_ts()
        curr_answer_rate = scenario.get_answer_rate(t)
        curr_talk_time = scenario.get_talk_time(t)
        curr_provider = scenario.get_provider(t)

        # 1. Update agents finishing calls
        for a in agents:
            if a.status == "CONNECTED" and a.free_at <= t:
                a.status = "WRAP_UP"
                a.free_at = t + 5.0  # 5s wrap up
                total_completed += 1
            elif a.status == "WRAP_UP" and a.free_at <= t:
                a.status = "AVAILABLE"

        # 2. Update in-flight calls resolving at this tick
        resolved_calls: list[SimCall] = []
        for c in in_flight_calls:
            if c.answer_at <= t:
                resolved_calls.append(c)
                if c.will_answer:
                    total_answered += 1
                    # Update EWMA p_hat (positive)
                    p_hat = update_ewma(p_hat, 1.0, 0.3)
                    d_hat = update_ewma(d_hat, c.answer_at - c.dial_at, 0.3)

                    if mode == "PROGRESSIVE":
                        # Progressive: agent was bound at dial
                        total_connected += 1
                        recent_calls_window.append(False)
                        if c.bound_agent_id is not None:
                            ag = agents[c.bound_agent_id]
                            ag.status = "CONNECTED"
                            ag.free_at = t + rng.call_duration(curr_talk_time)
                    else:
                        # Predictive: attempt atomic attach
                        free_agents = [ag for ag in agents if ag.status == "AVAILABLE"]
                        if free_agents:
                            ag = free_agents[0]
                            ag.status = "CONNECTED"
                            ag.free_at = t + rng.call_duration(curr_talk_time)
                            total_connected += 1
                            recent_calls_window.append(False)
                        else:
                            # No agent available -> ABANDONED (compliance violation)
                            total_abandoned += 1
                            recent_calls_window.append(True)
                            last_abandoned_t = t
                            alpha = PredictivePacingEngine.on_abandoned_event(alpha)
                else:
                    # Unanswered / failed
                    total_failed += 1
                    p_hat = update_ewma(p_hat, 0.0, 0.3)
                    if mode == "PROGRESSIVE" and c.bound_agent_id is not None:
                        # Release bound agent
                        agents[c.bound_agent_id].status = "AVAILABLE"

        for rc in resolved_calls:
            in_flight_calls.remove(rc)

        # 3. AIMD clean interval ramp: every 30s with no abandonment
        if (t - last_clean_check_t) >= 30.0:
            if (t - last_abandoned_t) >= 30.0:
                alpha = PredictivePacingEngine.on_clean_interval(alpha)
            last_clean_check_t = t

        # 4. Count current states
        A = sum(1 for a in agents if a.status == "AVAILABLE")
        R = len(in_flight_calls)
        C = sum(1 for a in agents if a.status == "CONNECTED")
        F = C * min(1.0, d_hat / max(h_hat, 1.0))

        # 5. Pacing proposal and safety approval
        rolling_aban_rate = sum(1 for x in recent_calls_window if x) / max(1, len(recent_calls_window))
        if mode == "PROGRESSIVE":
            n_proposed = A
            n_approved = min(n_proposed, A)
            clamp_reasons = []
        else:
            n_proposed = PredictivePacingEngine.calculate_proposal(A=A, F=F, p_hat=p_hat, alpha=alpha)
            circuit_state = "OPEN" if (curr_provider == "B" and t >= 450.0 and (t % 60 < 15)) else "CLOSED"
            approval = SafetyController.approve_pure(
                n_proposed=n_proposed,
                A=A,
                R=R,
                C=C,
                p_hat=p_hat,
                sigma_hat=sigma_hat,
                alpha=alpha,
                d_hat=d_hat,
                h_hat=h_hat,
                circuit_state=circuit_state,
                abandonment_rate=rolling_aban_rate,
            )
            n_approved = approval.n_approved
            clamp_reasons = approval.clamp_reasons

        for r in clamp_reasons:
            clamp_histogram[r] = clamp_histogram.get(r, 0) + 1

        # 6. Originate approved calls
        for _ in range(n_approved):
            bound_id = None
            if mode == "PROGRESSIVE":
                free_agents = [ag for ag in agents if ag.status == "AVAILABLE"]
                if not free_agents:
                    break
                ag = free_agents[0]
                ag.status = "CONNECTED"  # Reserved/dialing
                bound_id = ag.id

            call_seq += 1
            total_initiated += 1
            will_ans = rng.should_answer(curr_answer_rate)
            setup_time = rng.setup_latency(d_hat)
            new_call = SimCall(
                call_id=call_seq,
                dial_at=t,
                answer_at=t + setup_time,
                will_answer=will_ans,
                bound_agent_id=bound_id,
            )
            in_flight_calls.append(new_call)

        utilization = C / max(1, num_agents)

        record = {
            "tick_id": tick + 1,
            "ts": t,
            "A": A,
            "R": R,
            "C": C,
            "p_hat": round(p_hat, 4),
            "n_proposed": n_proposed,
            "n_approved": n_approved,
            "clamp_reasons": clamp_reasons,
            "utilization": round(utilization, 4),
            "abandonment_rate": round(rolling_aban_rate, 4),
        }
        tick_records.append(record)
        if tick < 50 or tick % 10 == 0:
            decisions_trace.append(record)

        clock.advance(1.0)

    avg_utilization = sum(r["utilization"] for r in tick_records) / max(1, len(tick_records))
    final_aban_rate = sum(1 for x in recent_calls_window if x) / max(1, len(recent_calls_window))

    summary = {
        "scenario": scenario_name,
        "mode": mode,
        "seed": seed,
        "duration_seconds": duration,
        "num_agents": num_agents,
        "total_calls_initiated": total_initiated,
        "total_calls_answered": total_answered,
        "total_calls_connected": total_connected,
        "total_calls_completed": total_completed,
        "total_calls_abandoned": total_abandoned,
        "total_calls_failed": total_failed,
        "average_utilization": round(avg_utilization, 4),
        "final_abandonment_rate": round(final_aban_rate, 4),
        "final_p_hat": round(p_hat, 4),
        "final_alpha": round(alpha, 4),
        "clamp_reasons_histogram": clamp_histogram,
        "decisions_trace": decisions_trace,
    }

    # Write JSON and CSV reports
    json_path = os.path.join(reports_dir, f"scenario_{scenario_name}_seed{seed}.json")
    csv_path = os.path.join(reports_dir, f"scenario_{scenario_name}_seed{seed}.csv")
    write_json_report(json_path, summary)
    write_csv_report(csv_path, tick_records)

    return summary


def main():
    parser = argparse.ArgumentParser(description="SmartDialer Simulation Runner")
    parser.add_argument("--scenario", choices=["A", "B", "C", "D"], default="A", help="Scenario name")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    parser.add_argument("--duration", type=int, default=600, help="Duration in seconds (ticks)")
    parser.add_argument("--agents", type=int, default=50, help="Number of simulated agents")
    parser.add_argument("--mode", choices=["PREDICTIVE", "PROGRESSIVE"], default="PREDICTIVE", help="Dialing mode")
    parser.add_argument("--reports-dir", default="reports", help="Reports destination folder")

    args = parser.parse_args()
    summary = run_simulation(
        scenario_name=args.scenario,
        seed=args.seed,
        duration=args.duration,
        num_agents=args.agents,
        mode=args.mode,
        reports_dir=args.reports_dir,
    )

    print("==========================================================")
    print(f"SIMULATION RUN COMPLETE: Scenario {args.scenario} ({args.mode})")
    print(f"Seed: {args.seed} | Agents: {args.agents} | Duration: {args.duration}s")
    print(f"Avg Agent Utilization: {summary['average_utilization'] * 100:.2f}%")
    print(f"Total Connects: {summary['total_calls_connected']}")
    print(f"Total Abandoned: {summary['total_calls_abandoned']}")
    print(f"Final Abandonment Rate: {summary['final_abandonment_rate'] * 100:.2f}%")
    print(f"Reports: reports/scenario_{args.scenario}_seed{args.seed}.{{json,csv}}")
    print("==========================================================")


if __name__ == "__main__":
    main()
