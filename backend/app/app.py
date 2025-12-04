import os
from flask import Flask, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore

# 1. Initialize Flask
app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing

# 2. Initialize Firebase (Uses local gcloud login or service account)
# Only initialize if not already initialized to avoid errors during reloads
if not firebase_admin._apps:
    firebase_admin.initialize_app()

db = firestore.client()

# 3. Define Routes
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "database": "connected"})

# 4. Run the Server
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=True, host='0.0.0.0', port=port)