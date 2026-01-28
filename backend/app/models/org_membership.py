"""
Organization membership / opt-out model.

This project treats each User (owner_id) as an "organization".
Recipients are identified by email and can belong to many groups within an org.

We store org-level membership state in Firestore so that:
- recipients can opt out (leave org) once and be excluded from all future emails
- owners adding members won't accidentally re-add opted-out recipients
- recipients can explicitly opt back in by joining again via invite link (optional)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any

from models.database import get_db, Collections


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _doc_id(owner_id: str, recipient_email: str) -> str:
    # Firestore doc IDs must not contain "/". Email can contain "." and "@", which are fine.
    return f"{owner_id}__{_normalize_email(recipient_email)}"


@dataclass
class OrgMembership:
    owner_id: str
    recipient_email: str
    status: str  # "active" | "left"
    created_at: str
    updated_at: str
    left_at: Optional[str] = None
    last_joined_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "owner_id": self.owner_id,
            "recipient_email": _normalize_email(self.recipient_email),
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "left_at": self.left_at,
            "last_joined_at": self.last_joined_at,
        }

    @staticmethod
    def get(owner_id: str, recipient_email: str) -> Optional["OrgMembership"]:
        try:
            email = _normalize_email(recipient_email)
            if not owner_id or not email:
                return None

            db = get_db()
            ref = db.collection(Collections.ORG_MEMBERSHIPS).document(_doc_id(owner_id, email))
            doc = ref.get()
            if not doc.exists:
                return None

            data = doc.to_dict() or {}
            return OrgMembership(
                owner_id=data.get("owner_id", owner_id),
                recipient_email=data.get("recipient_email", email),
                status=data.get("status", "active"),
                created_at=data.get("created_at", _now_iso()),
                updated_at=data.get("updated_at", _now_iso()),
                left_at=data.get("left_at"),
                last_joined_at=data.get("last_joined_at"),
            )
        except Exception as e:
            print(f"Error reading org membership: {e}")
            return None

    @staticmethod
    def is_opted_out(owner_id: str, recipient_email: str) -> bool:
        m = OrgMembership.get(owner_id, recipient_email)
        return bool(m and m.status == "left")

    @staticmethod
    def ensure_active(owner_id: str, recipient_email: str, *, source: str = "unknown") -> bool:
        """
        Mark membership active (opt-in). Intended for explicit recipient action (join via invite).
        """
        try:
            email = _normalize_email(recipient_email)
            if not owner_id or not email:
                return False

            db = get_db()
            now = _now_iso()
            ref = db.collection(Collections.ORG_MEMBERSHIPS).document(_doc_id(owner_id, email))
            doc = ref.get()

            if doc.exists:
                ref.update(
                    {
                        "status": "active",
                        "updated_at": now,
                        "last_joined_at": now,
                        "left_at": None,
                        "reactivated_via": source,
                    }
                )
            else:
                ref.set(
                    {
                        "owner_id": owner_id,
                        "recipient_email": email,
                        "status": "active",
                        "created_at": now,
                        "updated_at": now,
                        "last_joined_at": now,
                        "left_at": None,
                        "reactivated_via": source,
                    }
                )
            return True
        except Exception as e:
            print(f"Error ensuring active org membership: {e}")
            return False

    @staticmethod
    def mark_left(owner_id: str, recipient_email: str, *, reason: str = "left", source: str = "unknown") -> bool:
        """
        Mark membership left (opt-out). This is the global suppression record.
        """
        try:
            email = _normalize_email(recipient_email)
            if not owner_id or not email:
                return False

            db = get_db()
            now = _now_iso()
            ref = db.collection(Collections.ORG_MEMBERSHIPS).document(_doc_id(owner_id, email))
            doc = ref.get()

            payload = {
                "owner_id": owner_id,
                "recipient_email": email,
                "status": "left",
                "updated_at": now,
                "left_at": now,
                "left_reason": reason,
                "left_source": source,
            }

            if doc.exists:
                ref.update(payload)
            else:
                ref.set(
                    {
                        **payload,
                        "created_at": now,
                        "last_joined_at": None,
                    }
                )
            return True
        except Exception as e:
            print(f"Error marking org membership left: {e}")
            return False

