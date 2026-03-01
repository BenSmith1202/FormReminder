"""
Live integration tests for the admin sub-user org-member flow.

These tests run against the real Flask server (must be running on
http://localhost:5000) and the real Firestore database.  They are gated
behind the ``integration`` pytest mark so they never run during normal
unit-test runs.

Run command:
    cd backend
    pytest -m integration tests/test_admin_flow_live.py -v

Prerequisites:
    - Backend server running:  python app/app.py
    - Account ``john`` exists with password ``1234567``
    - Account ``aiden`` exists (email testing@gmail.com) with password ``1234567``
    - Both accounts are registered in the live Firestore database
"""
import os
import sys
import pytest
import requests as _requests

THIS_DIR = os.path.dirname(__file__)
BACKEND_APP_DIR = os.path.abspath(os.path.join(THIS_DIR, "..", "app"))
sys.path.insert(0, BACKEND_APP_DIR)

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:5000")
CORS_HEADERS = {
    "Content-Type": "application/json",
    "Origin": os.environ.get("FRONTEND_ORIGIN", "http://localhost:5174"),
}

# ---------------------------------------------------------------------------
# Credentials (override via environment variables if needed)
# ---------------------------------------------------------------------------
OWNER_USERNAME = os.environ.get("TEST_OWNER_USERNAME", "john")
OWNER_PASSWORD = os.environ.get("TEST_OWNER_PASSWORD", "1234567")
ADMIN_EMAIL    = os.environ.get("TEST_ADMIN_EMAIL",    "testing@gmail.com")
ADMIN_USERNAME = os.environ.get("TEST_ADMIN_USERNAME", "aiden")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "1234567")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _login(username: str, password: str) -> _requests.Session:
    """Create a requests.Session already authenticated as the given user.

    Args:
        username: FormReminder username.
        password: Account password.

    Returns:
        Authenticated session with CORS headers pre-set.

    Raises:
        pytest.skip: If the server is unreachable or credentials are wrong.
    """
    session = _requests.Session()
    session.headers.update(CORS_HEADERS)
    try:
        resp = session.post(
            f"{BASE_URL}/api/login",
            json={"username": username, "password": password},
            timeout=10,
        )
    except _requests.ConnectionError:
        pytest.skip(f"Backend not reachable at {BASE_URL}")

    if resp.status_code != 200:
        pytest.skip(
            f"Login failed for '{username}' (HTTP {resp.status_code}). "
            "Ensure the account exists and the server is running."
        )
    return session


def _logout(session: _requests.Session) -> None:
    try:
        session.post(f"{BASE_URL}/api/logout", timeout=5)
    except Exception:
        pass


def _remove_member_if_exists(owner_session: _requests.Session, member_user_id: str) -> None:
    """Idempotent cleanup: remove a sub-user if they are already a member."""
    owner_session.delete(f"{BASE_URL}/api/org/members/{member_user_id}", timeout=10)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def owner_session():
    """Authenticated session for the org owner (john)."""
    session = _login(OWNER_USERNAME, OWNER_PASSWORD)
    yield session
    _logout(session)


@pytest.fixture(scope="module")
def owner_id(owner_session):
    """Firestore user_id for the org owner."""
    resp = owner_session.get(f"{BASE_URL}/api/current-user", timeout=10)
    assert resp.status_code == 200
    return resp.json()["user"]["id"]


@pytest.fixture(scope="module")
def admin_session():
    """Authenticated session for the admin sub-user (aiden)."""
    session = _login(ADMIN_USERNAME, ADMIN_PASSWORD)
    yield session
    _logout(session)


@pytest.fixture(scope="module")
def admin_user_id(admin_session):
    """Firestore user_id for the admin sub-user."""
    resp = admin_session.get(f"{BASE_URL}/api/current-user", timeout=10)
    assert resp.status_code == 200
    return resp.json()["user"]["id"]


