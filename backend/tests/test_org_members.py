"""
Unit tests for the OrgMember model and sub-user org-member routes.

These tests use FakeFirestore so no real database connection is needed.
Run with:  pytest tests/test_org_members.py -v
"""
import os
import sys
import json

import pytest

THIS_DIR = os.path.dirname(__file__)
BACKEND_APP_DIR = os.path.abspath(os.path.join(THIS_DIR, "..", "app"))
sys.path.insert(0, BACKEND_APP_DIR)

from fake_firestore import FakeFirestore  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def fake_db():
    return FakeFirestore()


@pytest.fixture
def flask_app(fake_db, monkeypatch):
    import app as app_module
    import models.database as db_module
    import models.org_member as om_module
    import models.user as user_module
    import models.group as group_module
    import models.org_membership as oms_module
    import models.opt_out_event as ooe_module
    import utils.email_service as email_module

    def _get_db():
        return fake_db

    # Patch every module that imports get_db directly so all DB reads/writes
    # go through the same FakeFirestore instance.
    for mod in (app_module, db_module, om_module, user_module, group_module,
                oms_module, ooe_module, email_module):
        try:
            monkeypatch.setattr(mod, "get_db", _get_db, raising=True)
        except AttributeError:
            pass

    import config as config_module
    config_module.settings.SECRET_KEY = "test_secret"
    config_module.settings.BACKEND_PUBLIC_URL = "http://localhost:5000"
    config_module.settings.FRONTEND_URL = "http://localhost:5173"
    app_module.app.secret_key = config_module.settings.SECRET_KEY
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


def _seed_user(fake_db, user_id: str, username: str, email: str, password_hash: str = "hash"):
    """Write a minimal user document directly into FakeFirestore."""
    from models.database import Collections
    fake_db.collection(Collections.USERS).document(user_id).set({
        "username": username,
        "email": email,
        "password_hash": password_hash,
        "google_access_token": None,
        "google_refresh_token": None,
        "token_expiry": None,
        "created_at": "2025-01-01T00:00:00Z",
    })


def _login(client, fake_db, user_id: str, username: str, email: str):
    """Seed a user and inject their session directly."""
    _seed_user(fake_db, user_id, username, email)
    with client.session_transaction() as sess:
        sess["user_id"] = user_id


# ---------------------------------------------------------------------------
# OrgMember model unit tests
# ---------------------------------------------------------------------------

