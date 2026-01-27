import os
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
import sys
from flask import Flask, jsonify, request, session
from flask_cors import CORS

# Add the parent directory to the path so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models.database import get_db, FirestoreDB
from models.user import User
from models.group import Group
from config import settings
from utils.google_forms_service import GoogleFormsService
from utils.email_service import EmailService

# 1. Initialize Flask
app = Flask(__name__)
app.secret_key = settings.SECRET_KEY  # Required for sessions

CORS(app, 
     origins=["http://localhost:5173"],  # Frontend URL
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
    """Retrieve all form requests from the database"""
    from models.database import Collections
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        db = get_db()
        
        form_requests = db.collection(Collections.FORM_REQUESTS)\
            .where('owner_id', '==', user_id)\
            .stream()
        
        requests_list = []
        for req in form_requests:
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
                .where('request_id', '==', req.id)\
                .stream()
            response_count = sum(1 for _ in responses_query)
            
            # Calculate warnings dynamically
            warnings = []
            form_settings = form_data.get('form_settings', {})
            email_collection_enabled = form_settings.get('email_collection_enabled', True)
            api_access_available = form_data.get('api_access_available', True)
            
            if not email_collection_enabled:
                warnings.append("Email collection may not be enabled on this form. Make sure your Google Form has email collection enabled in settings.")
            
            if not api_access_available:
                warnings.append('API access not available. Grant edit access to your Google Form, then use "Refresh Responses" to fetch data.')
            
            # Merge form data into request_data
            merged_data = {
                **request_data,
                **form_data,  # Merge form data (form_url, title, description, last_synced_at, etc.)
                "response_count": response_count,  # Include dynamically calculated response_count
                "total_recipients": total_recipients,  # Always include fresh count
                "warnings": warnings  # Include dynamically calculated warnings
            }
            
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
    """Get all responses for a form request"""
    from models.database import Collections
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        db = get_db()
        
        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()
        
        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404
        
        request_data = request_doc.to_dict()
        
        # Verify ownership
        if request_data.get('owner_id') != user_id:
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
            .where('request_id', '==', request_id)\
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
        
        # Calculate warnings dynamically
        warnings = []
        form_settings = form_data.get('form_settings', {})
        email_collection_enabled = form_settings.get('email_collection_enabled', True)
        api_access_available = form_data.get('api_access_available', True)
        
        if not email_collection_enabled:
            warnings.append("Email collection may not be enabled on this form. Make sure your Google Form has email collection enabled in settings.")
        
        if not api_access_available:
            warnings.append('API access not available. Grant edit access to your Google Form, then use "Refresh Responses" to fetch data.')
        
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


# Refresh responses from Google Forms
@app.post("/api/form-requests/<request_id>/refresh")
def refresh_form_responses(request_id: str):
    """Manually refresh responses from Google Forms"""
    from datetime import datetime
    from models.database import Collections
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        user = User.get_by_id(user_id)
        if not user or not user.google_access_token:
            return jsonify({"error": "Google account not connected"}), 403
        
        db = get_db()
        
        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()
        
        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404
        
        request_data = request_doc.to_dict()
        
        # Verify ownership
        if request_data.get('owner_id') != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        form_id = request_data.get('google_form_id')
        if not form_id:
            return jsonify({"error": "No Google Form ID found"}), 400
        
        print(f"Refreshing responses for form {form_id}")
        
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
        
        # Fetch latest responses from Google
        print(f"Fetching responses from Google Forms API for form {form_id}...")
        responses = GoogleFormsService.get_form_responses(credentials, form_id)
        
        print(f"Found {len(responses)} total responses from Google")
        if responses:
            # Log sample response emails for debugging
            sample_emails = [r.get('respondent_email', 'no email') for r in responses[:3]]
            print(f"   Sample respondent emails: {sample_emails}")
        
        # Get existing responses to check for duplicates by response_id
        existing_responses = {}
        old_responses = db.collection(Collections.RESPONSES)\
            .where('request_id', '==', request_id)\
            .stream()
        
        for old_response in old_responses:
            old_data = old_response.to_dict()
            response_id = old_data.get('response_id')
            if response_id:
                existing_responses[response_id] = old_response.reference
        
        print(f"Found {len(existing_responses)} existing responses in database")
        
        # Store new/updated responses with full answer data
        stored_count = 0
        updated_count = 0
        new_count = 0
        
        for response in responses:
            response_id = response.get('response_id', '')
            response_data = {
                'request_id': request_id,
                'form_id': form_id,
                'respondent_email': response.get('respondent_email', ''),
                'response_id': response_id,
                'submitted_at': response.get('submitted_at', ''),
                'last_submitted_at': response.get('last_submitted_at', ''),
                'total_score': response.get('total_score'),
                'answers': response.get('answers', {}),  # Full answer data
                'answer_count': response.get('answer_count', 0),
                'created_at': datetime.utcnow().isoformat() + 'Z'
            }
            
            # Update existing response or create new one
            if response_id and response_id in existing_responses:
                # Update existing response
                existing_responses[response_id].set(response_data)
                updated_count += 1
                # Remove from dict so we know which ones to delete
                del existing_responses[response_id]
            else:
                # Create new response
                db.collection(Collections.RESPONSES).add(response_data)
                new_count += 1
            
            stored_count += 1
        
        # Delete responses that no longer exist in Google Forms
        deleted_count = 0
        for response_id, response_ref in existing_responses.items():
            response_ref.delete()
            deleted_count += 1
        
        print(f"Sync complete: {new_count} new, {updated_count} updated, {deleted_count} deleted")
        
        # Update form document in forms collection with sync time
        form_doc_id = request_data.get('form_id')
        if not form_doc_id:
            # Fallback: try using google_form_id for older form requests
            form_doc_id = request_data.get('google_form_id')
        
        if form_doc_id:
            form_ref = db.collection(Collections.FORMS).document(form_doc_id)
            form_doc = form_ref.get()
            sync_time = datetime.utcnow().isoformat() + 'Z'
            if form_doc.exists:
                form_ref.update({
                    'last_synced_at': sync_time,
                    'api_access_available': True,
                    'updated_at': sync_time
                })
                print(f"Updated form document {form_doc_id} with sync time")
            else:
                # Create form document if it doesn't exist (for older form requests)
                form_ref.set({
                    'google_form_id': form_doc_id,
                    'form_url': request_data.get('form_url', ''),
                    'title': request_data.get('title', ''),
                    'description': request_data.get('description', ''),
                    'owner_id': request_data.get('owner_id'),
                    'created_at': request_data.get('created_at', sync_time),
                    'updated_at': sync_time,
                    'is_active': True,
                    'api_access_available': True,
                    'last_synced_at': sync_time,
                    'form_settings': request_data.get('form_settings', {})
                })
                print(f"Created form document {form_doc_id} with sync time")
        
        print(f"Refreshed {stored_count} responses for request {request_id}")
        
        return jsonify({
            "success": True,
            "message": "Responses refreshed successfully",
            "response_count": stored_count,
            "synced_at": datetime.utcnow().isoformat() + 'Z'
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error refreshing responses: {error_msg}")
        return jsonify({
            "error": "Failed to refresh responses",
            "details": error_msg
        }), 500

# Create a new form request
@app.post("/api/form-requests")
def create_form_request():
    """Create a new form request from a Google Form URL"""
    from datetime import datetime
    from models.database import Collections
    
    try:
        # Check if user is authenticated
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        user = User.get_by_id(user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        # Check if user has connected Google account
        if not user.google_access_token or not user.google_refresh_token:
            return jsonify({
                "error": "Google account not connected",
                "message": "Please connect your Google account first"
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
        
        # Verify group exists and user owns it
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        if group.owner_id != user_id:
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
        email_collection_enabled = False
        
        try:
            metadata = GoogleFormsService.get_form_metadata(credentials, form_id)
            api_access_available = True
            
            # Check email collection (optional for now, just warn)
            print("Checking email collection...")
            try:
                email_collection_enabled = GoogleFormsService.check_email_collection(credentials, form_id)
            except Exception as email_check_error:
                print(f"Warning: Could not check email collection: {email_check_error}")
                email_collection_enabled = False
        except Exception as metadata_error:
            print(f"Warning: Could not fetch form metadata: {metadata_error}")
            print("This usually means you don't have edit access to the form.")
            print("The form request will be created, but you'll need to grant edit access to sync responses.")
            api_access_available = False
            # Use default metadata
            metadata = {
                'title': data.get('title', f"Form {form_id[:8]}"),
                'description': '',
                'email_collection_enabled': False,
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
            'owner_id': user_id,
            'created_at': now,
            'updated_at': now,
            'is_active': True,
            'api_access_available': api_access_available,  # Set based on whether we could fetch metadata
            # Don't set last_synced_at on creation - it will be set when first synced
            'form_settings': {
                'email_collection_enabled': email_collection_enabled,
                'email_collection_type': metadata.get('email_collection_type', 'UNKNOWN')
            }
        }
        
        form_ref = db.collection(Collections.FORMS).document(form_doc_id)
        form_doc = form_ref.get()
        if form_doc.exists:
            # Update existing form document (don't update last_synced_at unless syncing)
            form_ref.update({
                'form_url': form_url,
                'title': data.get('title') or metadata.get('title', f"Form {form_id[:8]}"),
                'description': metadata.get('description', ''),
                'updated_at': now,
                'api_access_available': api_access_available,
                'form_settings': form_data['form_settings']
            })
        else:
            # Create new form document (without last_synced_at - will be set on first sync)
            form_ref.set(form_data)
        
        # Create form request document with enhanced metadata
        form_request_data = {
            'form_id': form_doc_id,  # Reference to forms collection
            'google_form_id': form_id,
            'owner_id': user_id,
            'group_id': group_id,
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
    """Delete a form request and all its responses"""
    from models.database import Collections
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        db = get_db()
        
        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()
        
        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404
        
        request_data = request_doc.to_dict()
        
        # Verify ownership
        if request_data.get('owner_id') != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Delete all responses for this request
        responses = db.collection(Collections.RESPONSES)\
            .where('request_id', '==', request_id)\
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
    """Create a new group"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({"error": "Group name is required"}), 400
        
        name = data['name'].strip()
        description = data.get('description', '').strip()
        
        if not name:
            return jsonify({"error": "Group name cannot be empty"}), 400
        
        print(f"Creating group: {name} for user {user_id}")
        
        group = Group.create_group(
            name=name,
            description=description,
            owner_id=user_id
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
    """Get all groups owned by the current user"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        print(f"Fetching groups for user: {user_id}")
        
        groups = Group.get_user_groups(user_id)
        
        groups_list = [group.to_dict() for group in groups]
        
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
    """Get a specific group with all members"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        group = Group.get_by_id(group_id)
        
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Verify ownership
        if group.owner_id != user_id:
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
    """Add members to a group (bulk email paste)"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        data = request.get_json()
        if not data or 'emails' not in data:
            return jsonify({"error": "Emails are required"}), 400
        
        emails_text = data['emails']
        
        # Get group
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Verify ownership
        if group.owner_id != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Parse emails from text
        emails = Group.parse_emails(emails_text)
        
        if not emails:
            return jsonify({"error": "No valid emails found"}), 400
        
        print(f"Adding {len(emails)} emails to group {group_id}")
        
        # Add members
        added_count = group.add_members(emails)
        
        return jsonify({
            "success": True,
            "message": f"Added {added_count} new members",
            "added_count": added_count,
            "total_members": len(group.members),
            "skipped": len(emails) - added_count  # Duplicates
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
    """Remove a member from a group"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        print(f"Removing member {email} from group {group_id}")
        
        # Get group
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Verify ownership
        if group.owner_id != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Remove member
        success = group.remove_member(email)
        
        if not success:
            return jsonify({"error": "Member not found"}), 404
        
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


# ============= END GROUPS ROUTES =============

# This matches frontend/src/pages/ServerTime.tsx
@app.route('/time', methods=['GET'])
def get_current_time():
    """Endpoint to get the current server time"""
    from datetime import datetime
    now = datetime.now()
    return jsonify({
        "current_time": now.isoformat() + "Z"
    })


# ============= EMAIL REMINDER ROUTES =============

@app.post("/api/form-requests/<request_id>/send-reminder/<email>")
def send_single_reminder(request_id: str, email: str):
    """Send a reminder email to a single recipient"""
    from models.database import Collections
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        db = get_db()
        
        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()
        
        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404
        
        request_data = request_doc.to_dict()
        
        # Verify ownership
        if request_data.get('owner_id') != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Get form info
        form_title = request_data.get('title', 'Untitled Form')
        form_url = request_data.get('form_url')
        
        print(f"Sending reminder to {email} for form: {form_title}")
        
        # Send reminder
        result = EmailService.send_reminder(request_id, form_title, form_url, email)
        
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
    """Send reminders to all non-responders (excluding recently sent)"""
    from models.database import Collections
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        db = get_db()
        
        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()
        
        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404
        
        request_data = request_doc.to_dict()
        
        # Verify ownership
        if request_data.get('owner_id') != user_id:
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
            .where('request_id', '==', request_id)\
            .stream()
        
        responded_emails = set()
        for response in responses:
            response_data = response.to_dict()
            email_lower = response_data.get('respondent_email', '').lower()
            if email_lower:
                responded_emails.add(email_lower)
        
        # Find non-responders
        non_responders = []
        for member in group.members:
            member_email = member['email']
            if member_email.lower() not in responded_emails:
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
        
        # Send reminders (respecting rate limits)
        sent = 0
        skipped = 0
        failed = 0
        
        for recipient_email in non_responders:
            result = EmailService.send_reminder(request_id, form_title, form_url, recipient_email)
            
            if result['success']:
                sent += 1
            elif 'Rate limit' in result.get('error', ''):
                skipped += 1
            else:
                failed += 1
        
        print(f"Bulk reminders complete: {sent} sent, {skipped} skipped (rate limit), {failed} failed")
        
        return jsonify({
            "success": True,
            "message": f"Sent {sent} reminders",
            "sent": sent,
            "skipped": skipped,
            "failed": failed,
            "total_non_responders": len(non_responders)
        }), 200
        
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
    