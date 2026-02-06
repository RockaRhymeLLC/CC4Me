"""
py2app build script for BMO Voice menu bar app.

Build:
    cd voice-client
    python setup.py py2app

Result:
    dist/BMO Voice.app

Install:
    1. Copy "BMO Voice.app" to /Applications
    2. Double-click to launch (grant microphone permission when prompted)
    3. Add to Login Items: System Settings > General > Login Items
"""

from setuptools import setup

APP = ["bmo_menubar.py"]

DATA_FILES = [
    ("", ["config.yaml"]),
    ("sounds", [
        "sounds/chime.wav",
        "sounds/error.wav",
        "sounds/listening.wav",
    ]),
]

# Include the wake word model if it exists locally
import os
if os.path.exists("hey_bee_mo.onnx"):
    DATA_FILES.append(("", ["hey_bee_mo.onnx"]))

OPTIONS = {
    "argv_emulation": False,
    "packages": [
        "rumps",
        "sounddevice",
        "numpy",
        "requests",
        "yaml",
        "openwakeword",
        "pynput",
    ],
    "includes": [
        "bmo_voice",
    ],
    "plist": {
        "LSUIElement": True,  # Hide from Dock — menu bar only
        "NSMicrophoneUsageDescription": (
            "BMO Voice needs microphone access to listen for your "
            "wake word and voice commands."
        ),
        "CFBundleName": "BMO Voice",
        "CFBundleDisplayName": "BMO Voice",
        "CFBundleIdentifier": "com.bmo.voice-client",
        "CFBundleShortVersionString": "1.0.0",
        "CFBundleVersion": "1",
    },
}

setup(
    app=APP,
    name="BMO Voice",
    data_files=DATA_FILES,
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
