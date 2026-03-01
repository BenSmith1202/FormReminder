from flask import Blueprint, jsonify
from datetime import datetime
from models.database import get_db

# Define the Blueprint
utilities_bp = Blueprint('utilities', __name__)


# Helper function to create notifications
def create_notification(owner_id: str, notif_type: str, message: str, data=None) -> None:
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


@utilities_bp.get("/api/data")
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
@utilities_bp.get("/api/getid")
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


@utilities_bp.get("/api/health")
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


# This matches frontend/src/pages/ServerTime.tsx
@utilities_bp.route('/time', methods=['GET'])
def get_current_time():
    """Endpoint to get the current server time"""
    from datetime import datetime
    now = datetime.now()
    return jsonify({
        "current_time": now.isoformat() + "Z"
    })
