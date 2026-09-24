#!/usr/bin/env python3
"""Fail if any tracked or staged file matches a private denylist.

The denylist lives outside version control: `.scrub-denylist` locally (gitignored) or the
SCRUB_DENYLIST environment variable in CI (newline-separated regexes). Without either, the check
is skipped with a warning so forks can still run the rest of the gate.
"""
import os
import re
import subprocess
import sys


def patterns():
    raw = os.environ.get("SCRUB_DENYLIST")
    if raw is None and os.path.exists(".scrub-denylist"):
        raw = open(".scrub-denylist", encoding="utf-8").read()
    if not raw:
        return None
    lines = [l.strip() for l in raw.splitlines()]
    return [re.compile(l, re.IGNORECASE) for l in lines if l and not l.startswith("#")]


def files(argv):
    if argv:
        return argv
    out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "-z"], capture_output=True, check=True)
    return [os.fsdecode(f) for f in out.stdout.split(b"\0") if f]


def main(argv):
    pats = patterns()
    if pats is None:
        print("scrub-check: no denylist configured, skipping", file=sys.stderr)
        return 0
    bad = 0
    for path in files(argv):
        if path in (".scrub-denylist",) or not os.path.isfile(path):
            continue
        for p in pats:
            if p.search(path):
                print(f"{path}: path matches a denylisted pattern")
                bad += 1
        try:
            text = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for p in pats:
                if p.search(line):
                    print(f"{path}:{n}: denylisted term")
                    bad += 1
    if bad:
        print(f"scrub-check: {bad} hit(s); remove lab or customer identifiers before committing", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
