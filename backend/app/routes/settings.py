from flask import Blueprint, request, jsonify, session
from datetime import datetime
import traceback

# Import your models and database tools
from models.user import User
from utils.google_forms_service import GoogleFormsService

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
        

