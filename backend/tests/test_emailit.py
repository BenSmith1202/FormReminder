"""
Tests for Emailit HTTP API and webhook integration.
"""
import os
import sys
import hmac
import hashlib
import json

import pytest

THIS_DIR = os.path.dirname(__file__)
BACKEND_APP_DIR = os.path.abspath(os.path.join(THIS_DIR, "..", "app"))
sys.path.insert(0, BACKEND_APP_DIR)

from fake_firestore import FakeFirestore  # noqa: E402


@pytest.fixture
def fake_db():
    return FakeFirestore()


@pytest.fixture
def flask_app(fake_db, monkeypatch):
    import app as app_module  # noqa: E402

    def _get_db():
        return fake_db

    monkeypatch.setattr(app_module, "get_db", _get_db, raising=True)
    import models.database as db_module  # noqa: E402
    monkeypatch.setattr(db_module, "get_db", _get_db, raising=True)
    import utils.email_service as email_module  # noqa: E402
    monkeypatch.setattr(email_module, "get_db", _get_db, raising=True)

    import config as config_module  # noqa: E402
    config_module.settings.SECRET_KEY = "test_secret"
    config_module.settings.BACKEND_PUBLIC_URL = "http://localhost:5000"
    app_module.app.secret_key = config_module.settings.SECRET_KEY
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


def test_send_email_posts_to_api(monkeypatch):
    """Verify send_email POSTs to the Emailit API with correct headers and payload."""
    import requests  # noqa: E402
    from utils import email_service  # noqa: E402
    from unittest.mock import MagicMock, patch  # noqa: E402

    monkeypatch.setenv("EMAILIT_API_KEY", "test_api_key")
    monkeypatch.setenv("EMAILIT_FROM_ADDRESS", "from@test.com")
    monkeypatch.setenv("EMAILIT_FROM_NAME", "TestApp")

    mock_response = MagicMock()
    mock_response.status_code = 201

    with patch.object(requests, "post", return_value=mock_response) as mock_post:
        result = email_service.EmailService.send_email("to@test.com", "Subj", "<p>Hi</p>")

    assert result["success"] is True
    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args

    assert call_kwargs[0][0] == email_service.EMAILIT_API_URL
    headers = call_kwargs[1]["headers"]
    assert headers["Authorization"] == "Bearer test_api_key"
    assert headers["Content-Type"] == "application/json"

    payload = call_kwargs[1]["json"]
    assert payload["to"] == ["to@test.com"]
    assert payload["subject"] == "Subj"
    assert "<p>Hi</p>" in payload["html"]
    assert payload["from"] == "TestApp <from@test.com>"
    assert payload["tracking"] == {"loads": True, "clicks": True}


def test_send_email_returns_failure_on_api_error(monkeypatch):
    """Verify send_email returns success=False when the API responds with a non-201 status."""
    import requests  # noqa: E402
    from utils import email_service  # noqa: E402
    from unittest.mock import MagicMock, patch  # noqa: E402

    monkeypatch.setenv("EMAILIT_API_KEY", "test_api_key")
    monkeypatch.setenv("EMAILIT_FROM_ADDRESS", "from@test.com")

    mock_response = MagicMock()
    mock_response.status_code = 422
    mock_response.text = "Unprocessable Entity"

    with patch.object(requests, "post", return_value=mock_response):
        result = email_service.EmailService.send_email("bad@test.com", "Subj", "<p>Hi</p>")

    assert result["success"] is False
    assert result.get("rate_limited") is not True


def test_send_email_surfaces_rate_limit(monkeypatch):
    """Verify a 429 from Emailit sets rate_limited=True in the result."""
    import requests  # noqa: E402
    from utils import email_service  # noqa: E402
    from unittest.mock import MagicMock, patch  # noqa: E402

    monkeypatch.setenv("EMAILIT_API_KEY", "test_api_key")
    monkeypatch.setenv("EMAILIT_FROM_ADDRESS", "from@test.com")

    mock_response = MagicMock()
    mock_response.status_code = 429

    with patch.object(requests, "post", return_value=mock_response):
        result = email_service.EmailService.send_email("to@test.com", "Subj", "<p>Hi</p>")

    assert result["success"] is False
    assert result.get("rate_limited") is True


