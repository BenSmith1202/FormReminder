"""
Live integration tests for the Emailit HTTP API.

These tests make real HTTP calls to api.emailit.com and will send actual
emails.  They are gated behind the ``integration`` pytest mark so they never
run during normal unit-test runs.

Run command:
    cd backend
    pytest -m integration tests/test_emailit_live.py -v

Required .env entries before running:
    EMAILIT_API_KEY        — your Emailit API key
    EMAILIT_FROM_ADDRESS   — a verified sender address on your Emailit account
    TEST_RECIPIENT_EMAIL   — an inbox you can check to confirm delivery
"""
import os
import sys
import time

import pytest
import requests as _requests

THIS_DIR = os.path.dirname(__file__)
BACKEND_APP_DIR = os.path.abspath(os.path.join(THIS_DIR, "..", "app"))
sys.path.insert(0, BACKEND_APP_DIR)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(THIS_DIR, "..", ".env"))
except ImportError:
    pass

from fake_firestore import FakeFirestore  # noqa: E402
from google.cloud.firestore_v1.base_query import FieldFilter  # noqa: E402

EMAILIT_API_URL = "https://api.emailit.com/v2/emails"

# Emailit may return 200 or 201 for accepted emails.
EMAILIT_SUCCESS_CODES = (200, 201)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PLACEHOLDER_VALUES = {
    "reminders@yourdomain.com",
    "your_email@example.com",
    "em_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "your_emailit_api_key",
}


def _env(key: str) -> str:
    """Return the env var value or empty string."""
    return os.environ.get(key, "").strip()


def _is_placeholder(value: str) -> bool:
    return not value or value in PLACEHOLDER_VALUES


