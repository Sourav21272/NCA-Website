import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from runtime_config import read_config_value


class ReadConfigValueTests(unittest.TestCase):
    def test_reads_secret_file_and_removes_trailing_newline(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "ADMIN_PASSWORD").write_text("private-value\n", encoding="utf-8")
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("ADMIN_PASSWORD", None)
                self.assertEqual(
                    read_config_value("ADMIN_PASSWORD", Path(directory)),
                    "private-value",
                )

    def test_environment_value_takes_precedence_over_secret_file(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "ADMIN_EMAIL").write_text("file@example.com", encoding="utf-8")
            with patch.dict(os.environ, {"ADMIN_EMAIL": "env@example.com"}, clear=False):
                self.assertEqual(
                    read_config_value("ADMIN_EMAIL", Path(directory)),
                    "env@example.com",
                )


if __name__ == "__main__":
    unittest.main()