def test_send_email_returns_failure_when_api_key_missing(monkeypatch):
    """Verify send_email returns success=False immediately when EMAILIT_API_KEY is not set."""
    import requests  # noqa: E402
    from utils import email_service  # noqa: E402
    from unittest.mock import patch  # noqa: E402

    monkeypatch.delenv("EMAILIT_API_KEY", raising=False)
    monkeypatch.setenv("EMAILIT_FROM_ADDRESS", "from@test.com")

    with patch.object(requests, "post") as mock_post:
        result = email_service.EmailService.send_email("to@test.com", "Subj", "<p>Hi</p>")

    assert result["success"] is False
    assert mock_post.called is False


def test_webhook_valid_signature_logs_event(client, fake_db, monkeypatch):
    """POST valid signed payload to webhook; verify email_events document is written."""
    from models.database import Collections  # noqa: E402

    secret = "webhook_secret_123"
    monkeypatch.setenv("EMAILIT_WEBHOOK_SECRET", secret)

    payload = {
        "event_type": "email.delivered",
        "email": "user@example.com",
        "metadata": {"request_id": "req_abc"},
    }
    body = json.dumps(payload).encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()

    resp = client.post(
        "/api/webhooks/emailit",
        data=body,
        content_type="application/json",
        headers={"X-Emailit-Signature": sig},
    )
    assert resp.status_code == 200
    assert resp.get_json() == {"received": True}

    events = list(fake_db.collection(Collections.EMAIL_EVENTS)._docs.values())
    assert len(events) == 1
    assert events[0].get("event_type") == "email.delivered"
    assert events[0].get("recipient_email") == "user@example.com"
    assert events[0].get("request_id") == "req_abc"


def test_webhook_invalid_signature_returns_400(client, fake_db, monkeypatch):
    """POST with bad signature; verify 400 and no Firestore write."""
    from models.database import Collections  # noqa: E402

    monkeypatch.setenv("EMAILIT_WEBHOOK_SECRET", "real_secret")
    payload = {"event_type": "email.delivered", "email": "u@x.com"}
    body = json.dumps(payload).encode("utf-8")
    bad_sig = "invalid_hex_signature"

    resp = client.post(
        "/api/webhooks/emailit",
        data=body,
        content_type="application/json",
        headers={"X-Emailit-Signature": bad_sig},
    )
    assert resp.status_code == 400
    assert "Invalid signature" in (resp.get_json() or {}).get("error", "")

    assert len(fake_db.collection(Collections.EMAIL_EVENTS)._docs) == 0


def test_bounced_email_skips_send(monkeypatch, fake_db):
    """Mark recipient as bounced; send_reminder should skip the API call and return bounced error."""
    import requests  # noqa: E402
    from utils import email_service  # noqa: E402
    from models.database import Collections  # noqa: E402
    from unittest.mock import patch  # noqa: E402

    def _get_db():
        return fake_db
    monkeypatch.setattr(email_service, "get_db", _get_db)

    bounced_email = "bounced@example.com"
    fake_db.collection(Collections.BOUNCED_EMAILS).document(bounced_email.lower()).set({
        "email": bounced_email.lower(),
        "bounced_at": "2025-01-01T00:00:00Z",
        "reason": "hard bounce",
    })

    with patch.object(requests, "post") as mock_post:
        result = email_service.EmailService.send_reminder(
            "req_1", "Form Title", "https://form.url", bounced_email, owner_id="owner_1"
        )

    assert result.get("success") is False
    assert result.get("bounced") is True
    assert "bounced" in (result.get("error") or "").lower()
    assert not mock_post.called, "API should not be called for a bounced recipient"


# ============= BATCH TESTS =============

