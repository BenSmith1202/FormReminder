from flask import Blueprint, request, jsonify, session
from datetime import datetime
import traceback

# Import your models and database tools
from models.user import User
from utils.google_forms_service import GoogleFormsService

# Define the Blueprint
auth_bp = Blueprint('auth_and_login', __name__)

# AUTHENTICATION ROUTES

@auth_bp.post("/api/register")
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

@auth_bp.post("/api/reset")
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

@auth_bp.post("/api/login")
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


@auth_bp.post("/api/logout")
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


@auth_bp.get("/api/current-user")
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

@auth_bp.get("/login/google")
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
        
        # Get authorization URL
        authorization_url = GoogleFormsService.get_authorization_url(state)
        
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


@auth_bp.get("/oauth/callback")
def oauth_callback():
    """Handle Google OAuth callback"""
    try:
        # Get the authorization code
        code = request.args.get('code')
        state = request.args.get('state')
        error = request.args.get('error')
        
        if error:
            print(f"OAuth error: {error}")
            return f"<html><body><h1>Authorization Failed</h1><p>{error}</p><a href='http://localhost:5173'>Return to app</a></body></html>", 400
        
        if not code:
            return "<html><body><h1>No authorization code received</h1></body></html>", 400
        
        # Verify state token (CSRF protection)
        expected_state = session.get('oauth_state')
        if not expected_state or state != expected_state:
            print("State mismatch - possible CSRF attack")
            return "<html><body><h1>Invalid state token</h1></body></html>", 400
        
        print(f"Received OAuth callback with code")
        
        # Exchange code for tokens
        tokens = GoogleFormsService.exchange_code_for_tokens(code, state)
        
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
            return """
            <html>
            <body>
                <h1>Successfully connected Google account!</h1>
                <p>You can now close this window and return to the app.</p>
                <script>
                    setTimeout(function() {
                        window.close();
                        window.location.href = 'http://localhost:5173';
                    }, 2000);
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


@auth_bp.get("/api/google-auth-status")
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