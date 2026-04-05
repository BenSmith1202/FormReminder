from flask import Blueprint, request, jsonify, session
from datetime import datetime
import traceback

# Import your models and database tools
from models.user import User
from utils.google_forms_service import GoogleFormsService

from models.database import get_db
from models.form import Form

# Define the Blueprint
settings_bp = Blueprint('settings', __name__)


# ============= SETTINGS ROUTES ===================

# Route to delete the user's account. Also redirects.
@settings_bp.post('/api/delete')
def delete_account():
    """Delete the current user after password verification"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        # Get password from the frontend request
        data = request.json
        provided_password = data.get('password')
        
        if not provided_password:
            return jsonify({"error": "Password is required to delete account"}), 400

        # Attempt deletion with verification
        success, message = User.delete_user(user_id, provided_password)
        
        if not success:
            return jsonify({"error": message}), 401 # Unauthorized
            
        # Clear the session after successful deletion
        session.clear()
        
        return jsonify({
            "success": True,
            "message": "Account deleted successfully"
        }), 200
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            "error": "Failed to delete account",
            "details": str(e)
        }), 500
    
@settings_bp.post('/api/edit_username')
def edit_username():
    """Edit the current user's username"""
    try:
        data = request.get_json()
        user_id = session.get('user_id')
        username = data.get('newUsername')
        print(f"User information: {user_id} {username}")
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        User.edit_username(user_id, username)

        return jsonify({
            "success": True,
            "message": "Username editted successfully"
        }), 200
    
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"❌ Error editing username: {error_msg}")
        return jsonify({
            "error": "Failed to edit username",
            "details": error_msg
        }), 500


@settings_bp.get('/api/user-forms')
def get_user_forms():
    try:
        user_id_query = request.args.get('userId')

        logged_in_id = session.get('user_id')
        if not logged_in_id or logged_in_id != user_id_query:
            return jsonify({"error": "Unauthorized access"}), 403
        
        print(f"Calling get forms by uid...")
        user_forms = Form.get_forms_by_userid(user_id_query)
            
        return jsonify({
            "success": True,
            "forms": user_forms
        }), 200

    except Exception as e:
        print(f"❌ Error fetching forms: {e}")
        return jsonify({"error": "Failed to fetch forms", "details": str(e)}), 500
        

# ============= CUSTOM EMAIL MESSAGE ROUTES ===================

@settings_bp.get('/api/settings/custom-message')
def get_custom_message():
    """Get user's custom email message"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        user = User.get_by_id(user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        return jsonify({
            "success": True,
            "custom_message": user.email_custom_message or ""
        }), 200
        
    except Exception as e:
        print(f"Error getting custom message: {e}")
        return jsonify({"error": "Failed to get custom message"}), 500


@settings_bp.post('/api/settings/custom-message')
def save_custom_message():
    """Save user's custom email message (max 200 characters)"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        data = request.get_json()
        message = data.get('custom_message', '')
        
        # Enforce 200 character limit
        if len(message) > 200:
            return jsonify({"error": "Message must be 200 characters or less"}), 400
        
        success = User.update_custom_message(user_id, message)
        
        if success:
            return jsonify({
                "success": True,
                "message": "Custom message saved successfully"
            }), 200
        else:
            return jsonify({"error": "Failed to save custom message"}), 500
            
    except Exception as e:
        print(f"Error saving custom message: {e}")
        return jsonify({"error": "Failed to save custom message"}), 500
    

@settings_bp.post('/api/settings/profile-photo')
def upload_profile_photo():
    """Save a base64-encoded profile photo for the current user.

    Expects JSON: { "photo": "<data:image/...;base64,...>" }
    Rejects payloads larger than 700 KB (base64 string length) to keep
    Firestore document sizes reasonable.
    """
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        data = request.get_json()
        photo = data.get('photo', '')

        if not photo:
            return jsonify({"error": "No photo provided"}), 400

        if not photo.startswith('data:image/'):
            return jsonify({"error": "Invalid image format"}), 400

        # ~700 KB base64 string ≈ ~525 KB decoded — safe for Firestore's 1 MB doc limit
        if len(photo) > 700_000:
            return jsonify({"error": "Image is too large. Please upload an image under 500 KB."}), 400

        db = get_db()
        db.collection('users').document(user_id).update({'profile_photo_url': photo})

        print(f"Profile photo updated for user {user_id}")
        return jsonify({"success": True, "profile_photo_url": photo}), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "Failed to save profile photo", "details": str(e)}), 500


@settings_bp.delete('/api/settings/profile-photo')
def delete_profile_photo():
    """Remove the current user's profile photo."""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401

        db = get_db()
        db.collection('users').document(user_id).update({'profile_photo_url': None})

        return jsonify({"success": True}), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "Failed to remove profile photo", "details": str(e)}), 500


@settings_bp.post('/api/settings/toggle-notification')
def toggle_notification():
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401

        data = request.json
        # Here, target_form_id will be the Firestore DOCUMENT ID
        target_doc_id = data.get('form_id') 
        new_status = data.get('enabled')

        db = get_db()
        
        # Access the document directly by its ID
        doc_ref = db.collection('form_requests').document(target_doc_id)
        doc = doc_ref.get()

        if not doc.exists:
            return jsonify({"error": "Document not found"}), 404

        # Security check: Ensure the owner matches
        if doc.to_dict().get('owner_id') != user_id:
            return jsonify({"error": "Unauthorized access to this document"}), 403

        doc_ref.update({
            "notifications_enabled": bool(new_status)
        })

        return jsonify({"success": True, "new_status": new_status}), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500