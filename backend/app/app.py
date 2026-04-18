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
from google.cloud.firestore_v1.base_query import FieldFilter
from models.user import User
from models.group import Group
from models.org_membership import OrgMembership
from models.opt_out_event import OptOutEvent
from models.org_member import OrgMember
from models.email_open_event import EmailOpenEvent
from config import settings
from utils.google_forms_service import GoogleFormsService
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

# LOGIN REDIRECT FROM COOKIE DROPPING FIX PART 1
from werkzeug.middleware.proxy_fix import ProxyFix

# -------------------------

# 1. Initialize Flask
app = Flask(__name__)
app.secret_key = settings.SECRET_KEY  # Required for sessions

# COOKIE DROPPING FIX PART 2
# tell flask to trust google cloud load balancer for https routing stuff
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)


# # Session cookie config — required for cross-origin cookies (frontend/backend on different domains)
# is_production = not settings.DEBUG
# app.config['SESSION_COOKIE_SAMESITE'] = 'None' if is_production else 'Lax'
# app.config['SESSION_COOKIE_SECURE'] = is_production
# app.config['SESSION_COOKIE_HTTPONLY'] = True

# COOKIE DROPPING FIX PART 3
# hardcode the samesite policy
app.config['SESSION_COOKIE_SAMESITE'] = 'None'
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_NAME'] = 'formreminder_session'  # explicit name, avoids 'session' conflicts

# disable strict slashes globally
app.url_map.strict_slashes = False

