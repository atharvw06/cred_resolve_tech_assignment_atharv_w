from __future__ import annotations
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(Text, nullable=False)
    mode = Column(String(20), nullable=False, default="PROGRESSIVE")
    provider = Column(String(20), nullable=False, default="A")
    alpha = Column(Float, nullable=False, default=0.5)
    p_hat = Column(Float, nullable=False, default=0.3)
    d_hat = Column(Float, nullable=False, default=8.0)
    h_hat = Column(Float, nullable=False, default=120.0)
    sigma_hat = Column(Float, nullable=False, default=0.1)
    last_abandoned_at = Column(DateTime(timezone=True), nullable=True)
    clean_intervals_since_abandon = Column(Integer, nullable=False, default=0)
    progressive_cooldown_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    active = Column(Boolean, nullable=False, default=True)

    agents = relationship("Agent", back_populates="campaign")
    borrowers = relationship("Borrower", back_populates="campaign")
    calls = relationship("Call", back_populates="campaign")
    dial_decisions = relationship("DialDecision", back_populates="campaign")


class Agent(Base):
    __tablename__ = "agents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=True)
    name = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="OFFLINE")
    reserved_by = Column(Text, nullable=True)
    reserved_until = Column(DateTime(timezone=True), nullable=True)
    last_call_ended_at = Column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    campaign = relationship("Campaign", back_populates="agents")
    calls = relationship("Call", back_populates="agent")


class Borrower(Base):
    __tablename__ = "borrowers"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=True)
    phone = Column(Text, nullable=False)
    priority = Column(Integer, nullable=False, default=0)
    call_count = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    suppressed = Column(Boolean, nullable=False, default=False)
    retry_after = Column(DateTime(timezone=True), nullable=True)
    reserved_by = Column(Text, nullable=True)
    reserved_until = Column(DateTime(timezone=True), nullable=True)
    last_called_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    campaign = relationship("Campaign", back_populates="borrowers")
    calls = relationship("Call", back_populates="borrower")


class Call(Base):
    __tablename__ = "calls"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=True)
    borrower_id = Column(String(36), ForeignKey("borrowers.id"), nullable=True)
    agent_id = Column(String(36), ForeignKey("agents.id"), nullable=True)
    provider = Column(String(20), nullable=False)
    provider_call_id = Column(Text, nullable=True)
    state = Column(String(20), nullable=False, default="QUEUED")
    reserved_by = Column(Text, nullable=True)
    reserved_until = Column(DateTime(timezone=True), nullable=True)
    initiated_at = Column(DateTime(timezone=True), nullable=True)
    answered_at = Column(DateTime(timezone=True), nullable=True)
    connected_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)

    campaign = relationship("Campaign", back_populates="calls")
    borrower = relationship("Borrower", back_populates="calls")
    agent = relationship("Agent", back_populates="calls")


class ProviderEvent(Base):
    __tablename__ = "provider_events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    provider = Column(String(20), nullable=False)
    event_id = Column(Text, nullable=False, unique=True)
    provider_call_id = Column(Text, nullable=True)
    event_type = Column(String(30), nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    received_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)


class DialDecision(Base):
    __tablename__ = "dial_decisions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=True)
    tick_id = Column(Integer, nullable=False)
    decided_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    agents_available = Column(Integer, nullable=False)
    calls_initiated_or_ringing = Column(Integer, nullable=False)
    calls_answered_or_connected = Column(Integer, nullable=False)
    p_hat = Column(Float, nullable=False)
    d_hat = Column(Float, nullable=False)
    h_hat = Column(Float, nullable=False)
    f_available = Column(Float, nullable=False)
    alpha = Column(Float, nullable=False)
    provider_circuit = Column(String(20), nullable=False)
    n_proposed = Column(Integer, nullable=False)
    n_approved = Column(Integer, nullable=False)
    clamp_reasons = Column(JSON, nullable=False, default=list)
    mode_used = Column(String(20), nullable=False)

    campaign = relationship("Campaign", back_populates="dial_decisions")


class Lease(Base):
    __tablename__ = "leases"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    resource_type = Column(String(30), nullable=False)
    resource_id = Column(String(36), nullable=False)
    holder = Column(Text, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    released = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)


class DialTask(Base):
    __tablename__ = "dial_tasks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=True)
    decision_id = Column(String(36), ForeignKey("dial_decisions.id"), nullable=True)
    idempotency_key = Column(Text, nullable=False, unique=True)
    state = Column(String(20), nullable=False, default="PENDING")
    agent_id = Column(String(36), ForeignKey("agents.id"), nullable=True)
    borrower_id = Column(String(36), ForeignKey("borrowers.id"), nullable=True)
    call_id = Column(String(36), ForeignKey("calls.id"), nullable=True)
    claimed_by = Column(Text, nullable=True)
    claimed_until = Column(DateTime(timezone=True), nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    provider = Column(String(20), nullable=False, default="A")
    provider_call_id = Column(Text, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=True)
    event_type = Column(Text, nullable=False)
    severity = Column(String(20), nullable=False, default="INFO")
    actor = Column(Text, nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)


class ProviderHealthSnapshot(Base):
    __tablename__ = "provider_health_snapshots"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    provider = Column(String(20), nullable=False)
    circuit_state = Column(String(20), nullable=False)
    latency_p95_ms = Column(Float, nullable=False)
    failure_rate_ewma = Column(Float, nullable=False)
    recorded_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
