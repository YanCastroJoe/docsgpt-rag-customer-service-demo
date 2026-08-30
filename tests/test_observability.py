from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))


def load_script(name: str):
    path = SCRIPTS / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


observability = load_script("build_rag_observability")


class ObservabilitySnapshotTests(unittest.TestCase):
    def test_snapshot_uses_latest_run_and_removes_conversation_ids(self):
        payload = observability.build_snapshot(
            ROOT, ROOT / "evaluation" / "run_manifest.json"
        )
        self.assertEqual("边界增强V3", payload["latest_run"]["label"])
        self.assertEqual(30, payload["latest_run"]["submitted"])
        self.assertEqual(30, len(payload["traces"]))
        self.assertNotIn("conversation_id", json.dumps(payload, ensure_ascii=False))
        self.assertEqual("fixed_evaluation_snapshot", payload["mode"])

    def test_resolve_repo_path_rejects_parent_escape(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with self.assertRaises(ValueError):
                observability.resolve_repo_path(root, "../outside.json")


if __name__ == "__main__":
    unittest.main()