# COOKIE DROPPING FIX PART 4
# hardcode this for now, we could set it back if needed
# frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")
CORS(app,
     origins=["http://localhost:5173", "https://formreminder-frontend-176029126556.us-central1.run.app"],
     supports_credentials=True,
     allow_headers=["Content-Type", "X-Org-ID"],
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


def _create_notification(owner_id: str, notif_type: str, message: str, data=None) -> None:
    """Persist a simple in-app notification for an org owner/admin."""
    try:
        from models.database import Collections
        from datetime import datetime

        db = get_db()
        db.collection(Collections.NOTIFICATIONS).add(
            {
                "owner_id": owner_id,
                "type": notif_type,
                "message": message,
                "data": data or {},
                "read": False,
                "created_at": datetime.utcnow().isoformat() + "Z",
            }
        )
    except Exception as e:
        print(f"Warning: failed to create notification: {e}")

# ---------------------------------------------------------------------------
# Sub-user / org-context helpers
# ---------------------------------------------------------------------------

def _resolve_org_context(session_user_id: str, org_id: str | None):
    """Resolve the effective owner for a request that may come from a sub-user.

    The frontend sends an optional ``X-Org-ID`` header when the logged-in user
    is acting on behalf of another owner's organization.  This helper validates
    that relationship and returns everything the calling route needs.

    Args:
        session_user_id: The currently authenticated user's ID.
        org_id: Value of the ``X-Org-ID`` request header, or ``None``.

    Returns:
        A 3-tuple ``(effective_owner_id, membership_or_None, error_or_None)``.

        - ``effective_owner_id`` – the ``owner_id`` to use in DB queries.
        - ``membership_or_None`` – the ``OrgMember`` record if acting as a
          sub-user, ``None`` when acting as own org.
        - ``error_or_None`` – a Flask ``(Response, status_code)`` tuple to
          return immediately if access is denied, otherwise ``None``.
    """
    if not org_id or org_id == session_user_id:
        return session_user_id, None, None

    membership = OrgMember.get_membership(org_id, session_user_id)
    if not membership or membership.status != OrgMember.STATUS_ACTIVE:
        from flask import jsonify as _jsonify
        return None, None, (_jsonify({"error": "Not an active member of this organization"}), 403)

    return org_id, membership, None


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


def _classify_forms_api_error(err: Exception) -> str:
    """Normalize Google Forms API errors into warning-friendly reason codes."""
    text = str(err or "").lower()
    if (
        "requested entity was not found" in text
        or " 404" in text
        or "404 " in text
        or "not found" in text
    ):
        return "form_not_found"
    if (
        "forbidden" in text
        or " 403" in text
        or "403 " in text
        or "permission" in text
        or "insufficient" in text
        or "access denied" in text
    ):
        return "account_mismatch_or_no_access"
    if "invalid_grant" in text or "revoked" in text or "credentials" in text:
        return "credentials_invalid"
    return "api_error"


def _build_form_warnings(form_data: dict) -> list[str]:
    """Build user-facing warnings from the latest persisted form state."""
    warnings: list[str] = []

    form_settings = form_data.get('form_settings', {}) or {}
    email_checked = form_settings.get('email_collection_checked', True)
    email_collection_enabled = form_settings.get('email_collection_enabled', True)
    if email_checked and not email_collection_enabled:
        warnings.append(
            "Email collection is currently OFF for this Google Form. In Google Forms: "
            "Settings -> Responses -> turn on 'Collect email addresses'."
        )

    api_access_available = form_data.get('api_access_available', True)
    api_error_reason = form_data.get('api_error_reason')
    if not api_access_available:
        if api_error_reason == 'account_mismatch_or_no_access':
            warnings.append(
                "The Google account you connected does not currently have edit access to this form. "
                "Connect the correct Google account or share the form with that account as an editor."
            )
        elif api_error_reason == 'form_not_found':
            warnings.append(
                "This form could not be found by the API. Use the Google Forms edit URL (contains /edit), "
                "not the public view/share URL."
            )
        elif api_error_reason == 'credentials_invalid':
            warnings.append(
                "Your Google connection is no longer valid. Reconnect your Google account to resume syncing."
            )
        else:
            warnings.append(
                "We could not access this form via the Google API. We will keep retrying on sync, and this "
                "warning will clear automatically once access works again."
            )

    return warnings

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


@app.get("/")
def root():
    """Root endpoint - This is what you see at localhost:5000"""
    return {
        "message": "Welcome to FR API. Visit localhost:5173 to see the App.",
        "status": "running",
    }


# AUTHENTICATION ROUTES

@app.post("/api/register")
def register():
    """Register a new user"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        username = data.get('username')
        email = data.get('email')
        password = data.get('password')
        
        # Validate input
        if not username or not email or not password:
            return jsonify({"error": "Username, email, and password are required"}), 400
        
        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400
        
        print(f"Attempting to register user: {username}")
        
        user = User.create_user(username, email, password)
        
        if not user:
            return jsonify({"error": "Username or email already exists"}), 409
        
        session['user_id'] = user.id
        
        print(f"User registered and logged in: {user.id}")
        
        return jsonify({
            "success": True,
            "message": "User registered successfully",
            "user": user.to_safe_dict()
        }), 201
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error during registration: {error_msg}")
        return jsonify({
            "error": "Registration failed",
            "details": error_msg
        }), 500

@app.post("/api/reset")
def reset():
    """Reset a user's password"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        username = data.get('username')
        password = data.get('password')
        
        # Validate input
        if not username or not password:
            return jsonify({"error": "Username and password are required"}), 400
        
        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400
        
        print(f"Attempting to reset password for user: {username}")
        
        user = User.reset_password(username, password)
        
        if not user:
            return jsonify({"error": "Password reset failed"}), 409
        
        session['user_id'] = user.id
        
        print(f"User password reset: {user.id}")
        
        return jsonify({
            "success": True,
            "message": "Password reset successfully",
            "user": user.to_safe_dict()
        }), 201
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error during registration: {error_msg}")
        return jsonify({
            "error": "Password reset failed",
            "details": error_msg
        }), 500

@app.post("/api/login")
def login():
    """Login an existing user"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({"error": "Username and password are required"}), 400
        
        print(f"Login attempt for username: {username}")
        
        user = User.get_by_username(username)
        
        if not user:
            print(f"User not found: {username}")
            return jsonify({"error": "Invalid username or password"}), 401
        
        if not User.verify_password(user.password_hash, password):
            print(f"Invalid password for user: {username}")
            return jsonify({"error": "Invalid username or password"}), 401
        
        session['user_id'] = user.id
        
        print(f"User logged in successfully: {user.id}")
        
        return jsonify({
            "success": True,
            "message": "Logged in successfully",
            "user": user.to_safe_dict()
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error during login: {error_msg}")
        return jsonify({
            "error": "Login failed",
            "details": error_msg
        }), 500


@app.post("/api/logout")
def logout():
    """Logout the current user"""
    try:
        user_id = session.get('user_id')
        session.clear()
        print(f"User logged out: {user_id}")
        
        return jsonify({
            "success": True,
            "message": "Logged out successfully"
        }), 200
        
    except Exception as e:
        print(f"Error during logout: {e}")
        return jsonify({
            "error": "Logout failed"
        }), 500


@app.get("/api/current-user")
def current_user():
    """Get the currently logged in user"""
    try:
        user_id = session.get('user_id')
        
        if not user_id:
            return jsonify({"authenticated": False}), 200
        
        user = User.get_by_id(user_id)
        
        if not user:
            session.clear()
            return jsonify({"authenticated": False}), 200
        
        return jsonify({
            "authenticated": True,
            "user": user.to_safe_dict()
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error getting current user: {error_msg}")
        return jsonify({
            "authenticated": False,
            "error": error_msg
        }), 500



# GOOGLE OAUTH ROUTES

@app.get("/login/google")
def google_login():
    """Initiate Google OAuth flow"""
    try:
        user_id = session.get('user_id')
        
        if not user_id:
            return jsonify({"error": "Must be logged in to connect Google account"}), 401
        
        # Generate a unique state token for CSRF protection
        import secrets
        state = secrets.token_urlsafe(32)
        session['oauth_state'] = state
        
        # Build redirect URI dynamically from the current request
        google_redirect_uri = request.url_root.rstrip('/') + '/oauth/callback'
        session['google_redirect_uri'] = google_redirect_uri
        
        # Get authorization URL
        authorization_url = GoogleFormsService.get_authorization_url(state, google_redirect_uri)
        
        print(f"User {user_id} initiating Google OAuth")
        print(f"Authorization URL: {authorization_url}")
        
        return jsonify({
            "authorization_url": authorization_url
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error initiating Google login: {error_msg}")
        return jsonify({
            "error": "Failed to initiate Google login",
            "details": error_msg
        }), 500


@app.get("/oauth/callback")
def oauth_callback():
    """Handle Google OAuth callback"""
    try:
        # Get the authorization code
        code = request.args.get('code')
        state = request.args.get('state')
        error = request.args.get('error')
        
        if error:
            print(f"OAuth error: {error}")
            fe_url = os.environ.get('FRONTEND_URL', 'http://localhost:5173')
            return f"<html><body><h1>Authorization Failed</h1><p>{error}</p><a href='{fe_url}'>Return to app</a></body></html>", 400
        
        if not code:
            return "<html><body><h1>No authorization code received</h1></body></html>", 400
        
        # Verify state token (CSRF protection)
        expected_state = session.get('oauth_state')
        if not expected_state or state != expected_state:
            print("State mismatch - possible CSRF attack")
            return "<html><body><h1>Invalid state token</h1></body></html>", 400
        
        print(f"Received OAuth callback with code")
        
        # Exchange code for tokens
        google_redirect_uri = session.get('google_redirect_uri',
                                           request.url_root.rstrip('/') + '/oauth/callback')
        tokens = GoogleFormsService.exchange_code_for_tokens(code, state, google_redirect_uri)
        
        # Get current user
        user_id = session.get('user_id')
        if not user_id:
            return "<html><body><h1>Session expired, please log in again</h1></body></html>", 401
        
        user = User.get_by_id(user_id)
        if not user:
            return "<html><body><h1>User not found</h1></body></html>", 404
        
        # Store tokens in database
        success = user.update_google_tokens(
            access_token=tokens['access_token'],
            refresh_token=tokens['refresh_token'],
            expiry=tokens['token_expiry']
        )
        
        if success:
            print(f"Successfully stored Google tokens for user {user_id}")
            fe_url = os.environ.get('FRONTEND_URL', 'http://localhost:5173')
            return f"""
            <html>
            <body>
                <h1>Successfully connected Google account!</h1>
                <p>You can now close this window and return to the app.</p>
                <script>
                    setTimeout(function() {{
                        window.close();
                        window.location.href = '{fe_url}';
                    }}, 2000);
                </script>
            </body>
            </html>
            """, 200
        else:
            return "<html><body><h1>Failed to store tokens</h1></body></html>", 500
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error in OAuth callback: {error_msg}")
        return f"<html><body><h1>OAuth Callback Error</h1><p>{error_msg}</p></body></html>", 500


@app.get("/api/google-auth-status")
def google_auth_status():
    """Check if current user has connected their Google account"""
    try:
        user_id = session.get('user_id')
        
        if not user_id:
            return jsonify({"authenticated": False, "google_connected": False}), 200
        
        user = User.get_by_id(user_id)
        
        if not user:
            return jsonify({"authenticated": False, "google_connected": False}), 200
        
        has_google = bool(user.google_access_token and user.google_refresh_token)
        
        return jsonify({
            "authenticated": True,
            "google_connected": has_google
        }), 200
        
    except Exception as e:
        print(f"Error checking Google auth status: {e}")
        return jsonify({"error": str(e)}), 500




@app.get("/api/data")
def data():
    try:
        db = get_db()
        forms = db.collection('forms').stream()
        forms_list = []
        for form in forms:
            form_data = form.to_dict()
            forms_list.append({"id": form.id, **form_data})
        return jsonify(forms_list)
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error in /api/data: {error_msg}")
        return jsonify({
            "error": "Failed to fetch form data",
            "details": error_msg
        }), 500

# API request to get a form's id. Requires the link to the form be submitted as an argument.
@app.get("/api/getid")
def getid():
    from flask import request
    formlink = request.args.get('formlink', '')
    
    if not formlink:
        return jsonify({"error": "formlink parameter is required"}), 400
    
    try:
        # Extract form ID from URL
        parts = formlink.split("/")
        form_id = None
        
        # Find the form ID (it's after /d/)
        for i, part in enumerate(parts):
            if part == 'd' and i + 1 < len(parts):
                form_id = parts[i + 1]
                break
        
        if not form_id:
            return jsonify({"error": "Invalid Google Form URL format"}), 400
        
        return jsonify({
            "form_id": form_id,
            "form_url": formlink
        })
    except Exception as e:
        return jsonify({
            "error": "Failed to extract form ID",
            "details": str(e)
        }), 500

@app.get("/api/health")
def health_check():
    """Health check endpoint"""
    try:
        db = get_db()
        # Simple health check - just verify we can access the database
        # Don't write/delete to avoid unnecessary operations
        # Just check if we can get a reference
        test_ref = db.collection('_health_check').document('test')
        
        return jsonify({
            "status": "healthy",
            "database": "connected",
            "database_name": "formreminder"
        })
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error in /api/health: {error_msg}")
        return jsonify({
            "status": "unhealthy",
            "database": "disconnected",
            "error": error_msg
        }), 500

# Get all form requests
@app.get("/api/form-requests")
def get_form_requests():
    """Retrieve all form requests from the database.

    Sub-users may call this with the ``X-Org-ID`` header to list the form
    requests assigned to them within the specified organization.
    """
    from models.database import Collections

    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        db = get_db()

        form_requests = db.collection(Collections.FORM_REQUESTS)\
            .where(filter=FieldFilter('owner_id', '==', effective_owner_id))\
            .stream()

        # If acting as sub-user, only surface assigned form requests
        assigned_ids = (
            {a["resource_id"] for a in membership.assignments if a["resource_type"] == "form_request"}
            if membership else None
        )
        
        requests_list = []
        for req in form_requests:
            # Sub-user: skip form requests not in their assignment list
            if assigned_ids is not None and req.id not in assigned_ids:
                continue

            request_data = req.to_dict()

            # Get form data from forms collection to include last_synced_at, title, form_url, etc.
            form_id = request_data.get('form_id')
            if not form_id:
                # Fallback: try using google_form_id for older form requests
                form_id = request_data.get('google_form_id')
            
            form_data = {}
            if form_id:
                form_ref = db.collection(Collections.FORMS).document(form_id)
                form_doc = form_ref.get()
                if form_doc.exists:
                    form_data = form_doc.to_dict()
            
            # Don't use created_at as fallback for last_synced_at - they should be different
            # last_synced_at should only exist if the form has been synced
            
            # Get group to calculate total_recipients
            group_id = request_data.get('group_id')
            total_recipients = 0
            if group_id:
                group = Group.get_by_id(group_id)
                if group:
                    total_recipients = len(group.members)
            
            # Calculate response_count dynamically from responses collection
            response_count = 0
            responses_query = db.collection(Collections.RESPONSES)\
                .where(filter=FieldFilter('request_id', '==', req.id))\
                .stream()
            response_count = sum(1 for _ in responses_query)
            
            # Calculate warnings from the latest persisted API/form state
            warnings = _build_form_warnings(form_data)
            
            # Merge form data into request_data. Prefer form_request's own title so multiple
            # requests for the same Google Form each show their correct name (form doc is shared).
            merged_data = {
                **request_data,
                **form_data,  # form_url, description, last_synced_at, etc.
                "response_count": response_count,
                "total_recipients": total_recipients,
                "warnings": warnings
            }
            merged_data["title"] = request_data.get("title") or form_data.get("title") or "Untitled Form"

            requests_list.append({
                "id": req.id,
                **merged_data
            })
        
        print(f"Retrieved {len(requests_list)} form requests for user {user_id}")
        return jsonify(requests_list)
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error fetching form requests: {error_msg}")
        return jsonify({
            "error": "Failed to fetch form requests",
            "details": error_msg
        }), 500


# Get responses for a specific form request
@app.get("/api/form-requests/<request_id>/responses")
def get_form_request_responses(request_id: str):
    """Get all responses for a form request.

    Sub-users may call this with the ``X-Org-ID`` header provided they have
    been assigned to this form request.
    """
    from models.database import Collections

    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        db = get_db()

        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()

        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404

        request_data = request_doc.to_dict()

        # Verify ownership or sub-user assignment
        if membership:
            if not membership.can_perform("view", "form_request", request_id):
                return jsonify({"error": "Not assigned to this form request"}), 403
        elif request_data.get('owner_id') != effective_owner_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Get form data from forms collection
        form_id = request_data.get('form_id')
        form_data = {}
        if form_id:
            form_ref = db.collection(Collections.FORMS).document(form_id)
            form_doc = form_ref.get()
            if form_doc.exists:
                form_data = form_doc.to_dict()
        
        # Get the group
        group_id = request_data.get('group_id')
        group = None
        group_emails = set()
        
        if group_id:
            group = Group.get_by_id(group_id)
            if group:
                group_emails = {member['email'].lower() for member in group.members}
        
        # Get responses from database
        responses = db.collection(Collections.RESPONSES)\
            .where(filter=FieldFilter('request_id', '==', request_id))\
            .stream()
        
        responses_list = []
        non_member_responses = []
        
        # Normalize all response emails for matching
        for response in responses:
            response_data = response.to_dict()
            response_email = response_data.get('respondent_email', '').strip().lower()
            
            response_obj = {
                "id": response.id,
                **response_data,
                "is_member": response_email in group_emails if group_emails else True
            }
            
            if group_emails and response_email not in group_emails:
                non_member_responses.append(response_obj)
            else:
                responses_list.append(response_obj)
        
        # Create member status list - match by normalized email
        member_status = []
        if group:
            # Create a map of normalized emails to responses for quick lookup
            response_map = {}
            for r in responses_list:
                email_key = r.get('respondent_email', '').strip().lower()
                if email_key:
                    response_map[email_key] = r
            
            for member in group.members:
                member_email = member.get('email', '').strip().lower()
                member_email_original = member.get('email', '')  # Keep original for display
                
                # Check if this member has responded
                matching_response = response_map.get(member_email)
                has_responded = matching_response is not None
                
                member_status.append({
                    "email": member_email_original,
                    "status": "responded" if has_responded else "not_responded",
                    "submitted_at": matching_response.get('submitted_at') if matching_response else None
                })
                
                if has_responded:
                    print(f"  Member {member_email_original} has responded")
                else:
                    print(f"  Member {member_email_original} has not responded")
        
        print(f"Retrieved {len(responses_list)} member responses and {len(non_member_responses)} non-member responses for request {request_id}")
        
        # Calculate fresh total_recipients from group
        total_recipients = len(group.members) if group else 0
        response_count = len(responses_list)
        
        # Calculate warnings from the latest persisted API/form state
        warnings = _build_form_warnings(form_data)
        
        # Merge form data into request_data for response
        request_data_with_form = {
            **request_data,
            **form_data,  # Merge form data (form_url, title, description, etc.)
            "warnings": warnings
        }
        
        return jsonify({
            "form_request": {
                "id": request_id,
                **request_data_with_form,
                "response_count": response_count,  # Include response_count in form_request
                "total_recipients": total_recipients  # Override with fresh count from group
            },
            "responses": responses_list,
            "non_member_responses": non_member_responses,
            "member_status": member_status,
            "response_count": response_count,
            "non_member_count": len(non_member_responses),
            "total_recipients": total_recipients
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error fetching responses: {error_msg}")
        return jsonify({
            "error": "Failed to fetch responses",
            "details": error_msg
        }), 500


# NOTE: The refresh endpoint is now handled by the form_requests blueprint
# (routes/form_requests.py) which supports all providers (Google, Jotform,
# Microsoft).  The legacy Google-only handler that was here has been removed
# to eliminate the route collision that caused every refresh — even for
# Jotform/Microsoft requests — to go through Google token logic.

# Create a new form request
@app.post("/api/form-requests")
def create_form_request():
    """Create a new form request from a Google Form URL.

    Managers cannot create form requests.  Admins acting in an org context
    may create form requests owned by the org owner.
    """
    from datetime import datetime
    from models.database import Collections

    try:
        # Check if user is authenticated
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        # Managers cannot create form requests
        if membership and not membership.can_perform("create", "form_request", ""):
            return jsonify({"error": "Managers cannot create form requests"}), 403

        # Use org owner's account for Google credentials when admin acts on behalf of org
        user = User.get_by_id(effective_owner_id)
        if not user:
            return jsonify({"error": "User not found"}), 404

        # Check if user has connected Google account
        if not user.google_access_token or not user.google_refresh_token:
            return jsonify({
                "error": "Google account not connected",
                "message": "Please connect your Google account first",
                "action_required": "reconnect_google"
            }), 403
        
        data = request.get_json()
        if not data or 'form_url' not in data:
            return jsonify({"error": "form_url is required"}), 400
        
        if 'group_id' not in data:
            return jsonify({"error": "group_id is required"}), 400
        
        if 'due_date' not in data:
            return jsonify({"error": "due_date is required"}), 400
        
        form_url = data['form_url']
        group_id = data['group_id']
        
        # Parse reminder schedule data
        reminder_schedule = data.get('reminder_schedule', 'normal')
        first_reminder_timing = data.get('first_reminder_timing', 'immediate')
        custom_days = data.get('custom_days')  # For custom schedules
        
        # Parse due date
        try:
            due_date_str = data['due_date']
            if isinstance(due_date_str, str):
                due_date = datetime.fromisoformat(due_date_str.replace('Z', '+00:00'))
            else:
                return jsonify({"error": "Invalid due_date format"}), 400
        except (ValueError, AttributeError) as e:
            return jsonify({"error": f"Invalid due_date: {str(e)}"}), 400
        
        # Parse scheduled reminder date/time if provided
        scheduled_reminder_date = None
        scheduled_reminder_time = None
        if first_reminder_timing == 'scheduled':
            if data.get('scheduled_date'):
                try:
                    scheduled_reminder_date = datetime.fromisoformat(
                        data['scheduled_date'].replace('Z', '+00:00')
                    )
                except (ValueError, AttributeError):
                    return jsonify({"error": "Invalid scheduled_date format"}), 400
            
            if data.get('scheduled_time'):
                try:
                    scheduled_reminder_time = datetime.fromisoformat(
                        data['scheduled_time'].replace('Z', '+00:00')
                    )
                except (ValueError, AttributeError):
                    return jsonify({"error": "Invalid scheduled_time format"}), 400
        
        # Validate and process reminder schedule
        from utils.reminder_schedule import ReminderSchedule
        
        if reminder_schedule == 'custom':
            if not custom_days:
                return jsonify({"error": "custom_days required for custom schedule"}), 400
            is_valid, error_msg = ReminderSchedule.validate_custom_schedule(custom_days)
            if not is_valid:
                return jsonify({"error": error_msg}), 400
        
        schedule_config = ReminderSchedule.get_schedule_config(reminder_schedule, custom_days)
        
        # Verify group exists and the effective owner owns it
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404

        if group.owner_id != effective_owner_id:
            return jsonify({"error": "You don't own this group"}), 403
        
        print(f"Creating form request for URL: {form_url} with group: {group.name}")
        
        # Extract form ID
        form_id = GoogleFormsService.extract_form_id(form_url)
        if not form_id:
            return jsonify({"error": "Invalid Google Form URL"}), 400
        
        print(f"Extracted form ID: {form_id}")
        
        # Get user's Google credentials
        try:
            credentials = GoogleFormsService.get_credentials_from_tokens(
                access_token=user.google_access_token,
                refresh_token=user.google_refresh_token,
                token_expiry=user.token_expiry
            )
        except ValueError as cred_error:
            # Token was revoked or is invalid - clear it from database
            print(f"Credentials invalid: {cred_error}")
            print("Clearing invalid Google tokens from user account")
            user.update_google_tokens(access_token=None, refresh_token=None, expiry=None)
            return jsonify({
                "error": "Google credentials have been revoked",
                "message": "Please reconnect your Google account",
                "action_required": "reconnect_google"
            }), 401
        
        # Fetch form metadata (handle errors gracefully)
        print("Fetching form metadata...")
        metadata = {}
        api_access_available = False
        api_error_reason = None
        email_collection_enabled = True
        email_collection_checked = False
        
        try:
            metadata = GoogleFormsService.get_form_metadata(credentials, form_id)
            api_access_available = True
            
            # Check email collection (optional for now, just warn)
            print("Checking email collection...")
            try:
                email_collection_enabled = GoogleFormsService.check_email_collection(credentials, form_id)
                email_collection_checked = True
            except Exception as email_check_error:
                print(f"Warning: Could not check email collection: {email_check_error}")
                email_collection_enabled = True
                email_collection_checked = False
        except Exception as metadata_error:
            api_error_reason = _classify_forms_api_error(metadata_error)
            print(f"Warning: Could not fetch form metadata: {metadata_error}")
            if api_error_reason == 'account_mismatch_or_no_access':
                print("The connected Google account likely differs from the form owner's editor account.")
            print("The form request will be created, and sync will keep retrying in case this is fixed.")
            api_access_available = False
            # Use default metadata
            metadata = {
                'title': data.get('title', f"Form {form_id[:8]}"),
                'description': '',
                'email_collection_enabled': True,
                'email_collection_type': 'UNKNOWN'
            }
        
        # Get initial response count (only if API access is available)
        responses = []
        if api_access_available:
            print("Fetching initial responses...")
            try:
                responses = GoogleFormsService.get_form_responses(credentials, form_id)
            except Exception as responses_error:
                print(f"Warning: Could not fetch initial responses: {responses_error}")
                responses = []
        else:
            print("Skipping initial response fetch (API access not available)")
        
        if not email_collection_enabled and api_access_available:
            print("WARNING: Email collection may not be enabled on this form")
        
        db = get_db()
        
        # Calculate reminder dates based on schedule
        reminder_days = schedule_config['reminder_days']
        reminder_dates = ReminderSchedule.calculate_reminder_dates(due_date, reminder_days)
        
        # Create or update form document in forms collection
        now = datetime.utcnow().isoformat() + 'Z'
        form_doc_id = form_id  # Use google_form_id as the document ID
        
        form_data = {
            'google_form_id': form_id,
            'form_url': form_url,
            'title': data.get('title') or metadata.get('title', f"Form {form_id[:8]}"),
            'description': metadata.get('description', ''),
            'owner_id': effective_owner_id,
            'created_at': now,
            'updated_at': now,
            'is_active': True,
            'api_access_available': api_access_available,  # Set based on whether we could fetch metadata
            'api_error_reason': api_error_reason,
            # Don't set last_synced_at on creation - it will be set when first synced
            'form_settings': {
                'email_collection_enabled': email_collection_enabled,
                'email_collection_type': metadata.get('email_collection_type', 'UNKNOWN'),
                'email_collection_checked': email_collection_checked,
            }
        }
        
        form_ref = db.collection(Collections.FORMS).document(form_doc_id)
        form_doc = form_ref.get()
        if form_doc.exists:
            # Update existing form document. Do not overwrite title/description so that
            # other form requests for this same form keep showing their own or the
            # original form doc title (each form_request stores its own title for display).
            form_ref.update({
                'form_url': form_url,
                'updated_at': now,
                'api_access_available': api_access_available,
                'api_error_reason': api_error_reason,
                'form_settings': form_data['form_settings']
            })
        else:
            # Create new form document (without last_synced_at - will be set on first sync)
            form_ref.set(form_data)
        
        # Create form request document with enhanced metadata.
        # Store title on the form_request so multiple requests for the same Google Form
        # each keep their own display name (the shared form doc would otherwise overwrite).
        request_title = data.get('title') or metadata.get('title', f"Form {form_id[:8]}") or 'Untitled Form'
        form_request_data = {
            'form_id': form_doc_id,  # Reference to forms collection
            'google_form_id': form_id,
            'owner_id': effective_owner_id,
            'group_id': group_id,
            'title': request_title,
            'created_at': now,
            'status': 'Active',
            'is_active': True,
            # Reminder schedule configuration
            'due_date': due_date.isoformat() + 'Z',
            'reminder_schedule': {
                'schedule_type': reminder_schedule,
                'reminder_days': reminder_days,
                'is_custom': schedule_config['is_custom'],
                'custom_days': custom_days if reminder_schedule == 'custom' else None,
                'calculated_reminder_dates': [d.isoformat() + 'Z' for d in reminder_dates]
            },
            'first_reminder_timing': {
                'timing_type': first_reminder_timing,
                'scheduled_date': scheduled_reminder_date.isoformat() + 'Z' if scheduled_reminder_date else None,
                'scheduled_time': scheduled_reminder_time.isoformat() + 'Z' if scheduled_reminder_time else None,
            }
        }
        
        # Add to form_requests collection
        doc_ref = db.collection(Collections.FORM_REQUESTS).document()
        doc_ref.set(form_request_data)
        
        # Store responses in responses collection
        for response in responses:
            response_data = {
                'request_id': doc_ref.id,
                'form_id': form_id,
                'respondent_email': response.get('respondent_email', ''),
                'response_id': response.get('response_id', ''),
                'submitted_at': response.get('submitted_at', ''),
                'created_at': datetime.utcnow().isoformat() + 'Z'
            }
            db.collection(Collections.RESPONSES).add(response_data)
        
        print(f"Form request created with ID: {doc_ref.id}")
        print(f"   Title: {metadata.get('title')}")
        print(f"   Responses: {len(responses)}")
        print(f"   Email collection: {email_collection_enabled}")
        
        return jsonify({
            "success": True,
            "id": doc_ref.id,
            "form_request": {
                "id": doc_ref.id,
                **form_request_data
            }
        }), 201
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error creating form request: {error_msg}")
        return jsonify({
            "error": "Failed to create form request",
            "details": error_msg
        }), 500


@app.post("/api/form-requests/custom-schedule")
def create_custom_schedule():
    """Create and validate a custom reminder schedule"""
    from utils.reminder_schedule import ReminderSchedule
    
    try:
        data = request.get_json()
        if not data or 'custom_days' not in data:
            return jsonify({"error": "custom_days is required"}), 400
        
        custom_days = data['custom_days']
        
        if not isinstance(custom_days, list):
            return jsonify({"error": "custom_days must be a list"}), 400
        
        # Validate the custom schedule
        is_valid, error_msg = ReminderSchedule.validate_custom_schedule(custom_days)
        
        if not is_valid:
            return jsonify({"error": error_msg}), 400
        
        # Get the schedule configuration
        schedule_config = ReminderSchedule.get_schedule_config('custom', custom_days)
        
        return jsonify({
            "success": True,
            "schedule": schedule_config,
            "message": "Custom schedule created successfully"
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        return jsonify({
            "error": "Failed to create custom schedule",
            "details": error_msg
        }), 500


@app.delete("/api/form-requests/<request_id>")
def delete_form_request(request_id: str):
    """Delete a form request and all its responses.

    Managers cannot delete form requests.  Admins may delete within their
    assigned scope.  Only the org owner can delete unassigned requests.
    """
    from models.database import Collections

    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        db = get_db()

        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()

        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404

        request_data = request_doc.to_dict()

        # Verify ownership or admin delete permission
        if membership:
            if not membership.can_perform("delete", "form_request", request_id):
                return jsonify({"error": "Not authorized to delete this form request"}), 403
        elif request_data.get('owner_id') != effective_owner_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Delete all responses for this request
        responses = db.collection(Collections.RESPONSES)\
            .where(filter=FieldFilter('request_id', '==', request_id))\
            .stream()
        
        deleted_responses = 0
        for response in responses:
            response.reference.delete()
            deleted_responses += 1
        
        # Delete the form request
        request_ref.delete()
        
        print(f"Deleted form request {request_id} and {deleted_responses} responses")
        
        return jsonify({
            "success": True,
            "message": "Form request deleted",
            "deleted_responses": deleted_responses
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error deleting form request: {error_msg}")
        return jsonify({
            "error": "Failed to delete form request",
            "details": error_msg
        }), 500


# ============= GROUPS ROUTES =============

@app.post("/api/groups")
def create_group():
    """Create a new group.  Managers cannot create groups; admins may."""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        if membership and not membership.can_perform("create", "group", ""):
            return jsonify({"error": "Managers cannot create groups"}), 403

        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({"error": "Group name is required"}), 400

        name = data['name'].strip()
        description = data.get('description', '').strip()

        if not name:
            return jsonify({"error": "Group name cannot be empty"}), 400

        print(f"Creating group: {name} for user {effective_owner_id}")

        group = Group.create_group(
            name=name,
            description=description,
            owner_id=effective_owner_id
        )
        
        if not group:
            return jsonify({"error": "Failed to create group"}), 500
        
        return jsonify({
            "success": True,
            "message": "Group created successfully",
            "group": group.to_dict()
        }), 201
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error creating group: {error_msg}")
        return jsonify({
            "error": "Failed to create group",
            "details": error_msg
        }), 500


@app.get("/api/groups")
def get_user_groups():
    """Get groups for the current user or, via X-Org-ID, their assigned groups."""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        print(f"Fetching groups for owner: {effective_owner_id}")

        all_groups = Group.get_user_groups(effective_owner_id)

        # Sub-user: filter to assigned groups only
        if membership:
            assigned_group_ids = {
                a["resource_id"] for a in membership.assignments
                if a["resource_type"] == "group"
            }
            groups = [g for g in all_groups if g.id in assigned_group_ids]
        else:
            groups = all_groups
        
        groups_list = [g.to_dict() for g in groups]

        print(f"Found {len(groups_list)} groups")

        return jsonify({
            "groups": groups_list,
            "count": len(groups_list)
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error fetching groups: {error_msg}")
        return jsonify({
            "error": "Failed to fetch groups",
            "details": error_msg
        }), 500


@app.get("/api/groups/<group_id>")
def get_group(group_id: str):
    """Get a specific group with all members."""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        group = Group.get_by_id(group_id)

        if not group:
            return jsonify({"error": "Group not found"}), 404

        # Verify ownership or sub-user assignment
        if membership:
            if not membership.can_perform("view", "group", group_id):
                return jsonify({"error": "Not assigned to this group"}), 403
        elif group.owner_id != effective_owner_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        return jsonify({
            "group": group.to_dict()
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error fetching group: {error_msg}")
        return jsonify({
            "error": "Failed to fetch group",
            "details": error_msg
        }), 500


@app.post("/api/groups/<group_id>/members")
def add_group_members(group_id: str):
    """Add members to a group (bulk email paste).

    Both owners and sub-users (admin or manager) with assignment to this
    group may add members.
    """
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        data = request.get_json()
        if not data or 'emails' not in data:
            return jsonify({"error": "Emails are required"}), 400

        emails_text = data['emails']

        # Get group
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404

        # Verify ownership or sub-user edit permission
        if membership:
            if not membership.can_perform("edit", "group", group_id):
                return jsonify({"error": "Not authorized to edit this group"}), 403
        elif group.owner_id != effective_owner_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Parse emails from text
        emails, invalid_count = Group.parse_emails(emails_text)
        
        if not emails:
            if invalid_count > 0:
                return jsonify({"error": f"No valid emails found. {invalid_count} entry(s) had improper formatting."}), 400
            return jsonify({"error": "No valid emails found"}), 400

        # Respect org-level opt-out (always scoped to the org owner).
        opted_out = []
        allowed_emails = []
        for e in emails:
            if OrgMembership.is_opted_out(effective_owner_id, e):
                opted_out.append(e)
            else:
                allowed_emails.append(e)
        
        print(f"Adding {len(emails)} emails to group {group_id}")
        
        # Add members
        added_count = group.add_members(allowed_emails)
        
        return jsonify({
            "success": True,
            "message": f"Added {added_count} new members",
            "added_count": added_count,
            "total_members": len(group.members),
            "skipped": len(emails) - added_count,  # Duplicates + opted-out
            "skipped_opted_out": opted_out
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error adding members: {error_msg}")
        return jsonify({
            "error": "Failed to add members",
            "details": error_msg
        }), 500


@app.delete("/api/groups/<group_id>/members/<email>")
def remove_group_member(group_id: str, email: str):
    """Remove a member from a group.

    Both owners and sub-users (admin or manager) with assignment may remove
    group members.
    """
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        print(f"Removing member {email} from group {group_id}")

        # Get group
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404

        # Verify ownership or sub-user edit permission
        if membership:
            if not membership.can_perform("edit", "group", group_id):
                return jsonify({"error": "Not authorized to edit this group"}), 403
        elif group.owner_id != effective_owner_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Remove member
        success = group.remove_member(email)

        if not success:
            return jsonify({"error": "Member not found"}), 404

        try:
            OptOutEvent.log(
                effective_owner_id, email, "left_group", "owner", "owner_dashboard",
                group_id=group_id, group_name=group.name,
            )
        except Exception:
            pass

        return jsonify({
            "success": True,
            "message": f"Removed {email}",
            "total_members": len(group.members)
        }), 200

    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error removing member: {error_msg}")
        return jsonify({
            "error": "Failed to remove member",
            "details": error_msg
        }), 500


@app.get("/api/groups/join/<invite_token>")
def get_group_by_token(invite_token: str):
    """PUBLIC: Get group info by invite token (for join page)"""
    try:
        print(f"Getting group info for token: {invite_token}")
        
        group = Group.get_by_invite_token(invite_token)
        
        if not group:
            return jsonify({"error": "Invalid invite link"}), 404
        
        # Return limited info (no members list, just group details)
        return jsonify({
            "group": {
                "id": group.id,
                "name": group.name,
                "description": group.description,
                "member_count": len(group.members)
            }
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error getting group by token: {error_msg}")
        return jsonify({
            "error": "Failed to get group info",
            "details": error_msg
        }), 500


@app.post("/api/groups/join/<invite_token>")
def join_group(invite_token: str):
    """PUBLIC: Join a group via invite link (no auth required)"""
    try:
        data = request.get_json()
        if not data or 'email' not in data:
            return jsonify({"error": "Email is required"}), 400
        
        email = data['email'].strip()
        
        # Validate email format
        if not Group.validate_email(email):
            return jsonify({"error": "Invalid email format"}), 400
        
        print(f"User {email} joining group via token: {invite_token}")
        
        # Get group
        group = Group.get_by_invite_token(invite_token)
        if not group:
            return jsonify({"error": "Invalid invite link"}), 404

        # Joining via invite link is an explicit opt-in; re-activate org membership if previously left.
        OrgMembership.ensure_active(group.owner_id, email, source="invite_join")
        
        # Add member
        success = group.add_member(email)
        
        if not success:
            # Check if already a member
            existing_emails = {member['email'].lower() for member in group.members}
            if email.lower() in existing_emails:
                return jsonify({
                    "success": True,
                    "message": "You're already a member of this group!",
                    "already_member": True
                }), 200
            else:
                return jsonify({"error": "Failed to join group"}), 500
        
        return jsonify({
            "success": True,
            "message": f"Successfully joined {group.name}!",
            "group_name": group.name
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error joining group: {error_msg}")
        return jsonify({
            "error": "Failed to join group",
            "details": error_msg
        }), 500


# ============= ORGANIZATION (USER) MEMBERSHIP / OPT-OUT =============

@app.route("/api/organizations/<owner_id>/leave", methods=["GET", "POST"])
def leave_organization(owner_id: str):
    """
    PUBLIC: Recipient opt-out endpoint.

    A recipient "leaving an organization" means:
    - mark org membership as left (global suppression for future emails)
    - remove the recipient from all groups owned by this org
    - notify the org owner/admin
    """
    try:
        # Support both email link clicks (GET query params) and JSON (POST).
        email = (request.args.get("email") or "").strip()
        token = (request.args.get("token") or "").strip()

        if request.method == "POST":
            body = request.get_json(silent=True) or {}
            email = (body.get("email") or email).strip()
            token = (body.get("token") or token).strip()

        if not email or not token:
            return jsonify({"error": "email and token are required"}), 400

        if not EmailService.verify_unsubscribe_token(owner_id, email, token):
            return jsonify({"error": "Invalid or expired token"}), 403

        # Mark opted out first (so even partial failures still suppress future emails).
        OrgMembership.mark_left(owner_id, email, reason="opt_out", source="recipient_leave_link")
        try:
            OptOutEvent.log(owner_id, email, "opted_out", "recipient", "email_link")
        except Exception:
            pass

        # Remove from all groups in this org (owner == org).
        removed_from_groups = 0
        groups = Group.get_user_groups(owner_id)
        for g in groups:
            try:
                if g.remove_member(email):
                    removed_from_groups += 1
            except Exception:
                # Continue best-effort; membership suppression already recorded.
                pass

        # Notify org owner/admin (in-app notification record).
        _create_notification(
            owner_id=owner_id,
            notif_type="recipient_left_org",
            message=f"{email} left your organization and was removed from {removed_from_groups} group(s).",
            data={"recipient_email": email, "removed_from_groups": removed_from_groups},
        )

        # Return a friendly page for email link clicks.
        if request.method == "GET":
            return (
                f"""
                <html>
                  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding: 32px;">
                    <h2>You're opted out</h2>
                    <p><strong>{email}</strong> has left this organization and will no longer receive emails from it.</p>
                    <p>You may close this tab.</p>
                  </body>
                </html>
                """,
                200,
                {"Content-Type": "text/html; charset=utf-8"},
            )

        return jsonify({"success": True, "message": "Opted out successfully"}), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to opt out", "details": str(e)}), 500


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
            .where(filter=FieldFilter("owner_id", "==", user_id))\
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
                .where(filter=FieldFilter("request_id", "==", req_id))\
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
            .where(filter=FieldFilter("owner_id", "==", user_id))\
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
        sent_per_form: dict[str, int] = {}
        if owner_request_ids:
            req_id_list = list(owner_request_ids)
            for i in range(0, len(req_id_list), 30):
                chunk = req_id_list[i:i + 30]
                logs = db.collection(Collections.EMAIL_LOGS)\
                    .where(filter=FieldFilter("request_id", "in", chunk))\
                    .where(filter=FieldFilter("success", "==", True))\
                    .stream()
                for log_doc in logs:
                    log_data = log_doc.to_dict() or {}
                    if cutoff_str is None or log_data.get("sent_at", "") >= cutoff_str:
                        total_sent += 1
                        rid = log_data.get("request_id", "")
                        if rid:
                            sent_per_form[rid] = sent_per_form.get(rid, 0) + 1

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

        # Attach emails_sent to each per_form entry
        for rid, entry in per_form.items():
            entry["emails_sent"] = sent_per_form.get(rid, 0)

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
    """Owner-only: Return submission counts per active form for the Analytics dashboard."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        db = get_db()

        # ── 1. Get all owner form requests that are active ─
        all_requests = db.collection(Collections.FORM_REQUESTS)\
            .where(filter=FieldFilter("owner_id", "==", user_id))\
            .stream()

        per_form: dict[str, dict] = {}
        owner_request_ids: list[str] = []
        group_ids_to_lookup: dict[str, str] = {}  # request_id -> group_id
        for req_doc in all_requests:
            data = req_doc.to_dict() or {}
            if not data.get("is_active", True):
                continue
            req_id = data.get("id") or req_doc.id
            title = data.get("title") or "Untitled"
            owner_request_ids.append(req_id)
            per_form[req_id] = {"request_id": req_id, "form_title": title, "submissions": 0, "total_recipients": 0}
            gid = data.get("group_id")
            if gid:
                group_ids_to_lookup[req_id] = gid

        if not owner_request_ids:
            return jsonify({"per_form": [], "total": 0}), 200

        # ── 1b. Look up group member counts for each form request ─────────
        unique_group_ids = set(group_ids_to_lookup.values())
        group_member_counts: dict[str, int] = {}
        for gid in unique_group_ids:
            try:
                g_doc = db.collection(Collections.GROUPS).document(gid).get()
                if g_doc.exists:
                    g_data = g_doc.to_dict() or {}
                    group_member_counts[gid] = len(g_data.get("members", []))
            except Exception:
                pass
        for req_id, gid in group_ids_to_lookup.items():
            per_form[req_id]["total_recipients"] = group_member_counts.get(gid, 0)

        # ── 2. Count responses per form (chunked to stay within Firestore 'in' limit) ─
        for i in range(0, len(owner_request_ids), 30):
            chunk = owner_request_ids[i:i + 30]
            responses = db.collection(Collections.RESPONSES)\
                .where(filter=FieldFilter("request_id", "in", chunk))\
                .stream()
            for resp_doc in responses:
                resp = resp_doc.to_dict() or {}
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
            f"get_submission_analytics: owner_id={user_id!r} "
            f"total={total} forms={len(per_form_list)}"
        )

        return jsonify({"per_form": per_form_list, "total": total}), 200

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
            results = list(db.collection(_C.USERS).where(filter=FieldFilter("email", "==", email)).stream())
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
        results = list(db.collection(_C.USERS).where(filter=FieldFilter("email", "==", email)).stream())
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

