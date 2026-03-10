"""
Opt-out and group-leave event analytics.

Events are stored in Firestore for owner dashboards. All logging is fire-and-forget:
callers wrap OptOutEvent.log in try/except so failures never break core flows.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

from models.database import get_db, Collections


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


@dataclass
class OptOutEvent:
    """A single opt-out / group-leave / resubscribe event."""

    id: str
    owner_id: str
    recipient_email: str
    event_type: str  # opted_out | left_group | resubscribed | added_back_by_owner
    group_id: Optional[str]
    group_name: Optional[str]
    performed_by: str  # recipient | owner | system
    source: str
    timestamp: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "owner_id": self.owner_id,
            "recipient_email": self.recipient_email,
            "event_type": self.event_type,
            "group_id": self.group_id,
            "group_name": self.group_name,
            "performed_by": self.performed_by,
            "source": self.source,
            "timestamp": self.timestamp,
        }

    @staticmethod
    def log(
        owner_id: str,
        recipient_email: str,
        event_type: str,
        performed_by: str,
        source: str,
        *,
        group_id: Optional[str] = None,
        group_name: Optional[str] = None,
    ) -> None:
        """
        Create and save a new event document. Fire-and-forget: callers should
        wrap in try/except so logging failures never break core functionality.
        """
        try:
            email = _normalize_email(recipient_email)
            if not owner_id or not email:
                return

            db = get_db()
            coll = db.collection(Collections.OPT_OUT_EVENTS)
            eid = uuid.uuid4().hex
            ref = coll.document(eid)
            ref.set(
                {
                    "id": eid,
                    "owner_id": owner_id,
                    "recipient_email": email,
                    "event_type": event_type,
                    "group_id": group_id,
                    "group_name": group_name,
                    "performed_by": performed_by,
                    "source": source,
                    "timestamp": _now_iso(),
                }
            )
            print(f"OptOutEvent.log: stored id={eid} owner_id={owner_id!r} event_type={event_type}")
        except Exception as e:
            print(f"OptOutEvent.log failed (non-fatal): {e}")

    @staticmethod
    def get_events_for_owner(owner_id: str, limit: int = 100) -> List[OptOutEvent]:
        """Return events for an owner, newest first, for dashboard."""
        try:
            if not owner_id:
                return []

            db = get_db()
            coll = db.collection(Collections.OPT_OUT_EVENTS)
            stream = coll.where("owner_id", "==", owner_id).stream()
            events = []
            for doc in stream:
                data = doc.to_dict() or {}
                events.append(
                    OptOutEvent(
                        id=data.get("id", doc.id),
                        owner_id=data.get("owner_id", owner_id),
                        recipient_email=data.get("recipient_email", ""),
                        event_type=data.get("event_type", ""),
                        group_id=data.get("group_id"),
                        group_name=data.get("group_name"),
                        performed_by=data.get("performed_by", ""),
                        source=data.get("source", ""),
                        timestamp=data.get("timestamp", _now_iso()),
                    )
                )
            events.sort(key=lambda e: e.timestamp, reverse=True)
            return events[:limit]
        except Exception as e:
            print(f"Error reading opt-out events for owner: {e}")
            return []

    @staticmethod
    def get_events_for_recipient(owner_id: str, recipient_email: str) -> List[OptOutEvent]:
        """Return all events for a specific recipient under an owner."""
        try:
            email = _normalize_email(recipient_email)
            if not owner_id or not email:
                return []

            db = get_db()
            coll = db.collection(Collections.OPT_OUT_EVENTS)
            stream = coll.where("owner_id", "==", owner_id).where("recipient_email", "==", email).stream()
            events = []
            for doc in stream:
                data = doc.to_dict() or {}
                events.append(
                    OptOutEvent(
                        id=data.get("id", doc.id),
                        owner_id=data.get("owner_id", owner_id),
                        recipient_email=data.get("recipient_email", email),
                        event_type=data.get("event_type", ""),
                        group_id=data.get("group_id"),
                        group_name=data.get("group_name"),
                        performed_by=data.get("performed_by", ""),
                        source=data.get("source", ""),
                        timestamp=data.get("timestamp", _now_iso()),
                    )
                )
            events.sort(key=lambda e: e.timestamp, reverse=True)
            return events
        except Exception as e:
            print(f"Error reading opt-out events for recipient: {e}")
            return []
