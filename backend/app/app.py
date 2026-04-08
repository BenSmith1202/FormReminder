import os
import hmac
import hashlib
import json
import sys

# Force UTF-8 output on Windows to prevent crashes from emoji/unicode in print statements
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from flask import Flask, jsonify, request, session
from flask_cors import CORS

# Add the parent directory to the path so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models.database import get_db, FirestoreDB, Collections
from models.user import User
from models.org_membership import OrgMembership
from models.opt_out_event import OptOutEvent
from models.org_member import OrgMember
from models.email_open_event import EmailOpenEvent
from config import settings
from utils.email_service import EmailService

# --- IMPORT BLUEPRINTS ---
from routes.auth_and_login import auth_bp
from routes.groups import groups_bp
from routes.form_requests import form_requests_bp
from routes.utilities import utilities_bp
from routes.email import email_bp
from routes.organizations import orgs_bp
from routes.settings import settings_bp
from routes.notifications import notifications_bp
from routes.provider_auth import provider_auth_bp
from utils.scheduler import init_scheduler  # Automatic reminder scheduler
# -------------------------

# 1. Initialize Flask
app = Flask(__name__)
app.secret_key = settings.SECRET_KEY  # Required for sessions

# Session cookie config — required for cross-origin cookies (frontend/backend on different domains)
is_production = not settings.DEBUG
app.config['SESSION_COOKIE_SAMESITE'] = 'None' if is_production else 'Lax'
app.config['SESSION_COOKIE_SECURE'] = is_production
app.config['SESSION_COOKIE_HTTPONLY'] = True

# disable strict slashes globally
app.url_map.strict_slashes = False

frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")
CORS(app,
     origins=[frontend_url, "http://localhost:5173", "http://localhost:5174", "https://formreminder-frontend-176029126556.us-central1.run.app"],
     supports_credentials=True,
     allow_headers=["Content-Type"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])

# Initialize database at startup
try:
    print("Initializing database connection...")
    FirestoreDB.initialize()
    print("Database initialized successfully")
except Exception as e:
    print(f"WARNING: Database initialization failed at startup: {e}")
    import traceback
    traceback.print_exc()
    print("Database will be initialized on first use")

# Debug middleware to check sessions
@app.before_request
def log_session():
    """Debug: Log session info for each request"""
    print(f"\n=== REQUEST: {request.method} {request.path} ===")
    print(f"Session data: {dict(session)}")
    print(f"Has user_id: {'user_id' in session}")
    if 'user_id' in session:
        print(f"User ID: {session['user_id']}")
    # Deployment / caching debug: log cookie and session config
    print(f"  Cookie header present: {'cookie' in {k.lower(): v for k, v in request.headers}}")
    print(f"  Origin: {request.headers.get('Origin', '(none)')}")
    print(f"  SameSite={app.config.get('SESSION_COOKIE_SAMESITE')} Secure={app.config.get('SESSION_COOKIE_SECURE')}")
    print(f"  Session cookie name: {app.config.get('SESSION_COOKIE_NAME', 'session')}")


def _send_invite_email(
    to_email: str,
    inviter_name: str,
    inviter_email: str,
    org_name: str,
    role: str,
    invite_token: str,
) -> bool:
    """Render the invite template and dispatch via Emailit.

    Args:
        to_email: Recipient's email address.
        inviter_name: Display name of the person who sent the invite.
        inviter_email: Email of the inviter (shown in footer).
        org_name: Display name for the organization.
        role: ``"admin"`` or ``"manager"``.
        invite_token: The raw token embedded in the accept URL.

    Returns:
        True if the Emailit API accepted the email, False otherwise.
    """
    from jinja2 import Environment, FileSystemLoader
    import os

    template_dir = os.path.join(os.path.dirname(__file__), "templates")
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("invite_email.html")

    accept_url = f"{settings.FRONTEND_URL}/invite/accept?token={invite_token}"

    html_content = template.render(
        inviter_name=inviter_name,
        inviter_email=inviter_email,
        org_name=org_name,
        role=role,
        accept_url=accept_url,
    )

    result = EmailService.send_email(
        to_email,
        f"[FormReminder] You've been invited to join {org_name}",
        html_content,
    )
    return result.get("success", False)


