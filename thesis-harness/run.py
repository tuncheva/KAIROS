#!/usr/bin/env python3
"""Entry point: ``python thesis-harness/run.py <command>`` from anywhere."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from thesis_harness.cli import main  # noqa: E402

if __name__ == "__main__":
    main()
