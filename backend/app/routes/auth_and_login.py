from flask import Blueprint, request, jsonify, session
import requests
import os
import traceback
from dotenv import load_dotenv
from config import settings
from models.database import get_db

# Import your models and database tools

from models.user import User
from firebase_admin import auth
from utils.google_forms_service import GoogleFormsService

# Define the Blueprint
auth_bp = Blueprint('auth_and_login', __name__)


# Load the environment variables
load_dotenv()

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

        db = get_db()
        
        # Validate input
        if not username or not email or not password:
            return jsonify({"error": "Username, email, and password are required"}), 400
        
        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400
        
        print(f"Attempting to register user: {username}")

        user_record = auth.create_user(
            email=email,
            password=password,
            display_name=username
        )

        db.collection('users').document(user_record.uid).set({
            "uid": user_record.uid,
            "username": username,
            "email": email,
            "email_custom_message": "" # Default empty message
        })
        
        session['user_id'] = user_record.uid
        
        print(f"User registered and logged in: {user_record.uid}")
        
        return jsonify({
            "success": True,
            "message": "User registered successfully",
            "user": user_record.uid
        }), 201
        
    except Exception as e:
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error during registration: {error_msg}")
        return jsonify({
            "error": "Registration failed",
            "details": error_msg
        }), 500

@auth_bp.post('/api/reset')
def reset():
    """API Route to trigger the password reset email"""
    try:
        data = request.json
        email = data.get('email')

        print(email)

        if not email:
            return jsonify({"error": "Email is required"}), 400

        success, message = trigger_password_reset(email)

        if success:
            return jsonify({
                "success": True, 
                "message": "Password reset email sent!"
            }), 200
        else:
            if message == "EMAIL_NOT_FOUND":
                return jsonify({"error": "No account found with that email address."}), 404
            return jsonify({"error": f"Firebase error: {message}"}), 400

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

def trigger_password_reset(email):
    API_KEY = os.getenv("FIREBASE_WEB_API_KEY") #Where is this set?
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={API_KEY}"
    
    payload = {
        "requestType": "PASSWORD_RESET",
        "email": email
    }
    
    response = requests.post(url, json=payload)
    
    if response.status_code == 200:
        return True, "Success: Reset email sent!"
    else:
        error_data = response.json()
        # Common errors: EMAIL_NOT_FOUND, USER_DISABLED
        return False, error_data.get('error', {}).get('message', 'Unknown Error')

@auth_bp.post("/api/login")
def login():
    """Login an existing user"""
    try:
        data = request.get_json()
        id_token = data.get('idToken')

        if not data:
            return jsonify({"error": "No data provided"}), 400

        decoded_token = auth.verify_id_token(id_token)
        uid = decoded_token['uid']
        userid = User.get_id_by_email(data.get('email')) # Legacy user id

        if uid != userid: # If the old (Firestore) uid isn't the same as the new (Firebase) uid, make them the same
            migrate_user_id(userid, uid)

        db = get_db()
      
        user_doc = db.collection('users').document(uid).get()
        print(uid)
        
        if not user_doc.exists:
            return jsonify({"error": "User profile not found"}), 404

        user_data = user_doc.to_dict()
        
        session['user_id'] = uid
        session['username'] = user_data.get('username')
        
        print(f"User logged in successfully: {uid}")
        
        return jsonify({
            "success": True,
            "message": "Logged in successfully",
            "user": user_data
        }), 200
        
    except Exception as e:
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
            return f"<html><body><h1>Authorization Failed</h1><p>{error}</p><a href='{settings.FRONTEND_URL}'>Return to app</a></body></html>", 400
        
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
            return f"""
            <html>
            <body>
                <h1>Successfully connected Google account!</h1>
                <p>You can now close this window and return to the app.</p>
                <script>
                    setTimeout(function() {{
                        window.close();
                        window.location.href = '{settings.FRONTEND_URL}';
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
    
# Helper function for Firebase/Firestore migration; creates a new firestore document with the userid
def migrate_user_id(old_user_id, firebase_uid):
    db = get_db()
    old_ref = db.collection('users').document(old_user_id)
    old_doc = old_ref.get()

    if old_doc.exists:
        # Create new doc with Firebase UID
        db.collection('users').document(firebase_uid).set(old_doc.to_dict())
        # Delete the old one
        old_ref.delete()
        print(f"✅ Migrated {old_user_id} to {firebase_uid}")
