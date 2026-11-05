"""HTTP validation preserves the published database on invalid responses."""
import http.server
import tempfile
import threading
import unittest
from pathlib import Path

import http_download


class DownloadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                payload = b'[{"game_name": "Example"}]' if self.path == "/db.json" else b"not json"
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_bad_database_preserves_previous_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            path = http_download.download(self.origin + "/db.json", directory, filename="database.json")
            previous = Path(path).read_bytes()
            with self.assertRaises(ValueError):
                http_download.download(self.origin + "/invalid.json", directory, filename="database.json")
            self.assertEqual(Path(path).read_bytes(), previous)
            self.assertEqual(sorted(p.name for p in Path(directory).iterdir()), ["database.json"])


if __name__ == "__main__":
    unittest.main()