# This matches frontend/src/pages/ServerTime.tsx
@app.route('/time', methods=['GET'])
def get_current_time():
    """Endpoint to get the current server time"""
    from datetime import datetime
    now = datetime.now()
    return jsonify({
        "current_time": now.isoformat() + "Z"
    })


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


# ============= EMAIL REMINDER ROUTES =============

@app.post("/api/form-requests/<request_id>/send-reminder/<email>")
def send_single_reminder(request_id: str, email: str):
    """Send a reminder email to a single recipient.

    Both owners and sub-users with send_reminder permission on the assigned
    form request may call this endpoint.
    """
    from models.database import Collections

    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        db = get_db()

        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()

        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404

        request_data = request_doc.to_dict()

        # Verify ownership or sub-user send_reminder permission
        if membership:
            if not membership.can_perform("send_reminder", "form_request", request_id):
                return jsonify({"error": "Not authorized to send reminders for this form request"}), 403
        elif request_data.get('owner_id') != effective_owner_id:
            return jsonify({"error": "Unauthorized"}), 403

        # Get form info
        form_title = request_data.get('title', 'Untitled Form')
        form_url = request_data.get('form_url')

        print(f"Sending reminder to {email} for form: {form_title}")

        # Respect org-level opt-out (always scoped to the org owner)
        if OrgMembership.is_opted_out(effective_owner_id, email):
            return jsonify({"success": False, "error": "Recipient has opted out of this organization"}), 400

        # Send reminder
        result = EmailService.send_reminder(request_id, form_title, form_url, email, owner_id=effective_owner_id)
        
        if result['success']:
            return jsonify(result), 200
        else:
            return jsonify(result), 400
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error sending reminder: {error_msg}")
        return jsonify({
            "error": "Failed to send reminder",
            "details": error_msg
        }), 500