# 4. Register Blueprints
app.register_blueprint(auth_bp) # Auth handles its own /api prefixes
app.register_blueprint(groups_bp, url_prefix='/api/groups')
app.register_blueprint(form_requests_bp, url_prefix='/api/form-requests')
app.register_blueprint(utilities_bp) # Utils handles its own prefixes (/time, /api/health)
app.register_blueprint(email_bp)
app.register_blueprint(orgs_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(notifications_bp)
app.register_blueprint(provider_auth_bp)  # Jotform + Microsoft auth, connected-accounts


# Prevent browsers from caching API responses (helps with stale-deployment issues)
@app.after_request
def set_cache_headers(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


@app.get("/")
def root():
    """Root endpoint - This is what you see at localhost:5000"""
    return {
        "message": "Welcome to FR API. Visit localhost:5173 to see the App.",
        "status": "running",
    }


@app.post("/api/organizations/<owner_id>/resubscribe")
def resubscribe_recipient(owner_id: str):
    """
    Owner-only: Re-subscribe a recipient who had opted out.
    Clears opt-out state; no email is sent to the recipient.
    """
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        if user_id != owner_id:
            return jsonify({"error": "Unauthorized"}), 403

        body = request.get_json(silent=True) or {}
        email = (body.get("email") or "").strip()
        if not email:
            return jsonify({"error": "email is required"}), 400

        if not OrgMembership.is_opted_out(owner_id, email):
            return jsonify({"error": "Recipient is not opted out."}), 400

        OrgMembership.ensure_active(owner_id, email, source="owner_dashboard")
        try:
            OptOutEvent.log(owner_id, email, "added_back_by_owner", "owner", "owner_dashboard")
        except Exception:
            pass

        return jsonify({"success": True, "email": email, "status": "active"}), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to resubscribe", "details": str(e)}), 500


@app.get("/api/organizations/<owner_id>/opt-out-events")
def get_opt_out_events(owner_id: str):
    """Owner-only: Return opt-out / group-leave / resubscribe events for dashboard."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        if user_id != owner_id:
            return jsonify({"error": "Unauthorized"}), 403

        events = OptOutEvent.get_events_for_owner(owner_id)
        print(f"get_opt_out_events: owner_id={owner_id!r} count={len(events)}")
        return jsonify({
            "events": [e.to_dict() for e in events],
        }), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to get events", "details": str(e)}), 500


@app.get("/api/analytics/submissions-over-time")
def get_submissions_over_time():
    """Owner-only: Aggregate form submissions over time for Analytics graphs."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        db = get_db()

        # Collect all form requests for this owner.
        request_query = db.collection(Collections.FORM_REQUESTS)\
            .where("owner_id", "==", user_id)\
            .stream()

        from datetime import datetime

        def _parse_iso(ts: str) -> datetime | None:
            if not ts:
                return None
            try:
                cleaned = ts.rstrip("Z")
                return datetime.fromisoformat(cleaned)
            except Exception:
                return None

        now = datetime.utcnow()
        this_month_start = datetime(now.year, now.month, 1)

        # Pre-compute the last 6 month keys, oldest → newest.
        month_keys: list[str] = []
        month_counts: dict[str, int] = {}
        for i in range(5, -1, -1):
            d = datetime(now.year, now.month, 1)
            year = d.year
            month = d.month - i
            while month <= 0:
                year -= 1
                month += 12
            key = f"{year}-{month:02d}"
            if key not in month_counts:
                month_keys.append(key)
                month_counts[key] = 0

        total_submissions = 0
        submissions_this_month = 0
        per_form_counts: dict[str, dict[str, object]] = {}

        for req in request_query:
            req_data = req.to_dict() or {}
            req_id = req.id
            title = req_data.get("title") or req_data.get("form_title") or f"Form {req_id[:8]}"

            responses_stream = db.collection(Collections.RESPONSES)\
                .where("request_id", "==", req_id)\
                .stream()

            for resp in responses_stream:
                resp_data = resp.to_dict() or {}
                ts = (
                    resp_data.get("submitted_at")
                    or resp_data.get("last_submitted_at")
                    or resp_data.get("created_at", "")
                )
                dt = _parse_iso(ts)
                if not dt:
                    continue

                total_submissions += 1
                if dt >= this_month_start:
                    submissions_this_month += 1

                month_key = f"{dt.year}-{dt.month:02d}"
                if month_key in month_counts:
                    month_counts[month_key] += 1

                if req_id not in per_form_counts:
                    per_form_counts[req_id] = {
                        "form_request_id": req_id,
                        "form_title": title,
                        "count": 0,
                    }
                per_form_counts[req_id]["count"] = int(per_form_counts[req_id]["count"]) + 1

        monthly = []
        for key in sorted(month_keys):
            year, month = key.split("-")
            label_dt = datetime(int(year), int(month), 1)
            label = label_dt.strftime("%b '%y")
            monthly.append({
                "month": key,
                "label": label,
                "count": month_counts.get(key, 0),
            })

        per_form_list = sorted(
            per_form_counts.values(),
            key=lambda item: int(item["count"]),  # type: ignore[arg-type]
            reverse=True,
        )

        print(
            f"get_submissions_over_time: owner_id={user_id!r} "
            f"total={total_submissions} this_month={submissions_this_month}"
        )

        return jsonify({
            "total_submissions": total_submissions,
            "submissions_this_month": submissions_this_month,
            "per_form": per_form_list,
            "monthly": monthly,
        }), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to get submissions analytics", "details": str(e)}), 500


# Minimal 1×1 transparent GIF (43 bytes, RFC-compliant).
_TRACKING_PIXEL = (
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00"
    b"!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01"
    b"\x00\x00\x02\x02D\x01\x00;"
)


@app.get("/api/track/open/<token>")
def track_email_open(token: str):
    """Public endpoint: serve a 1×1 tracking pixel and log the email open.

    The token is a URL-safe base64-encoded JSON object containing the fields
    owner_id, recipient_email, request_id, and form_title produced by
    EmailService.build_tracking_token().  No authentication is required
    because this endpoint is called by the recipient's email client.
    """
    import base64

    try:
        padded = token + "=" * (-len(token) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        owner_id = payload.get("o", "")
        recipient_email = payload.get("e", "")
        request_id = payload.get("r", "") or None
        form_title = payload.get("f", "") or None

        print(
            f"track_email_open: token decoded owner_id={owner_id!r} "
            f"email={recipient_email!r} request_id={request_id!r} form={form_title!r}"
        )
        if owner_id and recipient_email:
            ua = request.headers.get("User-Agent", "")
            ip = request.headers.get("X-Forwarded-For", request.remote_addr or "")
            logged = EmailOpenEvent.log(
                owner_id,
                recipient_email,
                request_id=request_id,
                form_title=form_title,
                user_agent=ua,
                ip_address=ip.split(",")[0].strip() if ip else "",
            )
            print(f"track_email_open: logged={logged} email={recipient_email!r}")
        else:
            print(f"track_email_open: skipped — missing owner_id or email in token")
    except Exception as e:
        print(f"track_email_open: failed to decode/log token={token!r}: {e}")

    from flask import Response
    return Response(
        _TRACKING_PIXEL,
        status=200,
        headers={
            "Content-Type": "image/gif",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/api/analytics/email-opens")
def get_email_open_analytics():
    """Owner-only: Return email open rate analytics for the Analytics dashboard.

    Query params:
        range: '7d' | '30d' | '3m' | '6m' (default) | '1y' | 'all'
    """
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        from datetime import datetime, timedelta

        db = get_db()
        now = datetime.utcnow()

        # ── Resolve the requested time range ──────────────────────────────────
        range_param = request.args.get("range", "6m")
        RANGE_MAP = {
            "7d":  timedelta(days=7),
            "30d": timedelta(days=30),
            "3m":  timedelta(days=91),
            "6m":  timedelta(days=182),
            "1y":  timedelta(days=365),
        }
        cutoff: datetime | None = (now - RANGE_MAP[range_param]) if range_param in RANGE_MAP else None
        use_daily = range_param in ("7d", "30d")

        # ── 1. Seed per_form from ALL owner's form requests (0 opens baseline) ─
        all_requests = db.collection(Collections.FORM_REQUESTS)\
            .where("owner_id", "==", user_id)\
            .stream()

        per_form: dict[str, dict] = {}
        owner_request_ids: set[str] = set()
        for req_doc in all_requests:
            data = req_doc.to_dict() or {}
            req_id = data.get("id") or req_doc.id
            title = data.get("title") or data.get("form_title") or "Untitled"
            owner_request_ids.add(req_id)
            per_form[req_id] = {"request_id": req_id, "form_title": title, "opens": 0}

        # ── 2. Build time-series buckets for the selected range ───────────────
        bucket_keys: list[str] = []
        bucket_counts: dict[str, int] = {}

        if use_daily:
            days_back = 7 if range_param == "7d" else 30
            for i in range(days_back - 1, -1, -1):
                d = (now - timedelta(days=i)).date()
                key = d.isoformat()  # YYYY-MM-DD
                if key not in bucket_counts:
                    bucket_keys.append(key)
                    bucket_counts[key] = 0
        else:
            months_back = {"3m": 3, "6m": 6, "1y": 12}.get(range_param, 6)
            if range_param == "all":
                months_back = 24  # cap display at 24 months
            for i in range(months_back - 1, -1, -1):
                year, month = now.year, now.month - i
                while month <= 0:
                    year -= 1
                    month += 12
                key = f"{year}-{month:02d}"
                if key not in bucket_counts:
                    bucket_keys.append(key)
                    bucket_counts[key] = 0

        # ── 3. Process events, applying the cutoff filter ─────────────────────
        all_events = EmailOpenEvent.get_events_for_owner(user_id)
        total_opens = 0
        opens_in_range = 0
        unique_recipients: set[str] = set()

        for e in all_events:
            ts_str = e.timestamp or ""
            try:
                dt = datetime.fromisoformat(ts_str.rstrip("Z"))
            except Exception:
                dt = None

            in_range = (dt is not None and (cutoff is None or dt >= cutoff))

            if in_range:
                total_opens += 1
                opens_in_range += 1

            email_key = (e.recipient_email or "").strip().lower()
            if email_key and in_range:
                unique_recipients.add(email_key)

            req_key = e.request_id or "__unknown__"
            title = e.form_title or "Untitled"

            if in_range:
                if req_key in per_form:
                    if title and title != "Untitled":
                        per_form[req_key]["form_title"] = title
                    per_form[req_key]["opens"] += 1
                else:
                    per_form[req_key] = {
                        "request_id": req_key if req_key != "__unknown__" else None,
                        "form_title": title,
                        "opens": 1,
                    }

            if dt and in_range:
                if use_daily:
                    bk = dt.date().isoformat()
                else:
                    bk = f"{dt.year}-{dt.month:02d}"
                if bk in bucket_counts:
                    bucket_counts[bk] += 1

        # ── 4. Total sent in range from owner's email_logs ────────────────────
        cutoff_str = cutoff.isoformat() + "Z" if cutoff else None
        total_sent = 0
        if owner_request_ids:
            req_id_list = list(owner_request_ids)
            for i in range(0, len(req_id_list), 30):
                chunk = req_id_list[i:i + 30]
                logs = db.collection(Collections.EMAIL_LOGS)\
                    .where("request_id", "in", chunk)\
                    .where("success", "==", True)\
                    .stream()
                for log_doc in logs:
                    log_data = log_doc.to_dict() or {}
                    if cutoff_str is None or log_data.get("sent_at", "") >= cutoff_str:
                        total_sent += 1

        open_rate = round(total_opens / total_sent * 100, 1) if total_sent > 0 else 0.0
        unique_open_rate = round(len(unique_recipients) / total_sent * 100, 1) if total_sent > 0 else 0.0

        # ── 5. Build the time-series response list ────────────────────────────
        time_series = []
        for key in sorted(bucket_keys):
            if use_daily:
                d = datetime.fromisoformat(key)
                label = d.strftime("%b %-d") if hasattr(d, 'strftime') else key
                try:
                    label = d.strftime("%b %-d")
                except ValueError:
                    label = d.strftime("%b %#d")  # Windows fallback
            else:
                year, month_str = key.split("-")
                label = datetime(int(year), int(month_str), 1).strftime("%b '%y")
            time_series.append({"month": key, "label": label, "opens": bucket_counts.get(key, 0)})

        per_form_list = sorted(per_form.values(), key=lambda x: x["opens"], reverse=True)

        print(
            f"get_email_open_analytics: owner_id={user_id!r} range={range_param!r} "
            f"total_opens={total_opens} unique={len(unique_recipients)} "
            f"total_sent={total_sent} open_rate={open_rate}% forms={len(per_form_list)}"
        )

        return jsonify({
            "total_opens": total_opens,
            "unique_opens": len(unique_recipients),
            "opens_in_range": opens_in_range,
            "total_sent": total_sent,
            "open_rate": open_rate,
            "unique_open_rate": unique_open_rate,
            "per_form": per_form_list,
            "monthly": time_series,
            "range": range_param,
        }), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to get email open analytics", "details": str(e)}), 500


@app.get("/api/analytics/submissions")
def get_submission_analytics():
    """Owner-only: Return submission counts per form for the Analytics dashboard.

    Query params:
        range: '7d' | '30d' | '3m' | '6m' (default) | '1y' | 'all'
    """
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        from datetime import datetime, timedelta

        db = get_db()
        now = datetime.utcnow()

        RANGE_MAP = {
            "7d":  timedelta(days=7),
            "30d": timedelta(days=30),
            "3m":  timedelta(days=91),
            "6m":  timedelta(days=182),
            "1y":  timedelta(days=365),
        }
        range_param = request.args.get("range", "6m")
        cutoff: datetime | None = (now - RANGE_MAP[range_param]) if range_param in RANGE_MAP else None
        cutoff_str = cutoff.isoformat() if cutoff else None

        # ── 1. Get all owner form requests (title lookup + baseline 0 counts) ─
        all_requests = db.collection(Collections.FORM_REQUESTS)\
            .where("owner_id", "==", user_id)\
            .stream()

        per_form: dict[str, dict] = {}
        owner_request_ids: list[str] = []
        for req_doc in all_requests:
            data = req_doc.to_dict() or {}
            req_id = data.get("id") or req_doc.id
            title = data.get("title") or "Untitled"
            owner_request_ids.append(req_id)
            per_form[req_id] = {"request_id": req_id, "form_title": title, "submissions": 0}

        if not owner_request_ids:
            return jsonify({"per_form": [], "total": 0, "range": range_param}), 200

        # ── 2. Count responses per form (chunked to stay within Firestore 'in' limit) ─
        for i in range(0, len(owner_request_ids), 30):
            chunk = owner_request_ids[i:i + 30]
            responses = db.collection(Collections.RESPONSES)\
                .where("request_id", "in", chunk)\
                .stream()
            for resp_doc in responses:
                resp = resp_doc.to_dict() or {}
                if cutoff_str and resp.get("created_at", "") < cutoff_str:
                    continue
                req_id = resp.get("request_id", "")
                if req_id in per_form:
                    per_form[req_id]["submissions"] += 1

        per_form_list = sorted(
            per_form.values(),
            key=lambda x: x["submissions"],
            reverse=True,
        )
        total = sum(f["submissions"] for f in per_form_list)

        print(
            f"get_submission_analytics: owner_id={user_id!r} range={range_param!r} "
            f"total={total} forms={len(per_form_list)}"
        )

        return jsonify({"per_form": per_form_list, "total": total, "range": range_param}), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to get submission analytics", "details": str(e)}), 500


# ============= END GROUPS ROUTES =============

# ============= ORG MEMBER (SUB-USER) ROUTES =============
#
# Every User account IS its own organization (org_id == owner's user_id).
# Sub-users must already have a FormReminder account.
# The frontend identifies the active org context via the X-Org-ID header.
#
# Role capabilities (assigned resources only):
#   admin   — view, edit, create, delete, send_reminder
#   manager — view, edit, send_reminder  (no create / delete)
# Only the org owner can manage members and send invites.


@app.get("/api/org/members")
def list_org_members():
    """Owner only: list all sub-users (pending and active) in the caller's org."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        members = OrgMember.get_org_members(user_id)
        return jsonify({"members": [m.to_dict() for m in members]}), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to list members", "details": str(e)}), 500


@app.post("/api/org/invite")
def invite_org_member():
    """Owner only: send an email invite to an existing FormReminder account.

    Body JSON:
        email (str): The invitee's email address.
        role  (str): ``"admin"`` or ``"manager"``.

    The invitee must already have a FormReminder account.  If found, a
    pending membership record is created and an invite email is dispatched.
    """
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        role = (data.get("role") or "").strip().lower()

        if not email:
            return jsonify({"error": "email is required"}), 400
        if role not in OrgMember.VALID_ROLES:
            return jsonify({"error": f"role must be one of: {sorted(OrgMember.VALID_ROLES)}"}), 400

        # Prevent owner inviting themselves
        owner = User.get_by_id(user_id)
        if not owner:
            return jsonify({"error": "Owner account not found"}), 404
        if (owner.email or "").lower() == email:
            return jsonify({"error": "You cannot invite yourself"}), 400

        # Invitee must already have an account
        invitee = User.get_by_email(email) if hasattr(User, "get_by_email") else None
        if invitee is None:
            # Fallback: search by email field in users collection
            db = get_db()
            from models.database import Collections as _C
            results = list(db.collection(_C.USERS).where("email", "==", email).stream())
            invitee_id = results[0].id if results else None
        else:
            invitee_id = invitee.id

        if not invitee_id:
            return jsonify({
                "error": "No FormReminder account found for that email address",
                "hint": "The person must register for FormReminder before they can be invited",
            }), 404

        # Check for duplicate active membership
        existing = OrgMember.get_membership(user_id, invitee_id)
        if existing and existing.status == OrgMember.STATUS_ACTIVE:
            return jsonify({"error": "This user is already an active member"}), 409

        # Create pending invite record
        member = OrgMember.create_invite(
            org_id=user_id,
            invite_email=email,
            role=role,
            invited_by=user_id,
        )

        # Dispatch invite email (best-effort; membership record already saved)
        org_name = owner.username or owner.email or user_id
        email_sent = _send_invite_email(
            to_email=email,
            inviter_name=org_name,
            inviter_email=owner.email or "",
            org_name=org_name,
            role=role,
            invite_token=member.invite_token,
        )

        return jsonify({
            "success": True,
            "message": f"Invite {'sent' if email_sent else 'created (email failed)'}",
            "member": member.to_dict(),
            "email_sent": email_sent,
        }), 201

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to send invite", "details": str(e)}), 500


@app.post("/api/org/members")
def add_org_member():
    """Owner only: manually add an existing user as an active member (no invite email).

    Body JSON:
        email (str): The user's email address.
        role  (str): ``"admin"`` or ``"manager"``.
    """
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        role = (data.get("role") or "").strip().lower()

        if not email:
            return jsonify({"error": "email is required"}), 400
        if role not in OrgMember.VALID_ROLES:
            return jsonify({"error": f"role must be one of: {sorted(OrgMember.VALID_ROLES)}"}), 400

        # Prevent adding yourself
        owner = User.get_by_id(user_id)
        if owner and (owner.email or "").lower() == email:
            return jsonify({"error": "You cannot add yourself as a sub-user"}), 400

        # Look up user by email
        db = get_db()
        from models.database import Collections as _C
        results = list(db.collection(_C.USERS).where("email", "==", email).stream())
        if not results:
            return jsonify({
                "error": "No FormReminder account found for that email address",
                "hint": "The person must register for FormReminder before they can be added",
            }), 404

        target_user_id = results[0].id

        # Idempotency: if already active, just return existing record
        existing = OrgMember.get_membership(user_id, target_user_id)
        if existing and existing.status == OrgMember.STATUS_ACTIVE:
            return jsonify({
                "success": True,
                "message": "User is already an active member",
                "member": existing.to_dict(),
            }), 200

        member = OrgMember.create_active(
            org_id=user_id,
            member_user_id=target_user_id,
            role=role,
            invited_by=user_id,
        )

        return jsonify({
            "success": True,
            "message": f"Added {email} as {role}",
            "member": member.to_dict(),
        }), 201

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to add member", "details": str(e)}), 500


@app.get("/api/org/invite/<token>")
def get_invite_details(token: str):
    """PUBLIC: Return invite metadata so the frontend can display the accept page.

    No authentication required — this is called before the user logs in.
    """
    try:
        member = OrgMember.get_by_token(token)
        if not member or member.status != OrgMember.STATUS_PENDING:
            return jsonify({"error": "Invite not found or already accepted"}), 404

        owner = User.get_by_id(member.org_id)
        org_name = (owner.username or owner.email or member.org_id) if owner else member.org_id

        return jsonify({
            "org_id": member.org_id,
            "org_name": org_name,
            "role": member.role,
            "invite_email": member.invite_email,
        }), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to get invite details", "details": str(e)}), 500


@app.post("/api/org/invite/accept")
def accept_org_invite():
    """Authenticated user accepts a pending invite using their token.

    Body JSON:
        token (str): The invite token from the email link.

    The logged-in user's account is linked to the invite.  Their email must
    match the address the invite was sent to.
    """
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in to accept an invite"}), 401

        data = request.get_json(silent=True) or {}
        token = (data.get("token") or "").strip()
        if not token:
            return jsonify({"error": "token is required"}), 400

        member = OrgMember.get_by_token(token)
        if not member:
            return jsonify({"error": "Invalid or expired invite token"}), 404
        if member.status == OrgMember.STATUS_ACTIVE:
            return jsonify({"error": "This invite has already been accepted"}), 409

        # Verify the logged-in user's email matches the invite
        user = User.get_by_id(user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404

        if member.invite_email and (user.email or "").lower() != member.invite_email:
            return jsonify({
                "error": "This invite was sent to a different email address",
                "expected": member.invite_email,
            }), 403

        success = member.accept(user_id)
        if not success:
            return jsonify({"error": "Failed to accept invite"}), 500

        owner = User.get_by_id(member.org_id)
        org_name = (owner.username or owner.email or member.org_id) if owner else member.org_id

        return jsonify({
            "success": True,
            "message": f"You are now a {member.role} in {org_name}",
            "member": member.to_dict(),
        }), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to accept invite", "details": str(e)}), 500


@app.put("/api/org/members/<member_user_id>")
def update_org_member_role(member_user_id: str):
    """Owner only: change the role of an existing sub-user.

    Body JSON:
        role (str): ``"admin"`` or ``"manager"``.
    """
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        data = request.get_json(silent=True) or {}
        new_role = (data.get("role") or "").strip().lower()
        if new_role not in OrgMember.VALID_ROLES:
            return jsonify({"error": f"role must be one of: {sorted(OrgMember.VALID_ROLES)}"}), 400

        member = OrgMember.get_membership(user_id, member_user_id)
        if not member:
            return jsonify({"error": "Member not found"}), 404

        if not member.update_role(new_role):
            return jsonify({"error": "Failed to update role"}), 500

        return jsonify({
            "success": True,
            "message": f"Role updated to {new_role}",
            "member": member.to_dict(),
        }), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to update role", "details": str(e)}), 500


@app.delete("/api/org/members/<member_user_id>")
def remove_org_member(member_user_id: str):
    """Owner only: remove a sub-user from the organization."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        member = OrgMember.get_membership(user_id, member_user_id)
        if not member:
            return jsonify({"error": "Member not found"}), 404

        if not member.remove():
            return jsonify({"error": "Failed to remove member"}), 500

        return jsonify({"success": True, "message": "Member removed"}), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to remove member", "details": str(e)}), 500


@app.post("/api/org/members/<member_user_id>/assignments")
def add_member_assignment(member_user_id: str):
    """Owner only: assign a group or form request to a sub-user.

    Body JSON:
        resource_type (str): ``"group"`` or ``"form_request"``.
        resource_id   (str): Firestore document ID of the resource.
    """
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        data = request.get_json(silent=True) or {}
        resource_type = (data.get("resource_type") or "").strip()
        resource_id = (data.get("resource_id") or "").strip()

        if resource_type not in ("group", "form_request"):
            return jsonify({"error": "resource_type must be 'group' or 'form_request'"}), 400
        if not resource_id:
            return jsonify({"error": "resource_id is required"}), 400

        member = OrgMember.get_membership(user_id, member_user_id)
        if not member:
            return jsonify({"error": "Member not found"}), 404

        if not member.add_assignment(resource_type, resource_id):
            return jsonify({"error": "Failed to add assignment"}), 500

        return jsonify({
            "success": True,
            "message": f"Assigned {resource_type} {resource_id} to member",
            "assignments": member.assignments,
        }), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to add assignment", "details": str(e)}), 500


@app.delete("/api/org/members/<member_user_id>/assignments/<resource_type>/<resource_id>")
def remove_member_assignment(member_user_id: str, resource_type: str, resource_id: str):
    """Owner only: revoke a sub-user's access to a specific resource."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        if resource_type not in ("group", "form_request"):
            return jsonify({"error": "resource_type must be 'group' or 'form_request'"}), 400

        member = OrgMember.get_membership(user_id, member_user_id)
        if not member:
            return jsonify({"error": "Member not found"}), 404

        removed = member.remove_assignment(resource_type, resource_id)
        if not removed:
            return jsonify({"error": "Assignment not found"}), 404

        return jsonify({
            "success": True,
            "message": "Assignment removed",
            "assignments": member.assignments,
        }), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to remove assignment", "details": str(e)}), 500


@app.get("/api/my-organizations")
def list_my_organizations():
    """Authenticated user: list all organizations they belong to as a sub-user."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        memberships = OrgMember.get_user_memberships(user_id)

        orgs = []
        for m in memberships:
            owner = User.get_by_id(m.org_id)
            orgs.append({
                **m.to_dict(),
                "org_name": (owner.username or owner.email or m.org_id) if owner else m.org_id,
            })

        return jsonify({"organizations": orgs}), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to list organizations", "details": str(e)}), 500


@app.get("/api/my-organizations/<org_id>/assignments")
def get_my_assignments(org_id: str):
    """Sub-user: list the resources assigned to them within a specific org."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        member = OrgMember.get_membership(org_id, user_id)
        if not member or member.status != OrgMember.STATUS_ACTIVE:
            return jsonify({"error": "Not a member of this organization"}), 403

        return jsonify({
            "org_id": org_id,
            "role": member.role,
            "assignments": member.assignments,
        }), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": "Failed to get assignments", "details": str(e)}), 500


# ============= END ORG MEMBER ROUTES =============


# ============= EMAILIT WEBHOOK (public, no auth) =============

@app.post("/api/webhooks/emailit")
def webhook_emailit():
    """
    Public endpoint for Emailit delivery tracking events.
    Verifies X-Emailit-Signature (HMAC-SHA256 of body) before processing.
    """
    from models.database import Collections
    from datetime import datetime

    raw_body = request.get_data(as_text=False)
    signature = request.headers.get("X-Emailit-Signature", "").strip()
    secret = os.environ.get("EMAILIT_WEBHOOK_SECRET")

    if secret:
        expected = hmac.new(
            secret.encode("utf-8"),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return jsonify({"error": "Invalid signature"}), 400
    else:
        print("WARNING: EMAILIT_WEBHOOK_SECRET not set; skipping webhook signature verification (dev mode)")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        print(f"Webhook body parse error: {e}")
        return jsonify({"received": True}), 200

    event_type = payload.get("event_type") or payload.get("event") or payload.get("type")
    if not event_type:
        return jsonify({"received": True}), 200

    # Extract recipient and request_id; adjust keys if Emailit payload structure differs
    recipient_email = payload.get("email") or payload.get("recipient_email") or payload.get("to")
    if isinstance(recipient_email, dict):
        recipient_email = recipient_email.get("email") or recipient_email.get("address")
    recipient_email = (recipient_email or "").strip()
    metadata = payload.get("metadata") or {}
    request_id = metadata.get("request_id") if isinstance(metadata, dict) else None

    handled = {"email.delivered", "email.opened", "email.link_clicked", "email.bounced"}
    if event_type not in handled:
        return jsonify({"received": True}), 200

    try:
        db = get_db()
        now = datetime.utcnow().isoformat() + "Z"
        db.collection(Collections.EMAIL_EVENTS).add({
            "event_type": event_type,
            "recipient_email": recipient_email,
            "request_id": request_id,
            "timestamp": now,
            "raw_payload": payload,
        })
        if event_type == "email.bounced":
            reason = payload.get("reason") or payload.get("bounce_reason") or payload.get("message")
            EmailService.mark_bounced(recipient_email, reason=reason)
    except Exception as e:
        print(f"Webhook log error: {e}")

    return jsonify({"received": True}), 200


# 4. Run the Server
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=True, host='0.0.0.0', port=port)
    