"""Run the local application and durable workers; terminate them together with Ctrl-C."""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

os.chdir(Path(__file__).parent)
children = []


def stop(*args):
    for child in children:
        child.terminate()
    for child in children:
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
    sys.exit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
for args in (
    ["runserver", "127.0.0.1:8000", "--noreload"],
    ["run_delivery"],
    ["run_bridge"],
    ["run_company"],
):
    children.append(subprocess.Popen([sys.executable, "manage.py", *args]))
try:
    while all(child.poll() is None for child in children):
        time.sleep(1)
finally:
    stop()