@app.post("/api/form-requests/<request_id>/send-reminders")
def send_bulk_reminders(request_id: str):
    """Send reminders to all non-responders (excluding recently sent).

    Both owners and sub-users with send_reminder permission on the assigned
    form request may trigger a bulk send.
    """
    from models.database import Collections

    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        org_id = request.headers.get("X-Org-ID")
        effective_owner_id, membership, err = _resolve_org_context(user_id, org_id)
        if err:
            return err

        db = get_db()

        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()

        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404

        request_data = request_doc.to_dict()

        # Verify ownership or sub-user send_reminder permission
        if membership:
            if not membership.can_perform("send_reminder", "form_request", request_id):
                return jsonify({"error": "Not authorized to send reminders for this form request"}), 403
        elif request_data.get('owner_id') != effective_owner_id:
            return jsonify({"error": "Unauthorized"}), 403

        # Get form info
        form_title = request_data.get('title', 'Untitled Form')
        form_url = request_data.get('form_url')
        group_id = request_data.get('group_id')
        
        if not group_id:
            return jsonify({"error": "No group attached to this form request"}), 400
        
        # Get group and member status
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Get responses to determine who hasn't responded
        responses = db.collection(Collections.RESPONSES)\
            .where(filter=FieldFilter('request_id', '==', request_id))\
            .stream()
        
        responded_emails = set()
        for response in responses:
            response_data = response.to_dict()
            email_lower = response_data.get('respondent_email', '').lower()
            if email_lower:
                responded_emails.add(email_lower)
        
        # Find non-responders
        non_responders = []
        opted_out = []
        for member in group.members:
            member_email = member['email']
            member_email_lower = member_email.lower()
            if member_email_lower in responded_emails:
                continue

            # Respect org-level opt-out (always scoped to org owner)
            if OrgMembership.is_opted_out(effective_owner_id, member_email):
                opted_out.append(member_email)
                continue

            non_responders.append(member_email)
        
        print(f"Found {len(non_responders)} non-responders out of {len(group.members)} members")
        
        if not non_responders:
            return jsonify({
                "success": True,
                "message": "All members have already responded!",
                "sent": 0,
                "skipped": 0,
                "failed": 0
            }), 200
        
        # Build recipient descriptors and dispatch via the batch sender.
        # One API call per person is intentional — every email body is personalised
        # with a unique per-recipient HMAC-signed unsubscribe URL.
        recipient_descriptors = [
            {
                "request_id": request_id,
                "form_title": form_title,
                "form_url": form_url,
                "recipient_email": email,
                "owner_id": effective_owner_id,
            }
            for email in non_responders
        ]

        summary = EmailService.send_reminders_batch(recipient_descriptors)

        sent = len(summary["sent"])
        skipped = len(summary["skipped"])
        failed = len(summary["failed"])
        not_attempted = len(summary["not_attempted"])

        response_body = {
            "success": True,
            "message": f"Sent {sent} reminders",
            "sent": sent,
            "skipped": skipped,
            "failed": failed,
            "opted_out": len(summary["opted_out"]),
            "bounced": len(summary["bounced"]),
            "not_attempted": not_attempted,
            "total_non_responders": len(non_responders),
            "skipped_opted_out": len(opted_out),
        }

        if summary["emailit_rate_limited"]:
            response_body["warning"] = (
                f"Emailit API rate limit reached (1000 emails/hour). "
                f"Sent {sent} of {len(non_responders)}. "
                f"{not_attempted} recipient(s) not attempted — try again later."
            )

        return jsonify(response_body), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error sending bulk reminders: {error_msg}")
        return jsonify({
            "error": "Failed to send reminders",
            "details": error_msg
        }), 500


# 4. Run the Server
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=True, host='0.0.0.0', port=port)
    