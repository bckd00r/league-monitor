#!/usr/bin/env python3
"""Entry point for PyInstaller builds."""

import sys
import os

# Add the package to path for PyInstaller
if getattr(sys, 'frozen', False):
    # Running as compiled
    bundle_dir = sys._MEIPASS
    sys.path.insert(0, bundle_dir)
else:
    # Running as script
    bundle_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, bundle_dir)

# Now import and run
from league_monitor.__main__ import main

if __name__ == "__main__":
    main()
