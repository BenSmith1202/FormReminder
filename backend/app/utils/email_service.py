# Email Service for sending reminders via Emailit HTTP API
import os
import json
import base64
import hmac
import hashlib
import urllib.parse
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from jinja2 import Environment, FileSystemLoader
from google.cloud.firestore_v1.base_query import FieldFilter
from models.database import get_db, Collections
from config import settings
from models.org_membership import OrgMembership

EMAILIT_API_URL = "https://api.emailit.com/v2/emails"


def _get_api_config() -> dict:
    """Read Emailit API config from environment (no hardcoded credentials)."""
    return {
        "api_key": (os.environ.get("EMAILIT_API_KEY") or "").strip(),
        "from_address": os.environ.get("EMAILIT_FROM_ADDRESS"),
        "from_name": os.environ.get("EMAILIT_FROM_NAME", "FormReminder"),
    }


class EmailService:
    """Service for sending email reminders to form recipients"""
    
    # Email configuration from environment variables
    SMTP_SERVER = "smtp.gmail.com"
    SMTP_PORT = 465  # Use SSL port instead of TLS port 587
    SMTP_USERNAME = "reminderform0@gmail.com"
    SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "mngnsqitifheoiid")  # Must be set in env for production; default is for local testing only
    FROM_EMAIL = "reminderform0@gmail.com"
    FROM_NAME = "FormReminder"
    
    # Rate limiting: 1 hour between reminders to same person
    RATE_LIMIT_HOURS = 1

    TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'templates')
    jinja_env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))

    @staticmethod
    def get_email_template(
        form_title: str,
        form_url: str,
        recipient_email: str,
        *,
        owner_id: Optional[str] = None,
        custom_message: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> str:
        """Load and render the email template with Jinja2.

        Args:
            form_title: Title of the form being requested.
            form_url: Direct link to the form.
            recipient_email: Recipient's email address.
            owner_id: Owner ID; enables the opt-out link and tracking pixel.
            custom_message: Optional personal message from the sender.
            request_id: Form request ID for per-send open tracking.

        Returns:
            Rendered HTML string ready to be sent as an email body.
        """
        unsubscribe_url = (
            EmailService.build_unsubscribe_url(owner_id, recipient_email)
            if owner_id
            else None
        )
        tracking_url = (
            EmailService.build_tracking_url(owner_id, recipient_email, request_id, form_title)
            if owner_id
            else None
        )
        template = EmailService.jinja_env.get_template('reminder_email.html')
        return template.render(
            form_title=form_title,
            form_url=form_url,
            recipient_email=recipient_email,
            unsubscribe_url=unsubscribe_url,
            custom_message=custom_message,
            tracking_url=tracking_url,
        )

    @staticmethod
    def _unsubscribe_token(owner_id: str, recipient_email: str) -> str:
        msg = f"{owner_id}:{recipient_email.strip().lower()}".encode("utf-8")
        key = (settings.SECRET_KEY or "").encode("utf-8")
        return hmac.new(key, msg, hashlib.sha256).hexdigest()

    @staticmethod
    def build_unsubscribe_url(owner_id: str, recipient_email: str) -> str:
        """
        Creates a signed URL that allows a recipient to leave (opt out of) an org.
        """
        email_norm = recipient_email.strip().lower()
        token = EmailService._unsubscribe_token(owner_id, email_norm)
        qs = urllib.parse.urlencode({"email": email_norm, "token": token})
        return f"{settings.BACKEND_PUBLIC_URL}/api/organizations/{owner_id}/leave?{qs}"

    @staticmethod
    def verify_unsubscribe_token(owner_id: str, recipient_email: str, token: str) -> bool:
        expected = EmailService._unsubscribe_token(owner_id, recipient_email.strip().lower())
        return hmac.compare_digest(expected, token or "")

    @staticmethod
    def build_tracking_token(
        owner_id: str,
        recipient_email: str,
        request_id: Optional[str] = None,
        form_title: Optional[str] = None,
    ) -> str:
        """Build a URL-safe base64 token encoding open-tracking context.

        The token is compact: keys are single characters to keep the URL short.
        It carries no sensitive secrets; recipients can decode it, but that
        only reveals their own email address and the form name — both of which
        they already know.

        Args:
            owner_id: ID of the owner/organization.
            recipient_email: Normalized recipient email address.
            request_id: ID of the associated form request.
            form_title: Human-readable form name.

        Returns:
            URL-safe base64 string (no padding) suitable for embedding in a URL.
        """
        payload = {
            "o": owner_id,
            "e": (recipient_email or "").strip().lower(),
            "r": request_id or "",
            "f": form_title or "",
        }
        return base64.urlsafe_b64encode(
            json.dumps(payload, separators=(",", ":")).encode("utf-8")
        ).rstrip(b"=").decode("utf-8")

    @staticmethod
    def build_tracking_url(
        owner_id: str,
        recipient_email: str,
        request_id: Optional[str] = None,
        form_title: Optional[str] = None,
    ) -> str:
        """Return the full tracking-pixel URL to embed in an email.

        Args:
            owner_id: ID of the owner/organization.
            recipient_email: Recipient email address.
            request_id: ID of the associated form request.
            form_title: Human-readable form name.

        Returns:
            Absolute URL pointing to the /api/track/open/<token> endpoint.
        """
        token = EmailService.build_tracking_token(
            owner_id, recipient_email, request_id, form_title
        )
        return f"{settings.BACKEND_PUBLIC_URL}/api/track/open/{token}"

    @staticmethod
    def is_bounced(recipient_email: str) -> bool:
        """Return True if the recipient is in the bounced_emails collection."""
        try:
            email = (recipient_email or "").strip().lower()
            if not email:
                return False
            db = get_db()
            ref = db.collection(Collections.BOUNCED_EMAILS).document(email)
            doc = ref.get()
            return doc.exists
        except Exception as e:
            print(f"Error checking bounced status: {e}")
            return False

    @staticmethod
    def mark_bounced(recipient_email: str, reason: Optional[str] = None) -> None:
        """Record a bounced email in Firestore (called from webhook handler)."""
        try:
            email = (recipient_email or "").strip().lower()
            if not email:
                return
            db = get_db()
            ref = db.collection(Collections.BOUNCED_EMAILS).document(email)
            ref.set({
                "email": email,
                "bounced_at": datetime.utcnow().isoformat() + "Z",
                "reason": reason or "",
            })
        except Exception as e:
            print(f"Failed to mark bounced: {e}")

    @staticmethod
    def send_email(to_email: str, subject: str, html_content: str) -> dict:
        """Send an email via the Emailit HTTP API (POST /v2/emails).

        Each recipient receives a separate request so that the HTML body can be
        personalised (unique unsubscribe URL, etc.).  Batching all recipients
        into a single ``to`` array is not used because every body is different.

        Args:
            to_email: Recipient email address.
            subject: Email subject line.
            html_content: Rendered HTML body.

        Returns:
            A dict with at minimum ``success`` (bool).  On a 429 response from
            Emailit, ``rate_limited`` is also set to ``True`` so callers can
            stop sending immediately rather than continuing to fail.
        """
        cfg = _get_api_config()
        if not cfg["api_key"]:
            print("EMAILIT_API_KEY must be set")
            return {"success": False, "error": "EMAILIT_API_KEY not configured"}

        from_addr = cfg["from_address"]
        if not from_addr:
            print("EMAILIT_FROM_ADDRESS must be set")
            return {"success": False, "error": "EMAILIT_FROM_ADDRESS not configured"}

        from_header = f"{cfg['from_name']} <{from_addr}>"

        payload = {
            "from": from_header,
            "to": [to_email],
            "subject": subject,
            "html": html_content,
        }

        try:
            print(f"[Emailit] POST {EMAILIT_API_URL} to={to_email} subject={subject[:50]}...")
            response = requests.post(
                EMAILIT_API_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {cfg['api_key']}",
                    "Content-Type": "application/json",
                },
                timeout=15,
            )
            print(f"[Emailit] Response {response.status_code} for {to_email}")

            if response.status_code in (200, 201):
                print(f"Email sent successfully to {to_email}")
                return {"success": True}

            if response.status_code == 429:
                print(f"Emailit API rate limit hit (429) sending to {to_email}")
                return {"success": False, "rate_limited": True, "error": "Emailit API rate limit exceeded (1000/hour)"}

            print(f"Emailit API error {response.status_code} sending to {to_email}: {response.text}")
            return {"success": False, "error": f"API error {response.status_code}: {response.text}"}

        except requests.RequestException as e:
            print(f"Failed to send email to {to_email}: {e}")
            return {"success": False, "error": str(e)}

    @staticmethod
    def can_send_reminder(request_id: str, recipient_email: str) -> bool:
        """Check if enough time has passed since last reminder (rate limiting)"""
        try:
            db = get_db()
            cutoff_time = datetime.utcnow() - timedelta(hours=EmailService.RATE_LIMIT_HOURS)
            cutoff_str = cutoff_time.isoformat() + 'Z'

            all_logs = db.collection(Collections.EMAIL_LOGS)\
                .where(filter=FieldFilter('request_id', '==', request_id))\
                .where(filter=FieldFilter('recipient_email', '==', recipient_email))\
                .stream()

            for log in all_logs:
                log_data = log.to_dict()
                if log_data.get('sent_at', '') >= cutoff_str and log_data.get('success', False):
                    return False
            return True
        except Exception as e:
            print(f"Error checking rate limit: {e}")
            return True

    @staticmethod
    def log_email_sent(request_id: str, recipient_email: str, success: bool):
        """Log email send attempt to database (unchanged; used for rate limiting)."""
        try:
            db = get_db()
            db.collection(Collections.EMAIL_LOGS).add({
                'request_id': request_id,
                'recipient_email': recipient_email,
                'sent_at': datetime.utcnow().isoformat() + 'Z',
                'success': success,
            })
        except Exception as e:
            print(f"Failed to log email: {e}")

    @staticmethod
    def send_reminder(
        request_id: str,
        form_title: str,
        form_url: str,
        recipient_email: str,
        *,
        owner_id: Optional[str] = None,
        skip_rate_limit: bool = False,
    ) -> dict:
        """Send a reminder email to a single recipient."""
        from utils.google_forms_service import GoogleFormsService
        from models.user import User

        if owner_id and OrgMembership.is_opted_out(owner_id, recipient_email):
            return {
                "success": False,
                "error": "Recipient has opted out of this organization",
                "opted_out": True,
            }

        if EmailService.is_bounced(recipient_email):
            return {
                "success": False,
                "error": "Recipient email has bounced",
                "bounced": True,
            }

        if not skip_rate_limit and not EmailService.can_send_reminder(request_id, recipient_email):
            return {
                'success': False,
                'error': f'Rate limit: Already sent to {recipient_email} within last {EmailService.RATE_LIMIT_HOURS} hour(s)'
            }

        viewform_url = GoogleFormsService.get_viewform_url(form_url) if form_url else form_url
        custom_message = None
        if owner_id:
            owner = User.get_by_id(owner_id)
            if owner and owner.email_custom_message:
                custom_message = owner.email_custom_message

        subject = f"Reminder: Please Complete {form_title}"
        unsubscribe_url = (
            EmailService.build_unsubscribe_url(owner_id, recipient_email)
            if owner_id
            else None
        )
        tracking_url = (
            EmailService.build_tracking_url(owner_id, recipient_email, request_id, form_title)
            if owner_id
            else None
        )
        template = EmailService.jinja_env.get_template("reminder_email.html")
        html_content = template.render(
            form_title=form_title,
            form_url=viewform_url,
            recipient_email=recipient_email,
            unsubscribe_url=unsubscribe_url,
            custom_message=custom_message,
            tracking_url=tracking_url,
        )

        send_result = EmailService.send_email(recipient_email, subject, html_content)
        EmailService.log_email_sent(request_id, recipient_email, send_result["success"])

        if send_result["success"]:
            return {"success": True, "message": f"Reminder sent to {recipient_email}"}

        # Surface rate_limited so the bulk sender can abort immediately.
        if send_result.get("rate_limited"):
            return {
                "success": False,
                "rate_limited": True,
                "error": send_result.get("error", "Emailit rate limit exceeded"),
            }

        return {"success": False, "error": send_result.get("error", "Failed to send email")}

    @staticmethod
    def send_reminders_batch(recipients: list, *, batch_size: int = 20) -> dict:
        """Send reminder emails to a list of recipients with controlled concurrency.

        Recipients are dispatched in groups of ``batch_size`` using a thread
        pool so the Emailit API is hit concurrently within each group rather
        than strictly sequentially.  After every group the results are inspected;
        if Emailit returned a 429 the remaining recipients are recorded in
        ``not_attempted`` and the loop stops.

        Each recipient requires its own API call because the HTML body is
        personalised (per-recipient HMAC-signed unsubscribe URL), so true
        single-request batching via the ``to`` array is not possible.

        Args:
            recipients: List of dicts, each with keys ``request_id``,
                ``form_title``, ``form_url``, ``recipient_email``, and
                optionally ``owner_id``.
            batch_size: Number of concurrent API calls per group.  Defaults
                to 20, which is well within Emailit's 1000/hour limit.

        Returns:
            Dict with the following keys:

            - ``sent`` – emails successfully delivered to the Emailit API
            - ``skipped`` – emails blocked by the app-level 1-hour cooldown
            - ``failed`` – emails that received a non-rate-limit error
            - ``opted_out`` – emails suppressed by org-level opt-out
            - ``bounced`` – emails suppressed due to a prior hard bounce
            - ``not_attempted`` – emails not reached because Emailit returned 429
            - ``emailit_rate_limited`` – True if a 429 was encountered
        """
        summary: dict = {
            "sent": [],
            "skipped": [],
            "failed": [],
            "opted_out": [],
            "bounced": [],
            "not_attempted": [],
            "emailit_rate_limited": False,
        }

        remaining = list(recipients)

        while remaining:
            batch = remaining[:batch_size]
            remaining = remaining[batch_size:]

            with ThreadPoolExecutor(max_workers=len(batch)) as executor:
                future_to_email = {
                    executor.submit(
                        EmailService.send_reminder,
                        r["request_id"],
                        r["form_title"],
                        r["form_url"],
                        r["recipient_email"],
                        owner_id=r.get("owner_id"),
                    ): r["recipient_email"]
                    for r in batch
                }

                for future in as_completed(future_to_email):
                    email = future_to_email[future]
                    try:
                        result = future.result()
                    except Exception as exc:
                        print(f"Unexpected error sending to {email}: {exc}")
                        summary["failed"].append(email)
                        continue

                    if result["success"]:
                        summary["sent"].append(email)
                    elif result.get("rate_limited"):
                        summary["emailit_rate_limited"] = True
                        summary["failed"].append(email)
                    elif result.get("opted_out"):
                        summary["opted_out"].append(email)
                    elif result.get("bounced"):
                        summary["bounced"].append(email)
                    elif "Rate limit" in result.get("error", ""):
                        summary["skipped"].append(email)
                    else:
                        summary["failed"].append(email)

            # Stop before the next batch if Emailit has rate-limited us.
            if summary["emailit_rate_limited"]:
                summary["not_attempted"] = [r["recipient_email"] for r in remaining]
                break

        print(
            f"Batch send complete: {len(summary['sent'])} sent, "
            f"{len(summary['skipped'])} skipped (cooldown), "
            f"{len(summary['failed'])} failed, "
            f"{len(summary['opted_out'])} opted-out, "
            f"{len(summary['bounced'])} bounced, "
            f"{len(summary['not_attempted'])} not attempted"
        )
        return summary
