import os
import sys
from urllib.parse import urlparse, parse_qs

import pytest

THIS_DIR = os.path.dirname(__file__)
BACKEND_APP_DIR = os.path.abspath(os.path.join(THIS_DIR, "..", "app"))
sys.path.insert(0, BACKEND_APP_DIR)

from fake_firestore import FakeFirestore  # noqa: E402


@pytest.fixture()
def fake_db():
    return FakeFirestore()


@pytest.fixture()
def flask_app(fake_db, monkeypatch):
    import app as app_module  # noqa: E402

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

    import models.opt_out_event as ooe_module  # noqa: E402
    monkeypatch.setattr(ooe_module, "get_db", _get_db, raising=True)

    import utils.email_service as email_module  # noqa: E402
    monkeypatch.setattr(email_module, "get_db", _get_db, raising=True)

    import config as config_module  # noqa: E402
    config_module.settings.SECRET_KEY = "test_secret"
    config_module.settings.BACKEND_PUBLIC_URL = "http://localhost:5000"
    app_module.app.secret_key = config_module.settings.SECRET_KEY

    return app_module.app


@pytest.fixture()
def client(flask_app):
    return flask_app.test_client()


def test_opt_out_via_email_link_logs_event(client, fake_db):
    from models.database import Collections
    from utils.email_service import EmailService

    resp = client.post(
        "/api/register",
        json={"username": "john", "email": "john@example.com", "password": "1234567"},
    )
    assert resp.status_code == 201
    owner_id = resp.get_json()["user"]["id"]

    resp = client.post("/api/groups", json={"name": "Group A", "description": ""})
    assert resp.status_code == 201
    invite_token = resp.get_json()["group"]["invite_token"]
    recipient_email = "recipient@example.com"
    resp = client.post(f"/api/groups/join/{invite_token}", json={"email": recipient_email})
    assert resp.status_code == 200

    unsubscribe_url = EmailService.build_unsubscribe_url(owner_id, recipient_email)
    parsed = urlparse(unsubscribe_url)
    qs = parse_qs(parsed.query)
    token = qs["token"][0]

    resp = client.get(f"/api/organizations/{owner_id}/leave?email={recipient_email}&token={token}")
    assert resp.status_code == 200

    coll = fake_db.collection(Collections.OPT_OUT_EVENTS)
    events = list(coll._docs.values())
    assert len(events) == 1
    assert events[0].get("event_type") == "opted_out"
    assert events[0].get("performed_by") == "recipient"
    assert events[0].get("source") == "email_link"
    assert events[0].get("recipient_email") == recipient_email
    assert events[0].get("owner_id") == owner_id


def test_leave_group_logs_event(client, fake_db):
    from models.database import Collections

    resp = client.post(
        "/api/register",
        json={"username": "owner", "email": "owner@example.com", "password": "1234567"},
    )
    assert resp.status_code == 201
    owner_id = resp.get_json()["user"]["id"]

    resp = client.post("/api/groups", json={"name": "My Group", "description": ""})
    assert resp.status_code == 201
    group = resp.get_json()["group"]
    group_id = group["id"]
    group_name = group["name"]
    invite_token = group["invite_token"]

    member_email = "member@example.com"
    resp = client.post(f"/api/groups/join/{invite_token}", json={"email": member_email})
    assert resp.status_code == 200

    resp = client.delete(f"/api/groups/{group_id}/members/{member_email}")
    assert resp.status_code == 200

    coll = fake_db.collection(Collections.OPT_OUT_EVENTS)
    events = list(coll._docs.values())
    assert len(events) == 1
    assert events[0].get("event_type") == "left_group"
    assert events[0].get("performed_by") == "owner"
    assert events[0].get("source") == "owner_dashboard"
    assert events[0].get("group_id") == group_id
    assert events[0].get("group_name") == group_name
    assert events[0].get("recipient_email") == member_email


def test_owner_resubscribe_clears_opt_out_and_logs_event(client, fake_db):
    from models.database import Collections
    from models.org_membership import OrgMembership
    from utils.email_service import EmailService

    resp = client.post(
        "/api/register",
        json={"username": "owner", "email": "owner@example.com", "password": "1234567"},
    )
    assert resp.status_code == 201
    owner_id = resp.get_json()["user"]["id"]

    resp = client.post("/api/groups", json={"name": "G", "description": ""})
    assert resp.status_code == 201
    invite_token = resp.get_json()["group"]["invite_token"]
    recipient_email = "user@example.com"
    resp = client.post(f"/api/groups/join/{invite_token}", json={"email": recipient_email})
    assert resp.status_code == 200

    url = EmailService.build_unsubscribe_url(owner_id, recipient_email)
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    token = qs["token"][0]
    resp = client.get(f"/api/organizations/{owner_id}/leave?email={recipient_email}&token={token}")
    assert resp.status_code == 200
    assert OrgMembership.is_opted_out(owner_id, recipient_email) is True

    resp = client.post(
        f"/api/organizations/{owner_id}/resubscribe",
        json={"email": recipient_email},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body.get("success") is True
    assert body.get("email") == recipient_email
    assert body.get("status") == "active"
    assert OrgMembership.is_opted_out(owner_id, recipient_email) is False

    from models.opt_out_event import OptOutEvent
    events = OptOutEvent.get_events_for_owner(owner_id)
    added_back = [e for e in events if e.event_type == "added_back_by_owner"]
    assert len(added_back) == 1
    assert added_back[0].performed_by == "owner"
    assert added_back[0].source == "owner_dashboard"


def test_resubscribe_fails_if_not_opted_out(client, fake_db):
    resp = client.post(
        "/api/register",
        json={"username": "owner", "email": "owner@example.com", "password": "1234567"},
    )
    assert resp.status_code == 201
    owner_id = resp.get_json()["user"]["id"]

    recipient_email = "never_opted_out@example.com"
    resp = client.post(
        f"/api/organizations/{owner_id}/resubscribe",
        json={"email": recipient_email},
    )
    assert resp.status_code == 400
    assert "not opted out" in (resp.get_json().get("error", "")).lower()


def test_get_events_for_owner_returns_events(client, fake_db):
    from models.database import Collections
    from models.opt_out_event import OptOutEvent
    from utils.email_service import EmailService

    resp = client.post(
        "/api/register",
        json={"username": "owner", "email": "owner@example.com", "password": "1234567"},
    )
    assert resp.status_code == 201
    owner_id = resp.get_json()["user"]["id"]

    resp = client.post("/api/groups", json={"name": "G", "description": ""})
    assert resp.status_code == 201
    invite_token = resp.get_json()["group"]["invite_token"]
    recipient_email = "r@example.com"
    resp = client.post(f"/api/groups/join/{invite_token}", json={"email": recipient_email})
    assert resp.status_code == 200

    url = EmailService.build_unsubscribe_url(owner_id, recipient_email)
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    token = qs["token"][0]
    resp = client.get(f"/api/organizations/{owner_id}/leave?email={recipient_email}&token={token}")
    assert resp.status_code == 200

    resp = client.get(f"/api/organizations/{owner_id}/opt-out-events")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "events" in data
    events = data["events"]
    assert len(events) >= 1
    opted_out_events = [e for e in events if e.get("event_type") == "opted_out"]
    assert len(opted_out_events) == 1
    assert opted_out_events[0].get("recipient_email") == recipient_email
    assert opted_out_events[0].get("owner_id") == owner_id
    assert "id" in opted_out_events[0]
    assert "timestamp" in opted_out_events[0]
