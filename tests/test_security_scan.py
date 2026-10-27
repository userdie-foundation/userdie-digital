"""Regression tests for the tracked-file secret pattern scanner."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "security_scan.py"
SPEC = importlib.util.spec_from_file_location("security_scan", SCRIPT)
security_scan = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(security_scan)


class SecretScannerTests(unittest.TestCase):
    def test_real_secret_is_not_hidden_by_example_word_on_same_line(self):
        line = 'example configuration: password = "a-real-looking-secret-value"'
        self.assertEqual(
            security_scan.detect_secret_pattern(line),
            "generic-secret-assignment",
        )

    def test_explicit_placeholder_value_is_allowed(self):
        self.assertIsNone(
            security_scan.detect_secret_pattern('password = "your_api_key_here"')
        )

    def test_token_pattern_is_not_hidden_by_placeholder_hint(self):
        line = "# example token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"
        self.assertEqual(security_scan.detect_secret_pattern(line), "github-token")

    def test_scanner_never_returns_secret_value(self):
        result = security_scan.detect_secret_pattern(
            'client_secret = "confidential-value-12345"'
        )
        self.assertEqual(result, "generic-secret-assignment")
        self.assertNotIn("confidential-value-12345", str(result))


if __name__ == "__main__":
    unittest.main()
