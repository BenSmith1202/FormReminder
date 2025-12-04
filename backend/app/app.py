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
    """Root endpoint"""
    return {
        "message": f"Welcome to FR API",
        "status": "running",
        "version": "1.0.0"
    }


@app.get("/health")
def health_check():
    """Health check endpoint"""
    try:
        if not firebase_admin._apps:
            firebase_admin.initialize_app()

        db = firestore.client()
        return {
            "status": "healthy",
            "database": "connected" if db else "disconnected"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }
    
# 4. Run the Server
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=True, host='0.0.0.0', port=port)