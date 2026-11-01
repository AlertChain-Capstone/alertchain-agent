import sys
from pathlib import Path

# backend/ has no package marker (other folders belong to teammates), so put it on sys.path:
# `domain`, `infra`, and `agent` then import as top-level packages.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