def _api_headers() -> dict:
    return {
        "Authorization": f"Bearer {_env('EMAILIT_API_KEY')}",
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def fake_db():
    return FakeFirestore()


@pytest.fixture(scope="module")
def recipient_email():
    email = _env("TEST_RECIPIENT_EMAIL")
    if _is_placeholder(email):
        pytest.skip("TEST_RECIPIENT_EMAIL not configured in .env")
    return email


# ---------------------------------------------------------------------------
# Group 1 — Configuration checks (always fast, no network)
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestConfiguration:
    """Verify all required env vars are present and non-placeholder before
    attempting any network calls."""

    def test_api_key_is_set(self):
        value = _env("EMAILIT_API_KEY")
        assert value, "EMAILIT_API_KEY is not set in .env"
        assert not _is_placeholder(value), (
            "EMAILIT_API_KEY still contains a placeholder value"
        )

    def test_from_address_is_set(self):
        value = _env("EMAILIT_FROM_ADDRESS")
        assert value, "EMAILIT_FROM_ADDRESS is not set in .env"
        assert not _is_placeholder(value), (
            f"EMAILIT_FROM_ADDRESS is still '{value}' — replace with your "
            "verified sender address from the Emailit dashboard"
        )

    def test_from_address_looks_valid(self):
        value = _env("EMAILIT_FROM_ADDRESS")
        assert "@" in value and "." in value.split("@")[-1], (
            f"EMAILIT_FROM_ADDRESS '{value}' does not look like a valid email"
        )

    def test_recipient_email_is_set(self):
        value = _env("TEST_RECIPIENT_EMAIL")
        assert value, "TEST_RECIPIENT_EMAIL is not set in .env"
        assert not _is_placeholder(value), (
            "TEST_RECIPIENT_EMAIL still contains a placeholder value"
        )

    def test_webhook_secret_is_set(self):
        value = _env("EMAILIT_WEBHOOK_SECRET")
        assert value, "EMAILIT_WEBHOOK_SECRET is not set in .env"
        assert value != "your_webhook_secret", (
            "EMAILIT_WEBHOOK_SECRET still contains a placeholder value"
        )


# ---------------------------------------------------------------------------
# Group 2 — API authentication (single lightweight request)
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestApiAuthentication:
    """Verify the API key is accepted by Emailit before sending any email."""

    def test_invalid_key_returns_401(self):
        """Sanity check: a deliberately wrong key should get a 401."""
        resp = _requests.post(
            EMAILIT_API_URL,
            json={
                "from": "test@example.com",
                "to": ["nobody@example.com"],
                "subject": "Auth test",
                "html": "<p>test</p>",
            },
            headers={
                "Authorization": "Bearer deliberately_invalid_key_abc123",
                "Content-Type": "application/json",
            },
            timeout=15,
        )
        assert resp.status_code in (401, 403), (
            f"Expected 401/403 for an invalid key, got {resp.status_code}"
        )

    def test_valid_key_does_not_return_401(self, recipient_email):
        """The configured API key must not be rejected with 401/403."""
        resp = _requests.post(
            EMAILIT_API_URL,
            json={
                "from": f"{_env('EMAILIT_FROM_NAME')} <{_env('EMAILIT_FROM_ADDRESS')}>",
                "to": [recipient_email],
                "subject": "[FormReminder] Auth check",
                "html": "<p>This is an auth check — no action needed.</p>",
            },
            headers=_api_headers(),
            timeout=15,
        )
        assert resp.status_code not in (401, 403), (
            f"API key was rejected (HTTP {resp.status_code}): {resp.text}"
        )


# ---------------------------------------------------------------------------
# Group 3 — Raw API send (bypasses EmailService, tests the HTTP layer only)
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestRawApiSend:
    """Call the Emailit API directly to verify payload format and response."""

    def test_send_minimal_email(self, recipient_email):
        """POST the minimal required fields and expect HTTP 201."""
        resp = _requests.post(
            EMAILIT_API_URL,
            json={
                "from": _env("EMAILIT_FROM_ADDRESS"),
                "to": [recipient_email],
                "subject": "[FormReminder] Minimal send test",
                "html": "<h1>Minimal test</h1><p>If you see this, the raw API call works.</p>",
            },
            headers=_api_headers(),
            timeout=15,
        )
        assert resp.status_code in EMAILIT_SUCCESS_CODES, (
            f"Expected {EMAILIT_SUCCESS_CODES}, got {resp.status_code}: {resp.text}"
        )

    def test_response_body_contains_expected_fields(self, recipient_email):
        """The success response must include the documented fields."""
        resp = _requests.post(
            EMAILIT_API_URL,
            json={
                "from": _env("EMAILIT_FROM_ADDRESS"),
                "to": [recipient_email],
                "subject": "[FormReminder] Response shape test",
                "html": "<p>Checking response body shape.</p>",
            },
            headers=_api_headers(),
            timeout=15,
        )
        assert resp.status_code in EMAILIT_SUCCESS_CODES
        body = resp.json()
        assert "id" in body, f"Response missing 'id': {body}"
        assert "status" in body, f"Response missing 'status': {body}"
        assert body.get("status") in ("pending", "queued", "sent", "accepted"), (
            f"Unexpected status value: {body.get('status')}"
        )

    def test_send_with_from_name(self, recipient_email):
        """Verify the 'Name <email>' from format is accepted."""
        from_header = f"{_env('EMAILIT_FROM_NAME')} <{_env('EMAILIT_FROM_ADDRESS')}>"
        resp = _requests.post(
            EMAILIT_API_URL,
            json={
                "from": from_header,
                "to": [recipient_email],
                "subject": "[FormReminder] From-name format test",
                "html": "<p>Testing 'Name &lt;email&gt;' from format.</p>",
            },
            headers=_api_headers(),
            timeout=15,
        )
        assert resp.status_code in EMAILIT_SUCCESS_CODES, (
            f"'Name <email>' from format rejected ({resp.status_code}): {resp.text}"
        )

    def test_send_with_tracking_flags(self, recipient_email):
        """Verify the tracking object is accepted without error."""
        resp = _requests.post(
            EMAILIT_API_URL,
            json={
                "from": _env("EMAILIT_FROM_ADDRESS"),
                "to": [recipient_email],
                "subject": "[FormReminder] Tracking flags test",
                "html": "<p>Testing tracking: loads=True, clicks=True.</p>",
                "tracking": {"loads": True, "clicks": True},
            },
            headers=_api_headers(),
            timeout=15,
        )
        assert resp.status_code in EMAILIT_SUCCESS_CODES, (
            f"Tracking flags caused error ({resp.status_code}): {resp.text}"
        )
        body = resp.json()
        tracking = body.get("tracking", {})
        assert tracking.get("loads") is True
        assert tracking.get("clicks") is True

    def test_ids_map_includes_recipient(self, recipient_email):
        """The response 'ids' map must contain the recipient address."""
        resp = _requests.post(
            EMAILIT_API_URL,
            json={
                "from": _env("EMAILIT_FROM_ADDRESS"),
                "to": [recipient_email],
                "subject": "[FormReminder] IDs map test",
                "html": "<p>Checking per-recipient IDs in response.</p>",
            },
            headers=_api_headers(),
            timeout=15,
        )
        assert resp.status_code in EMAILIT_SUCCESS_CODES
        body = resp.json()
        ids = body.get("ids", {})
        assert recipient_email in ids, (
            f"Recipient '{recipient_email}' not found in response 'ids': {ids}"
        )


# ---------------------------------------------------------------------------
# Group 4 — EmailService layer (uses real HTTP, fake Firestore)
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestEmailServiceLive:
    """Test the EmailService methods against the real Emailit API."""

    @pytest.fixture(autouse=True)
    def _patch_db(self, monkeypatch, fake_db):
        import models.database as db_module
        import utils.email_service as svc_module
        import models.org_membership as om_module

        monkeypatch.setattr(db_module, "get_db", lambda: fake_db)
        monkeypatch.setattr(svc_module, "get_db", lambda: fake_db)
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)

    def test_send_email_returns_success_true(self, recipient_email):
        """EmailService.send_email must return {'success': True} on a real send."""
        from utils.email_service import EmailService

        result = EmailService.send_email(
            recipient_email,
            "[FormReminder] EmailService.send_email live test",
            "<h2>Live test</h2><p>EmailService.send_email reached the Emailit API successfully.</p>",
        )
        assert result.get("success") is True, (
            f"send_email failed: {result}"
        )

    def test_send_email_does_not_set_rate_limited_on_success(self, recipient_email):
        """A successful send must not have rate_limited=True."""
        from utils.email_service import EmailService

        result = EmailService.send_email(
            recipient_email,
            "[FormReminder] Rate-limited flag test",
            "<p>Checking rate_limited is not set on a successful send.</p>",
        )
        assert result.get("rate_limited") is not True

    def test_send_reminder_full_flow(self, recipient_email, fake_db):
        """EmailService.send_reminder renders the Jinja2 template and sends via the API."""
        from utils.email_service import EmailService

        result = EmailService.send_reminder(
            request_id="live_test_req_001",
            form_title="Staff Survey 2026",
            form_url="https://docs.google.com/forms/d/e/test/viewform",
            recipient_email=recipient_email,
            owner_id=None,
            skip_rate_limit=True,
        )
        assert result.get("success") is True, (
            f"send_reminder failed: {result}"
        )

    def test_send_reminder_with_unsubscribe_link(self, recipient_email, fake_db):
        """send_reminder with owner_id generates and embeds the unsubscribe URL."""
        from utils.email_service import EmailService
        from config import settings

        original_secret = settings.SECRET_KEY
        settings.SECRET_KEY = "live_test_secret_key"
        try:
            result = EmailService.send_reminder(
                request_id="live_test_req_002",
                form_title="Onboarding Form",
                form_url="https://docs.google.com/forms/d/e/test/viewform",
                recipient_email=recipient_email,
                owner_id="owner_live_test",
                skip_rate_limit=True,
            )
        finally:
            settings.SECRET_KEY = original_secret

        assert result.get("success") is True, (
            f"send_reminder with unsubscribe link failed: {result}"
        )

    def test_send_reminder_logs_to_database(self, recipient_email, fake_db):
        """A successful send_reminder must write a record to the email_logs collection."""
        from utils.email_service import EmailService
        from models.database import Collections

        request_id = "live_test_req_log_001"
        result = EmailService.send_reminder(
            request_id=request_id,
            form_title="Log Test Form",
            form_url="https://docs.google.com/forms/d/e/test/viewform",
            recipient_email=recipient_email,
            owner_id=None,
            skip_rate_limit=True,
        )
        assert result.get("success") is True

        logs = list(
            fake_db.collection(Collections.EMAIL_LOGS)
            .where(filter=FieldFilter("request_id", "==", request_id))
            .stream()
        )
        assert len(logs) >= 1, "No email_logs entry written after successful send"
        assert logs[0].to_dict().get("success") is True

    def test_send_reminder_respects_app_rate_limit(self, recipient_email, fake_db):
        """Second send_reminder to the same recipient within the cooldown is blocked."""
        from utils.email_service import EmailService

        request_id = "live_test_rate_limit_001"
        # First send — must succeed
        result1 = EmailService.send_reminder(
            request_id=request_id,
            form_title="Rate Limit Form",
            form_url="https://docs.google.com/forms/d/e/test/viewform",
            recipient_email=recipient_email,
            owner_id=None,
        )
        assert result1.get("success") is True, f"First send failed: {result1}"

        # Second send within cooldown — must be blocked by app-level rate limit
        result2 = EmailService.send_reminder(
            request_id=request_id,
            form_title="Rate Limit Form",
            form_url="https://docs.google.com/forms/d/e/test/viewform",
            recipient_email=recipient_email,
            owner_id=None,
        )
        assert result2.get("success") is False
        assert "Rate limit" in result2.get("error", ""), (
            f"Expected app-level rate limit error, got: {result2}"
        )


