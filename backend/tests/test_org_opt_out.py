import os
import sys
from urllib.parse import urlparse, parse_qs

import pytest


# Ensure backend/app is importable (it contains app.py, models/, utils/, etc.)
THIS_DIR = os.path.dirname(__file__)
BACKEND_APP_DIR = os.path.abspath(os.path.join(THIS_DIR, "..", "app"))
sys.path.insert(0, BACKEND_APP_DIR)


from fake_firestore import FakeFirestore  # noqa: E402


@pytest.fixture()
def fake_db():
    return FakeFirestore()


@pytest.fixture()
def flask_app(fake_db, monkeypatch):
    # Import here so the sys.path tweak above is in effect.
    import app as app_module  # noqa: E402

    # Patch all get_db bindings used by the code paths we test.
    def _get_db():
        return fake_db

    monkeypatch.setattr(app_module, "get_db", _get_db, raising=True)

    import models.database as db_module  # noqa: E402
    monkeypatch.setattr(db_module, "get_db", _get_db, raising=True)

    import models.user as user_module  # noqa: E402
    monkeypatch.setattr(user_module, "get_db", _get_db, raising=True)

    import models.group as group_module  # noqa: E402
    monkeypatch.setattr(group_module, "get_db", _get_db, raising=True)

    import models.org_membership as om_module  # noqa: E402
    monkeypatch.setattr(om_module, "get_db", _get_db, raising=True)

    import utils.email_service as email_module  # noqa: E402
    monkeypatch.setattr(email_module, "get_db", _get_db, raising=True)

    # Make secrets deterministic for token checks.
    import config as config_module  # noqa: E402
    config_module.settings.SECRET_KEY = "test_secret"
    config_module.settings.BACKEND_PUBLIC_URL = "http://localhost:5000"
    app_module.app.secret_key = config_module.settings.SECRET_KEY

    return app_module.app


@pytest.fixture()
def client(flask_app):
    return flask_app.test_client()


def test_recipient_leave_org_opt_out_removes_from_groups_and_suppresses(client, fake_db):
    # Register and implicitly log in as org owner "john"
    resp = client.post(
        "/api/register",
        json={"username": "john", "email": "john@example.com", "password": "1234567"},
    )
    assert resp.status_code == 201
    owner_id = resp.get_json()["user"]["id"]

    # Create a group owned by john
    resp = client.post("/api/groups", json={"name": "Group A", "description": ""})
    assert resp.status_code == 201
    group = resp.get_json()["group"]
    group_id = group["id"]
    invite_token = group["invite_token"]

    # Public join (recipient becomes a member)
    recipient_email = "recipient@example.com"
    resp = client.post(f"/api/groups/join/{invite_token}", json={"email": recipient_email})
    assert resp.status_code == 200

    # Confirm membership exists in group
    resp = client.get(f"/api/groups/{group_id}")
    assert resp.status_code == 200
    members = resp.get_json()["group"]["members"]
    assert any(m["email"].lower() == recipient_email for m in members)

    # Build signed unsubscribe URL and hit leave endpoint
    from utils.email_service import EmailService  # imported after path setup

    unsubscribe_url = EmailService.build_unsubscribe_url(owner_id, recipient_email)
    parsed = urlparse(unsubscribe_url)
    qs = parse_qs(parsed.query)
    token = qs["token"][0]

    resp = client.get(f"/api/organizations/{owner_id}/leave?email={recipient_email}&token={token}")
    assert resp.status_code == 200

    # Group membership removed
    resp = client.get(f"/api/groups/{group_id}")
    assert resp.status_code == 200
    members = resp.get_json()["group"]["members"]
    assert all(m["email"].lower() != recipient_email for m in members)

    # Org membership marked left
    from models.org_membership import OrgMembership

    m = OrgMembership.get(owner_id, recipient_email)
    assert m is not None
    assert m.status == "left"

    # Owner cannot re-add opted-out recipient
    resp = client.post(f"/api/groups/{group_id}/members", json={"emails": recipient_email})
    assert resp.status_code == 200
    body = resp.get_json()
    assert recipient_email in body.get("skipped_opted_out", [])

    # Create a minimal form request doc directly in fake db to test suppression on send
    from models.database import Collections

    fake_db.collection(Collections.FORM_REQUESTS).document("req1").set(
        {
            "owner_id": owner_id,
            "group_id": group_id,
            "title": "Test Form",
            "form_url": "https://example.com/form",
        }
    )

    resp = client.post(f"/api/form-requests/req1/send-reminder/{recipient_email}")
    assert resp.status_code == 400
    assert "opted out" in (resp.get_json().get("error", "").lower())

