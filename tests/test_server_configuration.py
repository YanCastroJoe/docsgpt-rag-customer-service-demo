import unittest
import json
import re
import tempfile
from pathlib import Path

from scripts.sanitize_rag_results import sanitize_jsonl


ROOT = Path(__file__).resolve().parents[1]


class ServerConfigurationTests(unittest.TestCase):
    def test_public_prompt_injects_retrieved_sources(self):
        sql = (ROOT / "deployment/server/configure-public-agent.sql").read_text(
            encoding="utf-8"
        )
        self.assertIn("本次检索到的 Sources：\n{summaries}", sql)
        self.assertIn("不得添加“来源”行", sql)
        self.assertIn("'{retrieval,retriever}'", sql)
        self.assertIn("'{retrieval}'", sql)
        self.assertIn('{"retriever":"hybrid","rephrase_query":false}', sql)
        self.assertNotIn("a0905d7f-0bf5-5d8d-acb4-bd6548b6c257", sql)
        self.assertIn(":'agent_id'::uuid", sql)
        self.assertIn(":'source_id'::uuid", sql)
        self.assertIsNone(re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", sql, re.I))

    def test_optimized_source_contains_seven_day_return_policy(self):
        knowledge = (ROOT / "knowledge_base/customer_service_rag_optimized.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("## 七天无理由退货", knowledge)
        self.assertIn("自签收次日零点起七日内", knowledge)
        self.assertIn("不影响二次销售", knowledge)

    def test_public_backend_image_installs_all_retrieval_guards(self):
        dockerfile = (ROOT / "deployment/server/overrides/Dockerfile").read_text(
            encoding="utf-8"
        )
        self.assertIn("hybrid_rag.py", dockerfile)
        self.assertIn("patch_answer_sources.py", dockerfile)
        self.assertIn("docker.io/arc53/docsgpt@sha256:", dockerfile)
        self.assertNotIn("ghcr.nju.edu.cn", dockerfile)

        frontend_dockerfile = (ROOT / "deployment/server/frontend/Dockerfile").read_text(
            encoding="utf-8"
        )
        self.assertIn("docker.io/arc53/docsgpt-fe@sha256:", frontend_dockerfile)
        self.assertNotIn("ghcr.nju.edu.cn", frontend_dockerfile)

    def test_public_compose_keeps_backend_private_and_runs_worker(self):
        compose = (ROOT / "deployment/server/docker-compose.public.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn('${DOCSGPT_BIND_ADDRESS:-127.0.0.1}', compose)
        self.assertIn('expose:\n      - "7091"', compose)
        self.assertNotIn('- "7091:7091"', compose)
        self.assertIn("  worker:", compose)
        self.assertIn("celery -A application.app.celery worker", compose)
        self.assertIn("./.demo-htpasswd:/etc/nginx/.htpasswd:ro", compose)

    def test_public_nginx_requires_login_and_limits_same_origin_api(self):
        nginx = (ROOT / "deployment/server/frontend/nginx.conf").read_text(
            encoding="utf-8"
        )
        self.assertIn('auth_basic "DocsGPT Interview Demo";', nginx)
        self.assertIn("location = /healthz", nginx)
        self.assertIn("auth_basic off;", nginx)
        self.assertIn("location ^~ /api/", nginx)
        self.assertIn("limit_req zone=demo_api", nginx)
        self.assertIn("proxy_pass http://backend:7091;", nginx)
        self.assertNotIn("return 302 /agents/shared/", nginx)
        self.assertIn("try_files /demo-entry.html", nginx)
        self.assertIn("__SHARED_AGENT_TOKEN__", nginx)

        entry = (ROOT / "deployment/server/frontend/demo-entry.html").read_text(
            encoding="utf-8"
        )
        self.assertIn('window.location.replace("/agents/shared/__SHARED_AGENT_TOKEN__")', entry)
        self.assertIn('name="robots" content="noindex,nofollow"', entry)

    def test_deploy_script_has_no_fixed_public_ip_and_enables_docflow_guard(self):
        deploy = (ROOT / "deployment/server/deploy-public-demos.sh").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("124.221.243.125", deploy)
        self.assertIn("DOCFLOW_PUBLIC_URL", deploy)
        self.assertIn("DOCSGPT_PUBLIC_URL", deploy)
        self.assertIn('DOCFLOW_DEMO_MODE "true"', deploy)
        self.assertIn(".demo-htpasswd", deploy)
        self.assertIn("backend worker frontend", deploy)
        self.assertIn("DOCSGPT_AGENT_ID", deploy)
        self.assertIn("DOCSGPT_SOURCE_ID", deploy)

        check_script = (ROOT / "deployment/server/check-public-demos.sh").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("127.0.0.1:7091", check_script)
        self.assertIn("docsgpt-demo-worker", check_script)
        self.assertIn("auth_args", check_script)
        self.assertIn("effectiveSources = refusal ? [] : rawSources", check_script)
        self.assertIn("isKnowledgeBoundaryRefusal", check_script)

    def test_public_environment_example_contains_no_secret_values(self):
        example = (ROOT / "deployment/server/.env.example").read_text(
            encoding="utf-8"
        )
        self.assertIn("DOCSGPT_BIND_ADDRESS=127.0.0.1", example)
        self.assertIn("SHARED_AGENT_TOKEN=replace-with-random-token", example)
        self.assertIn("DOCSGPT_AGENT_ID=replace-with-agent-uuid", example)
        self.assertIn("DOCSGPT_SOURCE_ID=replace-with-source-uuid", example)
        self.assertNotIn("124.221.243.125", example)

    def test_public_result_sanitizer_removes_session_identifiers(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "source.jsonl"
            destination = Path(temporary_directory) / "public.jsonl"
            source.write_text(
                json.dumps(
                    {
                        "case_id": "CS-001",
                        "conversation_id": "private-id",
                        "answer": "ok",
                        "nested": {"session_id": "private-session"},
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            self.assertEqual(sanitize_jsonl(source, destination), 1)
            sanitized = json.loads(destination.read_text(encoding="utf-8"))
            self.assertNotIn("conversation_id", sanitized)
            self.assertNotIn("session_id", sanitized["nested"])
            self.assertTrue(sanitized["conversation_id_redacted"])

    def test_tracked_public_evaluation_results_contain_no_conversation_ids(self):
        responses = ROOT / "evaluation" / "responses"
        for path in sorted(responses.glob("*.public.jsonl")):
            with self.subTest(path=path.name):
                for line in path.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        self.assertNotIn('"conversation_id":', line)
        manifest = (ROOT / "evaluation" / "run_manifest.json").read_text(encoding="utf-8")
        self.assertNotIn('"agent_id"', manifest)


if __name__ == "__main__":
    unittest.main()
