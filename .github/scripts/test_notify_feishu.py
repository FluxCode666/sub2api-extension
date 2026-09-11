import base64
import hashlib
import hmac
import importlib.util
from pathlib import Path
import unittest


def module():
    spec = importlib.util.spec_from_file_location(
        "notify_feishu", Path(__file__).with_name("notify-feishu.py")
    )
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


notify = module()


class FeishuNotificationTests(unittest.TestCase):
    def test_sign_matches_feishu_hmac_format(self):
        timestamp = 1700000000
        secret = "test-secret"
        expected = base64.b64encode(
            hmac.new(
                f"{timestamp}\n{secret}".encode(), b"", hashlib.sha256
            ).digest()
        ).decode()
        self.assertEqual(notify.sign(timestamp, secret), expected)

    def test_response_error_accepts_success_and_reports_platform_error(self):
        self.assertEqual(notify.response_error(b'{"code":0,"msg":"success"}'), "")
        self.assertIn(
            "invalid signature",
            notify.response_error(b'{"code":19024,"msg":"invalid signature"}'),
        )


if __name__ == "__main__":
    unittest.main()
