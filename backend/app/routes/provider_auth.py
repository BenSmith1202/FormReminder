# Multi-provider authentication routes
# Handles Jotform and Microsoft OAuth flows, disconnect, and the unified
# /api/connected-accounts endpoint.

import secrets
from flask import Blueprint, jsonify, request, session

from models.user import User
from utils.form_provider import get_connected_providers
from utils.jotform_service import JotformService
from utils.microsoft_forms_service import MicrosoftFormsService

provider_auth_bp = Blueprint("provider_auth", __name__)

# -----------------------------------------------------------------------
# Unified connected-accounts check
# -----------------------------------------------------------------------

@provider_auth_bp.get("/api/connected-accounts")
def connected_accounts():
    """Return which form providers the current user has connected."""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"authenticated": False, "google": False, "jotform": False, "microsoft": False}), 200

    user = User.get_by_id(user_id)
    if not user:
        return jsonify({"authenticated": False, "google": False, "jotform": False, "microsoft": False}), 200

    result = get_connected_providers(user)
    result["authenticated"] = True
    return jsonify(result), 200


# -----------------------------------------------------------------------
# Jotform auth  –  The frontend will open a Jotform login popup.
# After the user authorises, the popup posts the resulting API key here.
# -----------------------------------------------------------------------

@provider_auth_bp.post("/api/auth/jotform/connect")
def jotform_connect():
    """Store a Jotform API key for the current user.

    Expected JSON body: ``{ "api_key": "..." }``
    The key is obtained on the frontend via the Jotform JS login widget.
    """
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json(silent=True) or {}
    api_key = data.get("api_key", "").strip()
    if not api_key:
        return jsonify({"error": "api_key is required"}), 400

    user = User.get_by_id(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    # Quick validation — try to hit the Jotform /user endpoint
    try:
        JotformService._api_get("/user", api_key)
    except Exception as e:
        print(f"[Jotform] API key validation failed: {e}")
        return jsonify({"error": "Invalid Jotform API key"}), 400

    user.update_jotform_key(api_key)

    return jsonify({"message": "Jotform account connected", "jotform": True}), 200


@provider_auth_bp.post("/api/auth/jotform/disconnect")
def jotform_disconnect():
    """Remove the user's stored Jotform API key."""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    user = User.get_by_id(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    user.clear_jotform_key()
    return jsonify({"message": "Jotform account disconnected", "jotform": False}), 200


# -----------------------------------------------------------------------
# Microsoft OAuth  – server-side flow (redirect → callback)
# -----------------------------------------------------------------------

@provider_auth_bp.get("/login/microsoft")
def microsoft_login():
    """Initiate Microsoft OAuth flow (returns the redirect URL)."""
    from config import settings as app_settings

    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Must be logged in to connect Microsoft account"}), 401

    if not app_settings.MICROSOFT_CLIENT_ID or not app_settings.MICROSOFT_CLIENT_SECRET:
        return jsonify({
            "error": "Microsoft Forms is not configured yet. "
                     "Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to .env."
        }), 500

    state = secrets.token_urlsafe(32)
    session["ms_oauth_state"] = state

    # Build redirect URI dynamically from the current request so it works
    # in both local dev and production without any hardcoded URLs.
    ms_redirect_uri = request.url_root.rstrip('/') + '/oauth/microsoft/callback'
    session['ms_redirect_uri'] = ms_redirect_uri

    try:
        authorization_url = MicrosoftFormsService.get_authorization_url(state, ms_redirect_uri)
        print(f"[Microsoft] Auth URL: {authorization_url}")
        return jsonify({"authorization_url": authorization_url}), 200
    except Exception as e:
        print(f"[Microsoft] Error generating auth URL: {e}")
        return jsonify({"error": f"Failed to start Microsoft sign-in: {e}"}), 500


@provider_auth_bp.get("/oauth/microsoft/callback")
def microsoft_oauth_callback():
    """Handle Microsoft OAuth callback (browser redirect landing page)."""
    import os

    code = request.args.get("code")
    state = request.args.get("state")
    error = request.args.get("error")
    error_desc = request.args.get("error_description", "")
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")

    if error:
        print(f"[Microsoft] OAuth error: {error} — {error_desc}")
        return (
            f"<html><body><h1>Microsoft Authorization Failed</h1>"
            f"<p>{error_desc or error}</p>"
            f"<a href='{frontend_url}'>Return to app</a></body></html>"
        ), 400

    if not code:
        return "<html><body><h1>No authorization code received</h1></body></html>", 400

    expected_state = session.get("ms_oauth_state")
    if not expected_state or state != expected_state:
        print("[Microsoft] State mismatch — possible CSRF")
        return "<html><body><h1>Invalid state token</h1></body></html>", 400

    user_id = session.get("user_id")
    if not user_id:
        return "<html><body><h1>Session expired, please log in again</h1></body></html>", 401

    # Use the same redirect_uri that was used when starting the flow
    ms_redirect_uri = session.get('ms_redirect_uri',
                                   request.url_root.rstrip('/') + '/oauth/microsoft/callback')

    try:
        tokens = MicrosoftFormsService.exchange_code_for_tokens(code, ms_redirect_uri)
    except Exception as e:
        print(f"[Microsoft] Token exchange failed: {e}")
        return f"<html><body><h1>Token exchange failed</h1><p>{e}</p></body></html>", 500

    user = User.get_by_id(user_id)
    if not user:
        return "<html><body><h1>User not found</h1></body></html>", 404

    user.update_microsoft_tokens(
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"],
        expiry=tokens["token_expiry"],
    )

    return f"""
    <html><body>
        <h1>Successfully connected Microsoft account!</h1>
        <p>You can now close this window and return to the app.</p>
        <script>
            setTimeout(function() {{
                window.close();
                window.location.href = '{frontend_url}';
            }}, 2000);
        </script>
    </body></html>
    """, 200


@provider_auth_bp.post("/api/auth/microsoft/disconnect")
def microsoft_disconnect():
    """Remove the user's stored Microsoft tokens."""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    user = User.get_by_id(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    user.clear_microsoft_tokens()
    return jsonify({"message": "Microsoft account disconnected", "microsoft": False}), 200
