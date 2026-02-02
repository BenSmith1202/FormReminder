import os
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
import sys
from flask import Flask, request, session
from flask_cors import CORS

# Add the parent directory to the path so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models.database import FirestoreDB
from config import settings

# --- IMPORT BLUEPRINTS ---
from routes.auth_and_login import auth_bp
from routes.groups import groups_bp
from routes.form_requests import form_requests_bp
from routes.utilities import utilities_bp
from routes.email import email_bp
from routes.organizations import orgs_bp
# -------------------------

# 1. Initialize Flask
app = Flask(__name__)
app.secret_key = settings.SECRET_KEY  # Required for sessions

# disable strict slashes globally
app.url_map.strict_slashes = False

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


# 3. Middleware (Optional Debugging)
@app.before_request
def log_session():
    if 'user_id' in session:
        # Reduced noise: only log if user is logged in
        print(f"REQ: {request.method} {request.path} | User: {session['user_id']}")
        pass

# 4. Register Blueprints
app.register_blueprint(auth_bp) # Auth handles its own /api prefixes
app.register_blueprint(groups_bp, url_prefix='/api/groups')
app.register_blueprint(form_requests_bp, url_prefix='/api/form-requests')
app.register_blueprint(utilities_bp) # Utils handles its own prefixes (/time, /api/health)
app.register_blueprint(email_bp)
app.register_blueprint(orgs_bp)


@app.get("/")
def root():
    """Root endpoint - This is what you see at localhost:5000"""
    return {
        "message": "Welcome to FR API. Visit localhost:5173 to see the App.",
        "status": "running",
    }

#reminder_scheduler = init_scheduler(app)

# 4. Run the Server
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=True, host='0.0.0.0', port=port)
    