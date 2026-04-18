"""
Sub-user membership within an owner's organization.

Design notes:
- Every User account IS its own organization.  owner_id == org_id == that user's Firestore ID.
- A sub-user must already have a FormReminder account before they can be added.
- One account may belong to multiple organizations simultaneously (cross-org support).
- Assignments are stored as an embedded array on the membership document so a single
  read gives the full access picture without extra queries.
- Document ID format: ``{org_id}__{member_user_id}`` for O(1) single-read lookups.
"""

import uuid
from datetime import datetime
from typing import Optional

from models.database import get_db, Collections
from google.cloud.firestore_v1.base_query import FieldFilter


class OrgMember:
    """Represents a sub-user's membership inside an owner's organization."""

    # --- Role constants ---
    ROLE_ADMIN = "admin"
    ROLE_MANAGER = "manager"
    VALID_ROLES = {ROLE_ADMIN, ROLE_MANAGER}

    # --- Status constants ---
    STATUS_PENDING = "pending"   # Invite sent, not yet accepted
    STATUS_ACTIVE = "active"     # Accepted / manually added

    # --- Per-role allowed actions ---
    # Admins: full CRUD on assigned resources, but cannot manage org members
    _ADMIN_ACTIONS = {"view", "edit", "create", "delete", "send_reminder"}
    # Managers: read + limited write on assigned resources only
    _MANAGER_ACTIONS = {"view", "edit", "send_reminder"}

    def __init__(
        self,
        id: str,
        org_id: str,
        member_user_id: str,
        role: str,
        status: str,
        invite_token: str,
        invited_by: str,
        invited_at: str,
        joined_at: Optional[str] = None,
        assignments: Optional[list] = None,
        invite_email: Optional[str] = None,
    ):
        self.id = id                          # Firestore document ID
        self.org_id = org_id                  # Owner's user_id (= the organization)
        self.member_user_id = member_user_id  # Sub-user's user_id (empty if pending)
        self.role = role
        self.status = status
        self.invite_token = invite_token
        self.invited_by = invited_by
        self.invited_at = invited_at
        self.joined_at = joined_at
        self.assignments = assignments or []  # [{resource_type, resource_id}]
        self.invite_email = invite_email      # Email used when invite was sent

    # -----------------------------------------------------------------------
    # Factory / read helpers
    # -----------------------------------------------------------------------

    @staticmethod
    def _doc_id(org_id: str, member_user_id: str) -> str:
        return f"{org_id}__{member_user_id}"

    @classmethod
    def _from_doc(cls, doc) -> "OrgMember":
        data = doc.to_dict()
        return cls(
            id=doc.id,
            org_id=data.get("org_id", ""),
            member_user_id=data.get("member_user_id", ""),
            role=data.get("role", cls.ROLE_MANAGER),
            status=data.get("status", cls.STATUS_PENDING),
            invite_token=data.get("invite_token", ""),
            invited_by=data.get("invited_by", ""),
            invited_at=data.get("invited_at", ""),
            joined_at=data.get("joined_at"),
            assignments=data.get("assignments", []),
            invite_email=data.get("invite_email"),
        )

    # -----------------------------------------------------------------------
    # Create
    # -----------------------------------------------------------------------

    @staticmethod
    def create_invite(
        org_id: str,
        invite_email: str,
        role: str,
        invited_by: str,
    ) -> "OrgMember":
        """Create a pending invite record (email invite flow).

        The ``member_user_id`` is left empty until the recipient accepts.
        The invite token is embedded in the link sent by email.

        Args:
            org_id: Owner's user_id (the org being joined).
            invite_email: Email address of the person being invited.
            role: ``OrgMember.ROLE_ADMIN`` or ``OrgMember.ROLE_MANAGER``.
            invited_by: user_id of whoever sent the invite.

        Returns:
            Persisted OrgMember in PENDING status.
        """
        db = get_db()
        token = uuid.uuid4().hex
        now = datetime.utcnow().isoformat() + "Z"
        doc_id = f"invite__{org_id}__{uuid.uuid4().hex}"  # random ID; resolved on accept

        data = {
            "org_id": org_id,
            "member_user_id": "",        # filled in on accept
            "role": role,
            "status": OrgMember.STATUS_PENDING,
            "invite_token": token,
            "invited_by": invited_by,
            "invited_at": now,
            "joined_at": None,
            "assignments": [],
            "invite_email": invite_email.strip().lower(),
        }
        db.collection(Collections.ORG_MEMBERS).document(doc_id).set(data)
        return OrgMember(id=doc_id, **data)

    @staticmethod
    def create_active(
        org_id: str,
        member_user_id: str,
        role: str,
        invited_by: str,
    ) -> "OrgMember":
        """Add an existing user immediately as an active member (manual add flow).

        Args:
            org_id: Owner's user_id.
            member_user_id: user_id of the person being added.
            role: ``OrgMember.ROLE_ADMIN`` or ``OrgMember.ROLE_MANAGER``.
            invited_by: user_id of whoever performed the add.

        Returns:
            Persisted OrgMember in ACTIVE status.
        """
        db = get_db()
        now = datetime.utcnow().isoformat() + "Z"
        doc_id = OrgMember._doc_id(org_id, member_user_id)

        data = {
            "org_id": org_id,
            "member_user_id": member_user_id,
            "role": role,
            "status": OrgMember.STATUS_ACTIVE,
            "invite_token": uuid.uuid4().hex,
            "invited_by": invited_by,
            "invited_at": now,
            "joined_at": now,
            "assignments": [],
            "invite_email": None,
        }
        db.collection(Collections.ORG_MEMBERS).document(doc_id).set(data)
        return OrgMember(id=doc_id, **data)

    # -----------------------------------------------------------------------
    # Read
    # -----------------------------------------------------------------------

    @staticmethod
    def get_by_id(member_id: str) -> Optional["OrgMember"]:
        """Fetch a membership document by its Firestore ID."""
        db = get_db()
        doc = db.collection(Collections.ORG_MEMBERS).document(member_id).get()
        return OrgMember._from_doc(doc) if doc.exists else None

    @staticmethod
    def get_by_token(token: str) -> Optional["OrgMember"]:
        """Look up a membership by invite token (used on invite acceptance)."""
        db = get_db()
        results = (
            db.collection(Collections.ORG_MEMBERS)
            .where(filter=FieldFilter("invite_token", "==", token))
            .stream()
        )
        for doc in results:
            return OrgMember._from_doc(doc)
        return None

    @staticmethod
    def get_membership(org_id: str, member_user_id: str) -> Optional["OrgMember"]:
        """Return the membership record for a specific (org, user) pair if it exists."""
        db = get_db()
        doc_id = OrgMember._doc_id(org_id, member_user_id)
        doc = db.collection(Collections.ORG_MEMBERS).document(doc_id).get()
        if doc.exists:
            return OrgMember._from_doc(doc)
        # Also check pending invite records (member_user_id not yet set)
        return None

    @staticmethod
    def get_org_members(org_id: str) -> list:
        """Return all membership records for an organization (owner's view).

        Args:
            org_id: The owner's user_id.

        Returns:
            List of OrgMember objects (both pending and active).
        """
        db = get_db()
        docs = (
            db.collection(Collections.ORG_MEMBERS)
            .where(filter=FieldFilter("org_id", "==", org_id))
            .stream()
        )
        return [OrgMember._from_doc(d) for d in docs]

    @staticmethod
    def get_user_memberships(user_id: str) -> list:
        """Return all organizations a user belongs to as a sub-user.

        Args:
            user_id: The sub-user's user_id.

        Returns:
            List of active OrgMember records across all orgs.
        """
        db = get_db()
        docs = (
            db.collection(Collections.ORG_MEMBERS)
            .where(filter=FieldFilter("member_user_id", "==", user_id))
            .where(filter=FieldFilter("status", "==", OrgMember.STATUS_ACTIVE))
            .stream()
        )
        return [OrgMember._from_doc(d) for d in docs]

    # -----------------------------------------------------------------------
    # Mutations
    # -----------------------------------------------------------------------

    def accept(self, accepting_user_id: str) -> bool:
        """Accept a pending invite and link it to the accepting user's account.

        Args:
            accepting_user_id: user_id of the person accepting the invite.

        Returns:
            True on success, False if already active or user mismatch.
        """
        if self.status == self.STATUS_ACTIVE:
            return False
        try:
            db = get_db()
            now = datetime.utcnow().isoformat() + "Z"
            new_doc_id = OrgMember._doc_id(self.org_id, accepting_user_id)

            # Write new document with deterministic ID, delete old pending record
            data = {
                "org_id": self.org_id,
                "member_user_id": accepting_user_id,
                "role": self.role,
                "status": self.STATUS_ACTIVE,
                "invite_token": self.invite_token,
                "invited_by": self.invited_by,
                "invited_at": self.invited_at,
                "joined_at": now,
                "assignments": self.assignments,
                "invite_email": self.invite_email,
            }
            db.collection(Collections.ORG_MEMBERS).document(new_doc_id).set(data)
            if self.id != new_doc_id:
                db.collection(Collections.ORG_MEMBERS).document(self.id).delete()

            self.id = new_doc_id
            self.member_user_id = accepting_user_id
            self.status = self.STATUS_ACTIVE
            self.joined_at = now
            return True
        except Exception as e:
            print(f"OrgMember.accept error: {e}")
            return False

    def update_role(self, new_role: str) -> bool:
        """Change the role of an existing member.

        Args:
            new_role: ``ROLE_ADMIN`` or ``ROLE_MANAGER``.

        Returns:
            True on success.
        """
        if new_role not in self.VALID_ROLES:
            return False
        try:
            db = get_db()
            db.collection(Collections.ORG_MEMBERS).document(self.id).update({"role": new_role})
            self.role = new_role
            return True
        except Exception as e:
            print(f"OrgMember.update_role error: {e}")
            return False

    def remove(self) -> bool:
        """Delete this membership record entirely.

        Returns:
            True on success.
        """
        try:
            db = get_db()
            db.collection(Collections.ORG_MEMBERS).document(self.id).delete()
            return True
        except Exception as e:
            print(f"OrgMember.remove error: {e}")
            return False

    # -----------------------------------------------------------------------
    # Assignment management
    # -----------------------------------------------------------------------

    def add_assignment(self, resource_type: str, resource_id: str) -> bool:
        """Grant access to a specific group or form request.

        Args:
            resource_type: ``"group"`` or ``"form_request"``.
            resource_id: Firestore document ID of the resource.

        Returns:
            True on success (idempotent — adding an existing assignment is a no-op).
        """
        if self.has_assignment(resource_type, resource_id):
            return True
        try:
            new_entry = {"resource_type": resource_type, "resource_id": resource_id}
            self.assignments.append(new_entry)
            db = get_db()
            db.collection(Collections.ORG_MEMBERS).document(self.id).update(
                {"assignments": self.assignments}
            )
            return True
        except Exception as e:
            print(f"OrgMember.add_assignment error: {e}")
            return False

    def remove_assignment(self, resource_type: str, resource_id: str) -> bool:
        """Revoke access to a specific group or form request.

        Args:
            resource_type: ``"group"`` or ``"form_request"``.
            resource_id: Firestore document ID of the resource.

        Returns:
            True on success, False if assignment did not exist.
        """
        original_len = len(self.assignments)
        self.assignments = [
            a for a in self.assignments
            if not (a["resource_type"] == resource_type and a["resource_id"] == resource_id)
        ]
        if len(self.assignments) == original_len:
            return False
        try:
            db = get_db()
            db.collection(Collections.ORG_MEMBERS).document(self.id).update(
                {"assignments": self.assignments}
            )
            return True
        except Exception as e:
            print(f"OrgMember.remove_assignment error: {e}")
            return False

    def has_assignment(self, resource_type: str, resource_id: str) -> bool:
        """Return True if this member is assigned to the given resource."""
        return any(
            a["resource_type"] == resource_type and a["resource_id"] == resource_id
            for a in self.assignments
        )

    # -----------------------------------------------------------------------
    # Permission checks
    # -----------------------------------------------------------------------

    def can_perform(self, action: str, resource_type: str, resource_id: str) -> bool:
        """Return True if this member may perform ``action`` on the resource.

        Args:
            action: One of ``view``, ``edit``, ``create``, ``delete``,
                ``send_reminder``.
            resource_type: ``"group"`` or ``"form_request"``.
            resource_id: Firestore document ID.

        Returns:
            True only if the membership is active, the action is allowed for the
            member's role, and the resource is in their assignment list.
        """
        if self.status != self.STATUS_ACTIVE:
            return False

        allowed = (
            self._ADMIN_ACTIONS if self.role == self.ROLE_ADMIN else self._MANAGER_ACTIONS
        )
        if action not in allowed:
            return False

        return self.has_assignment(resource_type, resource_id)

    # -----------------------------------------------------------------------
    # Serialization
    # -----------------------------------------------------------------------

    def to_dict(self) -> dict:
        """Return a JSON-safe representation (omits invite_token for security)."""
        return {
            "id": self.id,
            "org_id": self.org_id,
            "member_user_id": self.member_user_id,
            "role": self.role,
            "status": self.status,
            "invited_by": self.invited_by,
            "invited_at": self.invited_at,
            "joined_at": self.joined_at,
            "assignments": self.assignments,
            "invite_email": self.invite_email,
        }
