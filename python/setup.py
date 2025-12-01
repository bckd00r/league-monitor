"""Setup script for League Monitor."""

from setuptools import setup, find_packages

APP = ["league_monitor/__main__.py"]

DATA_FILES = [
    ("", ["config.yaml"]),
]

OPTIONS = {
    "argv_emulation": False,
    "iconfile": "assets/icon.icns",
    "plist": {
        "CFBundleName": "League Monitor",
        "CFBundleDisplayName": "League Monitor",
        "CFBundleIdentifier": "com.leaguemonitor.app",
        "CFBundleVersion": "1.0.0",
        "CFBundleShortVersionString": "1.0.0",
        "NSHighResolutionCapable": True,
        "NSRequiresAquaSystemAppearance": False,  # Dark mode support
        "LSMinimumSystemVersion": "10.15",
    },
    "packages": ["league_monitor", "customtkinter", "websockets", "psutil", "yaml"],
    "includes": [
        "asyncio",
        "threading",
        "json",
        "PIL",
    ],
}

setup(
    name="LeagueMonitor",
    version="1.0.0",
    description="League of Legends Client Monitor and Synchronization Tool",
    author="League Monitor",
    packages=find_packages(),
    install_requires=[
        "websockets>=12.0",
        "pyyaml>=6.0",
        "psutil>=5.9",
        "customtkinter>=5.2",
        "pillow>=10.0",
    ],
    entry_points={
        "console_scripts": [
            "league-monitor=league_monitor.__main__:main",
        ],
        "gui_scripts": [
            "league-monitor-gui=league_monitor.__main__:main",
        ],
    },
    python_requires=">=3.10",
    app=APP,
    data_files=DATA_FILES,
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
