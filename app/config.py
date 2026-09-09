from __future__ import annotations
import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application runtime configuration."""
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://postgres:postgres@localhost:5432/smartdialer"
    )
    dashboard_token: str = os.getenv("DASHBOARD_TOKEN", "credresolve-secret-2026")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    environment: str = os.getenv("ENVIRONMENT", "development")

    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()
