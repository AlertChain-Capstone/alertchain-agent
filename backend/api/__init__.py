__all__ = ["InvestigationsRouter", "build_in_memory_router", "default_router"]


def __getattr__(name):
    # Alert reads/ingestion need no FastAPI runtime. Keep the existing FA2 imports available.
    if name in __all__:
        from . import investigations

        return getattr(investigations, name)
    raise AttributeError(name)
