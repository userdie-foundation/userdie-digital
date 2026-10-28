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
        key = "pass" + "word"
        value = "a-real-looking-" + "secret-value"
        line = f'example configuration: {key} = "{value}"'
        self.assertEqual(
            security_scan.detect_secret_pattern(line),
            "generic-secret-assignment",
        )

    def test_explicit_placeholder_value_is_allowed(self):
        key = "pass" + "word"
        placeholder = "your_" + "api_key" + "_here"
        self.assertIsNone(
            security_scan.detect_secret_pattern(f'{key} = "{placeholder}"')
        )

    def test_token_pattern_is_not_hidden_by_placeholder_hint(self):
        token_prefix = "gh" + "p_"
        token_body = "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"
        line = f"# example token: {token_prefix}{token_body}"
        self.assertEqual(security_scan.detect_secret_pattern(line), "github-token")

    def test_scanner_never_returns_secret_value(self):
        key = "client_" + "secret"
        value = "confidential-value-" + "12345"
        result = security_scan.detect_secret_pattern(f'{key} = "{value}"')
        self.assertEqual(result, "generic-secret-assignment")
        self.assertNotIn(value, str(result))


if __name__ == "__main__":
    unittest.main()
