from __future__ import annotations
import importlib
import sys


def test_pacing_does_not_import_providers():
    """
    Architectural firewall invariant:
    Pacing modules must NEVER directly or indirectly import anything from app.providers.
    Only SafetyController and CallAllocator interact with providers.
    """
    # Evict cached provider and pacing modules
    for m in list(sys.modules):
        if m.startswith("app.providers") or m.startswith("app.pacing"):
            del sys.modules[m]

    # Import pacing modules freshly
    importlib.import_module("app.pacing.base")
    importlib.import_module("app.pacing.progressive")
    importlib.import_module("app.pacing.predictive")

    # Assert that zero provider modules were loaded as a side-effect
    provider_modules = [m for m in sys.modules if m.startswith("app.providers")]
    assert not provider_modules, f"Firewall breach! Pacing imported provider modules: {provider_modules}"