def _make_recipients(emails: list, request_id: str = "req_1") -> list:
    return [
        {
            "request_id": request_id,
            "form_title": "Test Form",
            "form_url": "https://forms.google.com/test",
            "recipient_email": email,
            "owner_id": "owner_1",
        }
        for email in emails
    ]


def test_batch_sends_all_recipients(monkeypatch, fake_db):
    """All recipients in the batch are attempted and tracked correctly."""
    import requests  # noqa: E402
    from utils import email_service  # noqa: E402
    from unittest.mock import MagicMock, patch  # noqa: E402

    monkeypatch.setenv("EMAILIT_API_KEY", "test_key")
    monkeypatch.setenv("EMAILIT_FROM_ADDRESS", "from@test.com")

    def _get_db():
        return fake_db
    monkeypatch.setattr(email_service, "get_db", _get_db)

    mock_response = MagicMock()
    mock_response.status_code = 201

    emails = ["a@test.com", "b@test.com", "c@test.com"]

    with patch.object(requests, "post", return_value=mock_response):
        summary = email_service.EmailService.send_reminders_batch(
            _make_recipients(emails), batch_size=10
        )

    assert set(summary["sent"]) == set(emails)
    assert summary["failed"] == []
    assert summary["not_attempted"] == []
    assert summary["emailit_rate_limited"] is False


def test_batch_stops_on_emailit_429(monkeypatch, fake_db):
    """When Emailit returns 429 mid-batch, remaining recipients land in not_attempted."""
    import requests  # noqa: E402
    from utils import email_service  # noqa: E402
    from unittest.mock import MagicMock, patch  # noqa: E402

    monkeypatch.setenv("EMAILIT_API_KEY", "test_key")
    monkeypatch.setenv("EMAILIT_FROM_ADDRESS", "from@test.com")

    def _get_db():
        return fake_db
    monkeypatch.setattr(email_service, "get_db", _get_db)

    # First batch of 2 succeeds; second batch of 2 hits 429.
    ok_response = MagicMock()
    ok_response.status_code = 201

    rate_limited_response = MagicMock()
    rate_limited_response.status_code = 429

    call_count = {"n": 0}

    def _post_side_effect(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] <= 2:
            return ok_response
        return rate_limited_response

    emails = ["a@test.com", "b@test.com", "c@test.com", "d@test.com"]

    with patch.object(requests, "post", side_effect=_post_side_effect):
        summary = email_service.EmailService.send_reminders_batch(
            _make_recipients(emails), batch_size=2
        )

    assert summary["emailit_rate_limited"] is True
    assert len(summary["sent"]) == 2
    # The two emails in the rate-limited batch are in failed; the next batch
    # (if any) lands in not_attempted.
    assert len(summary["sent"]) + len(summary["failed"]) + len(summary["not_attempted"]) == 4


def test_batch_isolates_per_recipient_failures(monkeypatch, fake_db):
    """A failure for one recipient does not prevent others from being sent."""
    import requests  # noqa: E402
    from utils import email_service  # noqa: E402
    from unittest.mock import MagicMock, patch  # noqa: E402

    monkeypatch.setenv("EMAILIT_API_KEY", "test_key")
    monkeypatch.setenv("EMAILIT_FROM_ADDRESS", "from@test.com")

    def _get_db():
        return fake_db
    monkeypatch.setattr(email_service, "get_db", _get_db)

    ok_response = MagicMock()
    ok_response.status_code = 201

    error_response = MagicMock()
    error_response.status_code = 422
    error_response.text = "Invalid address"

    # Alternate: first succeeds, second fails, third succeeds.
    responses = [ok_response, error_response, ok_response]
    response_iter = iter(responses)

    def _post_side_effect(*args, **kwargs):
        return next(response_iter)

    emails = ["good1@test.com", "bad@test.com", "good2@test.com"]

    with patch.object(requests, "post", side_effect=_post_side_effect):
        summary = email_service.EmailService.send_reminders_batch(
            _make_recipients(emails), batch_size=10
        )

    assert len(summary["sent"]) == 2
    assert len(summary["failed"]) == 1
    assert summary["emailit_rate_limited"] is False