# ---------------------------------------------------------------------------
# Group 5 — Batch sender live
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestBatchSendLive:
    """Test send_reminders_batch against the real Emailit API."""

    @pytest.fixture(autouse=True)
    def _patch_db(self, monkeypatch, fake_db):
        import models.database as db_module
        import utils.email_service as svc_module
        import models.org_membership as om_module

        monkeypatch.setattr(db_module, "get_db", lambda: fake_db)
        monkeypatch.setattr(svc_module, "get_db", lambda: fake_db)
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)

    def test_batch_sends_single_recipient(self, recipient_email, fake_db):
        """send_reminders_batch with one recipient reports it in 'sent'."""
        from utils.email_service import EmailService

        recipients = [
            {
                "request_id": "batch_live_001",
                "form_title": "Batch Single Test",
                "form_url": "https://docs.google.com/forms/d/e/test/viewform",
                "recipient_email": recipient_email,
                "owner_id": None,
            }
        ]
        summary = EmailService.send_reminders_batch(recipients, batch_size=10)

        assert recipient_email in summary["sent"], (
            f"Expected recipient in 'sent', got summary: {summary}"
        )
        assert summary["emailit_rate_limited"] is False
        assert summary["not_attempted"] == []

    def test_batch_summary_counts_are_consistent(self, recipient_email, fake_db):
        """Total of all buckets equals the number of recipients submitted."""
        from utils.email_service import EmailService

        recipients = [
            {
                "request_id": "batch_live_002",
                "form_title": "Batch Count Test",
                "form_url": "https://docs.google.com/forms/d/e/test/viewform",
                "recipient_email": recipient_email,
                "owner_id": None,
            }
        ]
        summary = EmailService.send_reminders_batch(recipients, batch_size=10)

        total_accounted = (
            len(summary["sent"])
            + len(summary["skipped"])
            + len(summary["failed"])
            + len(summary["opted_out"])
            + len(summary["bounced"])
            + len(summary["not_attempted"])
        )
        assert total_accounted == len(recipients), (
            f"Bucket totals ({total_accounted}) != recipients submitted ({len(recipients)}). "
            f"Summary: {summary}"
        )

    def test_batch_does_not_duplicate_sends(self, recipient_email, fake_db):
        """Sending the same recipient twice in one batch only results in one
        successful API call; the second is blocked by the app rate limit."""
        from utils.email_service import EmailService

        base = {
            "form_title": "Dupe Test",
            "form_url": "https://docs.google.com/forms/d/e/test/viewform",
            "owner_id": None,
        }
        recipients = [
            {**base, "request_id": "batch_dupe_001", "recipient_email": recipient_email},
            {**base, "request_id": "batch_dupe_001", "recipient_email": recipient_email},
        ]
        summary = EmailService.send_reminders_batch(recipients, batch_size=10)

        total_sent = len(summary["sent"])
        total_skipped = len(summary["skipped"])
        assert total_sent == 1 and total_skipped == 1, (
            f"Expected 1 sent + 1 skipped for duplicate recipient, got: {summary}"
        )
