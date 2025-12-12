import os
import sys
from flask import Flask, jsonify
from flask_cors import CORS

# Add the parent directory to the path so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models.database import get_db

# 1. Initialize Flask
app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing

@app.get("/")
def root():
    """Root endpoint - This is what you see at localhost:5000"""
    return {
        "message": "Welcome to FR API. Visit localhost:5173 to see the App.",
        "status": "running",
    }


# TODO: API request to get form data; called in Dashboard.tsx
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
# Link must be in the pattern https://docs.google.com/forms/d/thisistheid/edit
@app.get("/api/getid")
def getid():
    from flask import request
    formlink = request.args.get('formlink', '')
    
    if not formlink:
        return jsonify({"error": "formlink parameter is required"}), 400
    
    try:
        # Extract form ID from URL
        # Pattern: https://docs.google.com/forms/d/FORM_ID/edit
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

# RENAMED: Changed from /health to /api/health to match frontend/src/pages/Dashboard.tsx
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
        db = get_db()
        form_requests = db.collection(Collections.FORM_REQUESTS).stream()
        requests_list = []
        for request in form_requests:
            request_data = request.to_dict()
            requests_list.append({
                "id": request.id,
                **request_data
            })
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

# Create a new form request
@app.post("/api/form-requests")
def create_form_request():
    """Create a new form request from a Google Form URL"""
    from flask import request
    from datetime import datetime
    from models.database import Collections
    
    try:
        data = request.get_json()
        if not data or 'form_id' not in data or 'form_url' not in data:
            return jsonify({"error": "form_id and form_url are required"}), 400
        
        db = get_db()
        
        # Create form request document
        form_request_data = {
            'form_id': data['form_id'],
            'form_url': data['form_url'],
            'name': data.get('name', f"Form {data['form_id'][:8]}"),  # Default name
            'created_at': datetime.utcnow().isoformat() + 'Z',
            'status': 'Active',
            'responded': 0,
            'recipients': 0,
            'is_active': True
        }
        
        # Add to form_requests collection
        doc_ref = db.collection(Collections.FORM_REQUESTS).document()
        doc_ref.set(form_request_data)
        
        print(f"   Form request saved to database with ID: {doc_ref.id}")
        print(f"   Collection: {Collections.FORM_REQUESTS}")
        print(f"   Data: {form_request_data}")
        
        return jsonify({
            "success": True,
            "id": doc_ref.id,
            "form_request": form_request_data
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

# This matches frontend/src/pages/ServerTime.tsx
@app.route('/time', methods=['GET'])
def get_current_time():
    """Endpoint to get the current server time"""
    from datetime import datetime
    now = datetime.now()
    return jsonify({
        "current_time": now.isoformat() + "Z"
    })



# 4. Run the Server
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=True, host='0.0.0.0', port=port)
    