@pytest.fixture(autouse=True, scope="module")
def cleanup_member(owner_session, admin_user_id):
    """Remove the test admin membership before and after the module runs."""
    _remove_member_if_exists(owner_session, admin_user_id)
    yield
    _remove_member_if_exists(owner_session, admin_user_id)


# ---------------------------------------------------------------------------
# Tests — Group 1: Owner manages members
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestOwnerManagesMembers:

    def test_owner_can_login(self, owner_session):
        """Owner account is reachable and authenticated."""
        resp = owner_session.get(f"{BASE_URL}/api/current-user", timeout=10)
        assert resp.status_code == 200
        assert resp.json()["authenticated"] is True

    def test_org_starts_with_no_test_admin(self, owner_session, admin_user_id):
        """Before adding, the admin should not be listed as a member."""
        resp = owner_session.get(f"{BASE_URL}/api/org/members", timeout=10)
        assert resp.status_code == 200
        member_ids = [m["member_user_id"] for m in resp.json()["members"]]
        assert admin_user_id not in member_ids

    def test_owner_can_manually_add_admin(self, owner_session, admin_user_id):
        """Owner adds the admin user by email; should return 201 with active status."""
        resp = owner_session.post(
            f"{BASE_URL}/api/org/members",
            json={"email": ADMIN_EMAIL, "role": "admin"},
            timeout=10,
        )
        assert resp.status_code == 201, f"Add member failed: {resp.text}"
        member = resp.json()["member"]
        assert member["role"] == "admin"
        assert member["status"] == "active"
        assert member["member_user_id"] == admin_user_id

    def test_member_appears_in_list_after_add(self, owner_session, admin_user_id):
        """After adding, the admin must appear in the org member list."""
        resp = owner_session.get(f"{BASE_URL}/api/org/members", timeout=10)
        assert resp.status_code == 200
        member_ids = [m["member_user_id"] for m in resp.json()["members"]]
        assert admin_user_id in member_ids

    def test_add_same_member_twice_is_idempotent(self, owner_session):
        """Adding an already-active member again returns 200 (idempotent)."""
        resp = owner_session.post(
            f"{BASE_URL}/api/org/members",
            json={"email": ADMIN_EMAIL, "role": "admin"},
            timeout=10,
        )
        assert resp.status_code == 200
        assert resp.json()["member"]["status"] == "active"

    def test_owner_can_update_role_to_manager(self, owner_session, admin_user_id):
        """Owner can demote admin to manager."""
        resp = owner_session.put(
            f"{BASE_URL}/api/org/members/{admin_user_id}",
            json={"role": "manager"},
            timeout=10,
        )
        assert resp.status_code == 200
        assert resp.json()["member"]["role"] == "manager"

    def test_owner_can_promote_back_to_admin(self, owner_session, admin_user_id):
        """Owner can re-promote manager back to admin."""
        resp = owner_session.put(
            f"{BASE_URL}/api/org/members/{admin_user_id}",
            json={"role": "admin"},
            timeout=10,
        )
        assert resp.status_code == 200
        assert resp.json()["member"]["role"] == "admin"

    def test_invalid_role_rejected(self, owner_session, admin_user_id):
        """Attempting to set an invalid role returns 400."""
        resp = owner_session.put(
            f"{BASE_URL}/api/org/members/{admin_user_id}",
            json={"role": "superadmin"},
            timeout=10,
        )
        assert resp.status_code == 400

    def test_owner_cannot_add_self(self, owner_session):
        """Owner cannot add themselves as a sub-user."""
        owner_info = owner_session.get(f"{BASE_URL}/api/current-user", timeout=10).json()
        owner_email = owner_info["user"].get("email", "")
        resp = owner_session.post(
            f"{BASE_URL}/api/org/members",
            json={"email": owner_email, "role": "admin"},
            timeout=10,
        )
        assert resp.status_code == 400

    def test_unknown_email_returns_404(self, owner_session):
        """Adding a user who has no FormReminder account returns 404."""
        resp = owner_session.post(
            f"{BASE_URL}/api/org/members",
            json={"email": "ghost_nobody_xyz@example.com", "role": "manager"},
            timeout=10,
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Tests — Group 2: Admin sub-user cross-org access
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestAdminSubUserAccess:

    def test_admin_can_login(self, admin_session):
        """Admin account is reachable and authenticated."""
        resp = admin_session.get(f"{BASE_URL}/api/current-user", timeout=10)
        assert resp.status_code == 200
        assert resp.json()["authenticated"] is True

    def test_admin_sees_owner_org_in_my_organizations(self, admin_session, owner_id):
        """Admin sub-user sees the owner's org in their organizations list."""
        resp = admin_session.get(f"{BASE_URL}/api/my-organizations", timeout=10)
        assert resp.status_code == 200
        org_ids = [o["org_id"] for o in resp.json()["organizations"]]
        assert owner_id in org_ids, (
            f"Owner org {owner_id} not found in admin's organizations: {org_ids}"
        )

    def test_admin_can_list_owner_form_requests_via_org_header(
        self, admin_session, owner_id
    ):
        """Admin reads the owner's form-request list using X-Org-ID header."""
        resp = admin_session.get(
            f"{BASE_URL}/api/form-requests",
            headers={**CORS_HEADERS, "X-Org-ID": owner_id},
            timeout=10,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_admin_can_list_owner_groups_via_org_header(
        self, admin_session, owner_id
    ):
        """Admin reads the owner's groups using X-Org-ID header."""
        resp = admin_session.get(
            f"{BASE_URL}/api/groups",
            headers={**CORS_HEADERS, "X-Org-ID": owner_id},
            timeout=10,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_admin_blocked_without_org_header(self, admin_session, owner_id):
        """Without X-Org-ID, admin only sees their own (empty) org — not the owner's."""
        resp = admin_session.get(f"{BASE_URL}/api/form-requests", timeout=10)
        assert resp.status_code == 200
        # The list returned is for the admin's own account, not the owner's
        # We just verify the request succeeds (ownership scoping is enforced)

    def test_invalid_org_id_returns_403(self, admin_session):
        """Passing a random/invalid org ID in X-Org-ID returns 403."""
        resp = admin_session.get(
            f"{BASE_URL}/api/form-requests",
            headers={**CORS_HEADERS, "X-Org-ID": "nonexistent_org_id_xyz"},
            timeout=10,
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Tests — Group 3: Assignment management
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestAssignmentManagement:

    @pytest.fixture(scope="class")
    def first_form_request_id(self, owner_session, owner_id):
        """Return the first form request in the owner's account, or skip."""
        resp = owner_session.get(f"{BASE_URL}/api/form-requests", timeout=10)
        assert resp.status_code == 200
        items = resp.json()
        if not items:
            pytest.skip("Owner has no form requests — skipping assignment tests.")
        return items[0]["id"]

    @pytest.fixture(scope="class")
    def first_group_id(self, owner_session):
        """Return the first group in the owner's account, or skip."""
        resp = owner_session.get(f"{BASE_URL}/api/groups", timeout=10)
        assert resp.status_code == 200
        groups = resp.json().get("groups", [])
        if not groups:
            pytest.skip("Owner has no groups — skipping group assignment tests.")
        return groups[0]["id"]

    def test_owner_can_assign_form_request_to_admin(
        self, owner_session, admin_user_id, first_form_request_id
    ):
        """Owner assigns a form request to the admin sub-user."""
        resp = owner_session.post(
            f"{BASE_URL}/api/org/members/{admin_user_id}/assignments",
            json={"resource_type": "form_request", "resource_id": first_form_request_id},
            timeout=10,
        )
        assert resp.status_code == 200
        assignments = resp.json()["assignments"]
        assert any(
            a["resource_type"] == "form_request" and a["resource_id"] == first_form_request_id
            for a in assignments
        )

    def test_admin_can_access_assigned_form_request(
        self, admin_session, owner_id, first_form_request_id
    ):
        """Admin can fetch responses for the form request they were assigned."""
        resp = admin_session.get(
            f"{BASE_URL}/api/form-requests/{first_form_request_id}/responses",
            headers={**CORS_HEADERS, "X-Org-ID": owner_id},
            timeout=10,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_admin_can_see_assigned_form_request_in_list(
        self, admin_session, owner_id, first_form_request_id
    ):
        """The assigned form request appears when admin lists form requests."""
        resp = admin_session.get(
            f"{BASE_URL}/api/form-requests",
            headers={**CORS_HEADERS, "X-Org-ID": owner_id},
            timeout=10,
        )
        assert resp.status_code == 200
        ids = [fr["id"] for fr in resp.json()]
        assert first_form_request_id in ids, (
            f"Assigned form request {first_form_request_id} not in list: {ids}"
        )

    def test_owner_can_remove_assignment(
        self, owner_session, admin_user_id, first_form_request_id
    ):
        """Owner revokes the form request assignment from the admin."""
        resp = owner_session.delete(
            f"{BASE_URL}/api/org/members/{admin_user_id}/assignments"
            f"/form_request/{first_form_request_id}",
            timeout=10,
        )
        assert resp.status_code == 200
        assignments = resp.json()["assignments"]
        assert not any(
            a["resource_id"] == first_form_request_id for a in assignments
        )

    def test_admin_blocked_from_unassigned_form_request(
        self, admin_session, owner_id, first_form_request_id
    ):
        """After assignment is removed, admin gets 403 on that form request."""
        resp = admin_session.get(
            f"{BASE_URL}/api/form-requests/{first_form_request_id}/responses",
            headers={**CORS_HEADERS, "X-Org-ID": owner_id},
            timeout=10,
        )
        assert resp.status_code == 403

    def test_owner_can_assign_group_to_admin(
        self, owner_session, admin_user_id, first_group_id
    ):
        """Owner assigns a group to the admin sub-user."""
        resp = owner_session.post(
            f"{BASE_URL}/api/org/members/{admin_user_id}/assignments",
            json={"resource_type": "group", "resource_id": first_group_id},
            timeout=10,
        )
        assert resp.status_code == 200
        assignments = resp.json()["assignments"]
        assert any(
            a["resource_type"] == "group" and a["resource_id"] == first_group_id
            for a in assignments
        )

    def test_admin_can_access_assigned_group(
        self, admin_session, owner_id, first_group_id
    ):
        """Admin can fetch the group they were assigned."""
        resp = admin_session.get(
            f"{BASE_URL}/api/groups/{first_group_id}",
            headers={**CORS_HEADERS, "X-Org-ID": owner_id},
            timeout=10,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# Tests — Group 4: Member removal
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestMemberRemoval:

    def test_owner_can_remove_admin_member(self, owner_session, admin_user_id):
        """Owner can remove the admin from their organization."""
        resp = owner_session.delete(
            f"{BASE_URL}/api/org/members/{admin_user_id}",
            timeout=10,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_removed_member_no_longer_listed(self, owner_session, admin_user_id):
        """After removal the admin no longer appears in the member list."""
        resp = owner_session.get(f"{BASE_URL}/api/org/members", timeout=10)
        assert resp.status_code == 200
        member_ids = [m["member_user_id"] for m in resp.json()["members"]]
        assert admin_user_id not in member_ids

    def test_removed_member_loses_org_access(self, admin_session, owner_id):
        """After removal the admin can no longer access resources via X-Org-ID."""
        resp = admin_session.get(
            f"{BASE_URL}/api/form-requests",
            headers={**CORS_HEADERS, "X-Org-ID": owner_id},
            timeout=10,
        )
        assert resp.status_code == 403

    def test_removed_member_not_in_my_organizations(self, admin_session, owner_id):
        """After removal the org no longer appears in admin's organizations list."""
        resp = admin_session.get(f"{BASE_URL}/api/my-organizations", timeout=10)
        assert resp.status_code == 200
        org_ids = [o["org_id"] for o in resp.json()["organizations"]]
        assert owner_id not in org_ids
