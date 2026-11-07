#!/usr/bin/env python3
"""Run this file from the trusted base checkout, never from a proposed branch."""

import json
import subprocess
import sys

base, head, branch = sys.argv[1:4]
if not branch.startswith("codex/company/"):
    print("Operator-authored change: ordinary review and integration gates apply.")
    raise SystemExit(0)
changes = subprocess.check_output(["git", "diff", "--name-status", base, head], text=True).splitlines()
if changes != ["M\tcontent/help.json"]:
    raise SystemExit("Autonomous releases may modify only content/help.json.")
original = json.loads(subprocess.check_output(["git", "show", f"{base}:content/help.json"]))
candidate = json.loads(subprocess.check_output(["git", "show", f"{head}:content/help.json"]))
# Use the trusted base's validator; a candidate cannot rewrite it or the tests.
import os  # noqa: E402

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fyde.settings")
import django  # noqa: E402

django.setup()
from company.policy import validate_help_patch  # noqa: E402

print(json.dumps(validate_help_patch(original, candidate)))
