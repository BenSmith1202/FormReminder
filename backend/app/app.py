import os
from flask import Flask, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore

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
        # Initialize Firebase only if not already active
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        db = firestore.client()
        forms = db.collection('forms').stream()
        for form in forms:
            print(f"{form.id} => {form.to_dict()}")
        return f"{form.id} => {form.to_dict()}"
    except Exception as e:
        print(f"There was an error: {e}")
        return "Something bad happen"

# API request to get a form's id. Requires the link to the form be submitted as an argument.
# Link must be in the pattern https://docs.google.com/forms/d/thisistheid/edit
@app.get("/api/getid")
def getid(formlink: str) -> str:
    return formlink.split("/")[5]

# RENAMED: Changed from /health to /api/health to match frontend/src/pages/Dashboard.tsx
@app.get("/api/health")
def health_check():
    """Health check endpoint"""
    try:
        # Initialize Firebase only if not already active
        if not firebase_admin._apps:
            firebase_admin.initialize_app()

        db = firestore.client()
        return {
            "status": "healthy",
            "database": "connected"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }

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
    