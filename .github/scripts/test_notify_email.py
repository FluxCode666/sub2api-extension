import importlib.util
from pathlib import Path
import unittest


def module():
    spec = importlib.util.spec_from_file_location(
        "notify_email", Path(__file__).with_name("notify-email.py")
    )
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


notify = module()


class EmailNotificationTests(unittest.TestCase):
    def test_recipients_support_multiple_separators_and_deduplicate(self):
        self.assertEqual(
            notify.recipients("a@example.com, b@example.com;A@example.com\nc@example.com"),
            ["a@example.com", "b@example.com", "c@example.com"],
        )

    def test_recipients_reject_invalid_address(self):
        with self.assertRaises(ValueError):
            notify.recipients("a@example.com invalid")


if __name__ == "__main__":
    unittest.main()
