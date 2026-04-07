"""Email open tracking events.

Stored in the email_open_events Firestore collection. Each document records
a single email open captured by the tracking pixel endpoint. Deduplication
is applied in log() to avoid counting repeated loads from the same recipient
within a short window (email client prefetch / re-render).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from google.cloud.firestore_v1.base_query import FieldFilter
from models.database import get_db, Collections


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


@dataclass
class EmailOpenEvent:
    """A single email-open tracking event."""

    id: str
    owner_id: str
    recipient_email: str
    request_id: Optional[str]
    form_title: Optional[str]
    timestamp: str
    user_agent: Optional[str]
    ip_address: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "owner_id": self.owner_id,
            "recipient_email": self.recipient_email,
            "request_id": self.request_id,
            "form_title": self.form_title,
            "timestamp": self.timestamp,
            "user_agent": self.user_agent,
            "ip_address": self.ip_address,
        }

    @staticmethod
    def log(
        owner_id: str,
        recipient_email: str,
        *,
        request_id: Optional[str] = None,
        form_title: Optional[str] = None,
        user_agent: Optional[str] = None,
        ip_address: Optional[str] = None,
        dedup_minutes: int = 5,
    ) -> bool:
        """Record an email open. Returns True if a new event was stored.

        Deduplication: if the same (owner_id, recipient_email, request_id)
        combination already has an event within dedup_minutes, the call is a
        no-op. This prevents inflating counts due to email-client prefetch or
        repeated preview renders while still counting genuinely separate opens.

        Callers should wrap in try/except so a logging failure never breaks
        core functionality.

        Args:
            owner_id: ID of the org/user who sent the email.
            recipient_email: Normalized email address of the recipient.
            request_id: ID of the associated form request (optional).
            form_title: Human-readable form name for display in analytics.
            user_agent: HTTP User-Agent from the tracking pixel request.
            ip_address: Remote IP from the tracking pixel request.
            dedup_minutes: Ignore opens within this many minutes of an
                existing event for the same (owner, recipient, request).

        Returns:
            True if a new event document was written, False if deduplicated.
        """
        try:
            email = (recipient_email or "").strip().lower()
            if not owner_id or not email:
                return False

            db = get_db()
            coll = db.collection(Collections.EMAIL_OPEN_EVENTS)

            if request_id and dedup_minutes > 0:
                # Use only equality filters to avoid requiring a composite
                # Firestore index. The timestamp check is done in Python.
                cutoff = datetime.utcnow() - timedelta(minutes=dedup_minutes)
                existing = (
                    coll.where(filter=FieldFilter("owner_id", "==", owner_id))
                    .where(filter=FieldFilter("recipient_email", "==", email))
                    .where(filter=FieldFilter("request_id", "==", request_id))
                    .limit(20)
                    .stream()
                )
                for doc in existing:
                    ts_str = (doc.to_dict() or {}).get("timestamp", "")
                    try:
                        ts = datetime.fromisoformat(ts_str.rstrip("Z"))
                        if ts >= cutoff:
                            return False
                    except Exception:
                        pass

            eid = uuid.uuid4().hex
            coll.document(eid).set({
                "id": eid,
                "owner_id": owner_id,
                "recipient_email": email,
                "request_id": request_id or "",
                "form_title": form_title or "",
                "timestamp": _now_iso(),
                "user_agent": user_agent or "",
                "ip_address": ip_address or "",
            })
            print(
                f"EmailOpenEvent.log: stored id={eid} "
                f"owner_id={owner_id!r} email={email!r} request_id={request_id!r}"
            )
            return True
        except Exception as e:
            print(f"EmailOpenEvent.log failed (non-fatal): {e}")
            return False

    @staticmethod
    def get_events_for_owner(owner_id: str, limit: int = 500) -> List[EmailOpenEvent]:
        """Return open events for an owner, newest first.

        Args:
            owner_id: ID of the organization owner.
            limit: Maximum number of events to return.

        Returns:
            List of EmailOpenEvent sorted by timestamp descending.
        """
        try:
            if not owner_id:
                return []

            db = get_db()
            coll = db.collection(Collections.EMAIL_OPEN_EVENTS)
            stream = coll.where(filter=FieldFilter("owner_id", "==", owner_id)).stream()
            events: List[EmailOpenEvent] = []
            for doc in stream:
                data = doc.to_dict() or {}
                events.append(EmailOpenEvent(
                    id=data.get("id", doc.id),
                    owner_id=data.get("owner_id", owner_id),
                    recipient_email=data.get("recipient_email", ""),
                    request_id=data.get("request_id") or None,
                    form_title=data.get("form_title") or None,
                    timestamp=data.get("timestamp", _now_iso()),
                    user_agent=data.get("user_agent") or None,
                    ip_address=data.get("ip_address") or None,
                ))
            events.sort(key=lambda e: e.timestamp, reverse=True)
            return events[:limit]
        except Exception as e:
            print(f"EmailOpenEvent.get_events_for_owner failed: {e}")
            return []