class TestOrgMemberModel:

    def test_create_active_returns_active_membership(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        member = OrgMember.create_active(
            org_id="owner_1",
            member_user_id="sub_1",
            role=OrgMember.ROLE_MANAGER,
            invited_by="owner_1",
        )

        assert member.status == OrgMember.STATUS_ACTIVE
        assert member.role == OrgMember.ROLE_MANAGER
        assert member.member_user_id == "sub_1"
        assert member.org_id == "owner_1"

    def test_create_invite_returns_pending_membership(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        member = OrgMember.create_invite(
            org_id="owner_1",
            invite_email="sub@test.com",
            role=OrgMember.ROLE_ADMIN,
            invited_by="owner_1",
        )

        assert member.status == OrgMember.STATUS_PENDING
        assert member.invite_email == "sub@test.com"
        assert len(member.invite_token) == 32

    def test_get_by_token_returns_correct_record(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        created = OrgMember.create_invite(
            org_id="owner_1",
            invite_email="sub@test.com",
            role=OrgMember.ROLE_MANAGER,
            invited_by="owner_1",
        )
        found = OrgMember.get_by_token(created.invite_token)

        assert found is not None
        assert found.id == created.id
        assert found.invite_email == "sub@test.com"

    def test_accept_transitions_to_active(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        pending = OrgMember.create_invite(
            org_id="owner_1",
            invite_email="sub@test.com",
            role=OrgMember.ROLE_MANAGER,
            invited_by="owner_1",
        )
        result = pending.accept("sub_user_1")

        assert result is True
        assert pending.status == OrgMember.STATUS_ACTIVE
        assert pending.member_user_id == "sub_user_1"
        assert pending.joined_at is not None

    def test_accept_is_idempotent_returns_false(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        member = OrgMember.create_active("o1", "m1", OrgMember.ROLE_MANAGER, "o1")
        assert member.accept("m1") is False

    def test_update_role(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        member = OrgMember.create_active("o1", "m1", OrgMember.ROLE_MANAGER, "o1")
        assert member.update_role(OrgMember.ROLE_ADMIN) is True
        assert member.role == OrgMember.ROLE_ADMIN

    def test_update_role_rejects_invalid_value(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        member = OrgMember.create_active("o1", "m1", OrgMember.ROLE_MANAGER, "o1")
        assert member.update_role("superadmin") is False

    def test_add_and_remove_assignment(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        member = OrgMember.create_active("o1", "m1", OrgMember.ROLE_MANAGER, "o1")
        member.add_assignment("group", "grp_1")
        assert member.has_assignment("group", "grp_1") is True

        member.remove_assignment("group", "grp_1")
        assert member.has_assignment("group", "grp_1") is False

    def test_add_assignment_is_idempotent(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        member = OrgMember.create_active("o1", "m1", OrgMember.ROLE_MANAGER, "o1")
        member.add_assignment("group", "grp_1")
        member.add_assignment("group", "grp_1")
        assert len(member.assignments) == 1

    def test_remove_nonexistent_assignment_returns_false(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        member = OrgMember.create_active("o1", "m1", OrgMember.ROLE_MANAGER, "o1")
        assert member.remove_assignment("group", "does_not_exist") is False

    def test_get_org_members(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        OrgMember.create_active("o1", "m1", OrgMember.ROLE_MANAGER, "o1")
        OrgMember.create_active("o1", "m2", OrgMember.ROLE_ADMIN, "o1")
        OrgMember.create_active("o2", "m1", OrgMember.ROLE_MANAGER, "o2")  # different org

        members = OrgMember.get_org_members("o1")
        assert len(members) == 2

    def test_get_user_memberships(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        OrgMember.create_active("o1", "m1", OrgMember.ROLE_MANAGER, "o1")
        OrgMember.create_active("o2", "m1", OrgMember.ROLE_ADMIN, "o2")

        memberships = OrgMember.get_user_memberships("m1")
        org_ids = {m.org_id for m in memberships}
        assert "o1" in org_ids
        assert "o2" in org_ids

    def test_remove_deletes_document(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        member = OrgMember.create_active("o1", "m1", OrgMember.ROLE_MANAGER, "o1")
        assert member.remove() is True
        assert OrgMember.get_membership("o1", "m1") is None


# ---------------------------------------------------------------------------
# Permission (can_perform) tests
# ---------------------------------------------------------------------------

class TestOrgMemberPermissions:

    def _make_member(self, role, fake_db, monkeypatch, assignments=None):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        member = OrgMember.create_active("o1", "m1", role, "o1")
        for a in (assignments or []):
            member.add_assignment(a["resource_type"], a["resource_id"])
        return member

    def test_admin_can_view_assigned_resource(self, fake_db, monkeypatch):
        from models.org_member import OrgMember
        member = self._make_member(
            OrgMember.ROLE_ADMIN, fake_db, monkeypatch,
            [{"resource_type": "form_request", "resource_id": "fr_1"}],
        )
        assert member.can_perform("view", "form_request", "fr_1") is True

    def test_admin_can_delete_assigned_resource(self, fake_db, monkeypatch):
        from models.org_member import OrgMember
        member = self._make_member(
            OrgMember.ROLE_ADMIN, fake_db, monkeypatch,
            [{"resource_type": "form_request", "resource_id": "fr_1"}],
        )
        assert member.can_perform("delete", "form_request", "fr_1") is True

    def test_admin_cannot_access_unassigned_resource(self, fake_db, monkeypatch):
        from models.org_member import OrgMember
        member = self._make_member(OrgMember.ROLE_ADMIN, fake_db, monkeypatch)
        assert member.can_perform("view", "form_request", "fr_unassigned") is False

    def test_manager_can_send_reminder_on_assigned(self, fake_db, monkeypatch):
        from models.org_member import OrgMember
        member = self._make_member(
            OrgMember.ROLE_MANAGER, fake_db, monkeypatch,
            [{"resource_type": "form_request", "resource_id": "fr_1"}],
        )
        assert member.can_perform("send_reminder", "form_request", "fr_1") is True

    def test_manager_cannot_delete(self, fake_db, monkeypatch):
        from models.org_member import OrgMember
        member = self._make_member(
            OrgMember.ROLE_MANAGER, fake_db, monkeypatch,
            [{"resource_type": "form_request", "resource_id": "fr_1"}],
        )
        assert member.can_perform("delete", "form_request", "fr_1") is False

    def test_manager_cannot_create(self, fake_db, monkeypatch):
        from models.org_member import OrgMember
        member = self._make_member(OrgMember.ROLE_MANAGER, fake_db, monkeypatch)
        assert member.can_perform("create", "form_request", "") is False

    def test_pending_member_cannot_perform_any_action(self, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        pending = OrgMember.create_invite("o1", "sub@test.com", OrgMember.ROLE_ADMIN, "o1")
        pending.assignments = [{"resource_type": "form_request", "resource_id": "fr_1"}]
        assert pending.can_perform("view", "form_request", "fr_1") is False


# ---------------------------------------------------------------------------
# Route tests
# ---------------------------------------------------------------------------

class TestOrgMemberRoutes:

    def test_list_members_returns_empty_for_new_org(self, client, fake_db):
        _login(client, fake_db, "owner_1", "owner", "owner@test.com")
        resp = client.get("/api/org/members", headers={"Cookie": ""})
        assert resp.status_code == 200
        assert resp.get_json()["members"] == []

    def test_manual_add_member(self, client, fake_db):
        _login(client, fake_db, "owner_1", "owner", "owner@test.com")
        _seed_user(fake_db, "sub_1", "subuser", "sub@test.com")

        resp = client.post(
            "/api/org/members",
            json={"email": "sub@test.com", "role": "manager"},
            content_type="application/json",
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["success"] is True
        assert body["member"]["role"] == "manager"
        assert body["member"]["status"] == "active"

    def test_manual_add_nonexistent_user_returns_404(self, client, fake_db):
        _login(client, fake_db, "owner_1", "owner", "owner@test.com")

        resp = client.post(
            "/api/org/members",
            json={"email": "ghost@test.com", "role": "manager"},
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_manual_add_self_returns_400(self, client, fake_db):
        _login(client, fake_db, "owner_1", "owner", "owner@test.com")

        resp = client.post(
            "/api/org/members",
            json={"email": "owner@test.com", "role": "manager"},
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_manual_add_invalid_role_returns_400(self, client, fake_db):
        _login(client, fake_db, "owner_1", "owner", "owner@test.com")
        _seed_user(fake_db, "sub_1", "subuser", "sub@test.com")

        resp = client.post(
            "/api/org/members",
            json={"email": "sub@test.com", "role": "superadmin"},
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_update_role(self, client, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        _login(client, fake_db, "owner_1", "owner", "owner@test.com")
        _seed_user(fake_db, "sub_1", "subuser", "sub@test.com")
        OrgMember.create_active("owner_1", "sub_1", OrgMember.ROLE_MANAGER, "owner_1")

        resp = client.put(
            "/api/org/members/sub_1",
            json={"role": "admin"},
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["member"]["role"] == "admin"

    def test_remove_member(self, client, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        _login(client, fake_db, "owner_1", "owner", "owner@test.com")
        _seed_user(fake_db, "sub_1", "subuser", "sub@test.com")
        OrgMember.create_active("owner_1", "sub_1", OrgMember.ROLE_MANAGER, "owner_1")

        resp = client.delete("/api/org/members/sub_1")
        assert resp.status_code == 200
        assert OrgMember.get_membership("owner_1", "sub_1") is None

    def test_add_assignment(self, client, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        _login(client, fake_db, "owner_1", "owner", "owner@test.com")
        _seed_user(fake_db, "sub_1", "subuser", "sub@test.com")
        OrgMember.create_active("owner_1", "sub_1", OrgMember.ROLE_MANAGER, "owner_1")

        resp = client.post(
            "/api/org/members/sub_1/assignments",
            json={"resource_type": "form_request", "resource_id": "fr_1"},
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert any(
            a["resource_id"] == "fr_1"
            for a in resp.get_json()["assignments"]
        )

    def test_remove_assignment(self, client, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        _login(client, fake_db, "owner_1", "owner", "owner@test.com")
        _seed_user(fake_db, "sub_1", "subuser", "sub@test.com")
        member = OrgMember.create_active("owner_1", "sub_1", OrgMember.ROLE_MANAGER, "owner_1")
        member.add_assignment("form_request", "fr_1")

        resp = client.delete("/api/org/members/sub_1/assignments/form_request/fr_1")
        assert resp.status_code == 200
        assert resp.get_json()["assignments"] == []

    def test_accept_invite(self, client, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        # Owner creates invite
        _seed_user(fake_db, "owner_1", "owner", "owner@test.com")
        pending = OrgMember.create_invite("owner_1", "sub@test.com", OrgMember.ROLE_MANAGER, "owner_1")

        # Sub-user logs in and accepts
        _login(client, fake_db, "sub_1", "subuser", "sub@test.com")
        resp = client.post(
            "/api/org/invite/accept",
            json={"token": pending.invite_token},
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

    def test_accept_invite_wrong_email_returns_403(self, client, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        _seed_user(fake_db, "owner_1", "owner", "owner@test.com")
        pending = OrgMember.create_invite("owner_1", "correct@test.com", OrgMember.ROLE_MANAGER, "owner_1")

        # Wrong user tries to accept
        _login(client, fake_db, "wrong_1", "wronguser", "wrong@test.com")
        resp = client.post(
            "/api/org/invite/accept",
            json={"token": pending.invite_token},
            content_type="application/json",
        )
        assert resp.status_code == 403

    def test_accept_already_accepted_invite_returns_409(self, client, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        _seed_user(fake_db, "owner_1", "owner", "owner@test.com")
        member = OrgMember.create_active("owner_1", "sub_1", OrgMember.ROLE_MANAGER, "owner_1")

        _login(client, fake_db, "sub_1", "subuser", "sub@test.com")
        resp = client.post(
            "/api/org/invite/accept",
            json={"token": member.invite_token},
            content_type="application/json",
        )
        assert resp.status_code == 409

    def test_list_my_organizations(self, client, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        _seed_user(fake_db, "owner_1", "owner1", "owner1@test.com")
        _seed_user(fake_db, "owner_2", "owner2", "owner2@test.com")
        OrgMember.create_active("owner_1", "sub_1", OrgMember.ROLE_MANAGER, "owner_1")
        OrgMember.create_active("owner_2", "sub_1", OrgMember.ROLE_ADMIN, "owner_2")

        _login(client, fake_db, "sub_1", "subuser", "sub@test.com")
        resp = client.get("/api/my-organizations")
        assert resp.status_code == 200
        orgs = resp.get_json()["organizations"]
        assert len(orgs) == 2

    def test_get_my_assignments(self, client, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        _seed_user(fake_db, "owner_1", "owner", "owner@test.com")
        member = OrgMember.create_active("owner_1", "sub_1", OrgMember.ROLE_MANAGER, "owner_1")
        member.add_assignment("form_request", "fr_42")

        _login(client, fake_db, "sub_1", "subuser", "sub@test.com")
        resp = client.get("/api/my-organizations/owner_1/assignments")
        assert resp.status_code == 200
        data = resp.get_json()
        assert any(a["resource_id"] == "fr_42" for a in data["assignments"])

    def test_non_member_get_assignments_returns_403(self, client, fake_db):
        _login(client, fake_db, "stranger_1", "stranger", "stranger@test.com")
        resp = client.get("/api/my-organizations/owner_1/assignments")
        assert resp.status_code == 403

    def test_get_invite_details_public_no_auth(self, client, fake_db, monkeypatch):
        import models.org_member as om_module
        monkeypatch.setattr(om_module, "get_db", lambda: fake_db)
        from models.org_member import OrgMember

        _seed_user(fake_db, "owner_1", "owner", "owner@test.com")
        pending = OrgMember.create_invite("owner_1", "sub@test.com", OrgMember.ROLE_MANAGER, "owner_1")

        # No session — public endpoint
        resp = client.get(f"/api/org/invite/{pending.invite_token}")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["role"] == "manager"
        assert body["invite_email"] == "sub@test.com"

    def test_unauthenticated_requests_return_401(self, client, fake_db):
        for method, url in [
            ("get",    "/api/org/members"),
            ("post",   "/api/org/members"),
            ("post",   "/api/org/invite"),
            ("delete", "/api/org/members/some_id"),
            ("get",    "/api/my-organizations"),
        ]:
            resp = getattr(client, method)(url)
            assert resp.status_code == 401, f"{method.upper()} {url} should return 401"
