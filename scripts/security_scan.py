#!/usr/bin/env python3
"""Conservative tracked-file secret pattern scan; never prints matched values."""
from pathlib import Path
import re
import subprocess
import sys

PATTERNS = [
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b")),
    ("github-fine-grained-token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("generic-secret-assignment", re.compile(
        r"""(?i)\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\b"""
        r"""\s*[:=]\s*(['"])([^'"]{12,})\1"""
    )),
]
# Only exempt a clearly placeholder-shaped VALUE in a generic assignment.
# Never skip an entire line: a real credential may coexist with explanatory text.
EXPLICIT_PLACEHOLDER_VALUE = re.compile(
    r"(?i)^(?:your[_ -]?(?:api[_ -]?)?(?:key|token|secret|password)(?:[_ -]?here)?|"
    r"(?:replace|change|insert)[_ -]?(?:this[_ -]?)?(?:value|me|here)|"
    r"(?:example|placeholder|dummy|redacted)(?:[_ -]?(?:value|secret|token|key))?)$"
)

def detect_secret_pattern(line: str):
    """Return a finding label, or None; never return or log the matched value."""
    for label, pattern in PATTERNS:
        match = pattern.search(line)
        if not match:
            continue
        if label == "generic-secret-assignment":
            value = match.group(2).strip()
            if EXPLICIT_PLACEHOLDER_VALUE.fullmatch(value):
                continue
        return label
    return None

def main() -> int:
    try:
        files = subprocess.check_output(
            ["git", "ls-files", "-z"], text=True
        ).split("\0")
    except subprocess.CalledProcessError:
        print("ERROR: unable to enumerate tracked files.")
        return 2

    findings = []
    for name in filter(None, files):
        path = Path(name)
        if not path.is_file():
            continue
        try:
            data = path.read_bytes()
            if b"\x00" in data:
                continue
            text = data.decode("utf-8", errors="replace")
        except OSError:
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            label = detect_secret_pattern(line)
            if label:
                findings.append((name, line_no, label))

    if findings:
        print("Potential secret patterns detected (values intentionally omitted):")
        for name, line_no, label in findings:
            print(f"- {name}:{line_no} [{label}]")
        print("Review the locations privately; rotate any real exposed credential immediately.")
        return 1

    print(f"Secret-pattern scan passed for {len(files) - 1 if files else 0} tracked paths.")
    print("This heuristic scan cannot replace GitHub secret scanning or a history scan.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
