# Author: Aiden Vangura
# Last edited 11/30/2025
"""This implements singleton for database collection management. It has two types of class variable: Client instances & App instances  """

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import firestore as gcp_firestore
from google.oauth2 import service_account
from typing import Optional
import os
import json, tempfile

# Import settings - use simple import to avoid circular dependency
from config import settings


class FirestoreDB:
    # Firestore database manager
    
    _db: Optional[firestore.Client] = None
    _app: Optional[firebase_admin.App] = None
    
    @classmethod
    def initialize(cls):
        if cls._app is not None and cls._db is not None:
            return cls._db
        
        try:
            cred_path = None

            # --- CLOUD RUN: credentials arrive as a JSON string via Secret Manager ---
            import json, tempfile
            creds_json_str = os.environ.get("FIREBASE_CREDENTIALS_JSON")
            if creds_json_str:
                tmp = tempfile.NamedTemporaryFile(
                    mode='w', suffix='.json', delete=False
                )
                json.dump(json.loads(creds_json_str), tmp)
                tmp.close()
                cred_path = tmp.name  # Set cred_path DIRECTLY, bypass settings lookup
                print(f"Loaded Firebase credentials from FIREBASE_CREDENTIALS_JSON env var")
            
            if not cred_path:
                # 1. Explicit path from settings / env var (FIREBASE_CREDENTIALS_PATH)
                if settings.FIREBASE_CREDENTIALS_PATH and os.path.exists(settings.FIREBASE_CREDENTIALS_PATH):
                    cred_path = settings.FIREBASE_CREDENTIALS_PATH
                else:
                    # 2. Project root (one level above backend/)
                    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
                    root_path = os.path.join(project_root, 'firebase-credentials.json')
                    # 3. backend/ directory
                    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
                    backend_path = os.path.join(backend_dir, 'firebase-credentials.json')
                    # 4. backend/app/ directory
                    app_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
                    app_path = os.path.join(app_dir, 'firebase-credentials.json')

                    for candidate in (root_path, backend_path, app_path):
                        if os.path.exists(candidate):
                            cred_path = candidate
                            break
            
            if cred_path and os.path.exists(cred_path):
                print(f"Using credentials from: {cred_path}")
                cred = credentials.Certificate(cred_path)
                
                # Check if Firebase app already exists before initializing
                try:
                    cls._app = firebase_admin.get_app()
                    print("Using existing Firebase app")
                except ValueError:
                    # App doesn't exist, initialize it
                    cls._app = firebase_admin.initialize_app(cred)
                    print("Initialized new Firebase app")
                
                # Load credentials for GCP Firestore client
                gcp_creds = service_account.Credentials.from_service_account_file(cred_path)
                
                # Use Google Cloud Firestore client directly to specify non-default database
                cls._db = gcp_firestore.Client(
                    project=settings.FIREBASE_PROJECT_ID,
                    credentials=gcp_creds,
                    database='formreminder'
                )
            else:
                print("Warning: No credentials file found, using default credentials")
                # Use default credentials (for development or Google Cloud environment)
                cls._app = firebase_admin.initialize_app()
                cls._db = firestore.client()
            
            print("Firebase Firestore initialized successfully")
            return cls._db
            
        except Exception as e:
            import traceback
            print(f"Error initializing Firebase: {e}")
            traceback.print_exc()
            raise

    # Used to return the correct database client
    # Initializes the connection if it doesn't exist
    @classmethod
    def get_db(cls):
        # Get client
        if cls._db is None:
            try:
                cls.initialize()
            except Exception as e:
                import traceback
                print(f"CRITICAL: Failed to initialize database: {e}")
                traceback.print_exc()
                # Re-raise to make the error visible
                raise RuntimeError(f"Database initialization failed: {e}") from e
        
        if cls._db is None:
            raise RuntimeError("Database client is None after initialization. Check credentials and configuration.")
        
        return cls._db

    # Closes database connection and cleans up
    @classmethod
    def close(cls):

        if cls._app is not None:
            firebase_admin.delete_app(cls._app)
            cls._app = None
            cls._db = None


# Collection names constants
# Defines constants and for all the firestore collection names
# Is a reference for collection names
class Collections:
    # COLLECTION NAMES IN FIRESTORE
    USERS = "users"
    ORGANIZATIONS = "organizations"
    TEAMS = "teams"
    GROUPS = "groups"
    FORMS = "forms"
    FORM_REQUESTS = "form_requests"
    RESPONSES = "responses"
    REMINDERS = "reminders"
    ANALYTICS = "analytics"
    NOTIFICATIONS = "notifications"
    SETTINGS = "settings"
    AUDIT_LOGS = "audit_logs"
    EMAIL_LOGS = "email_logs"
    # Org-level recipient membership / opt-out records (owner_id + recipient_email)
    ORG_MEMBERSHIPS = "org_memberships"
    # Opt-out / group-leave / resubscribe analytics events
    OPT_OUT_EVENTS = "opt_out_events"
    # Emailit webhook delivery tracking events
    EMAIL_EVENTS = "email_events"
    # Bounced email addresses (skip future sends)
    BOUNCED_EMAILS = "bounced_emails"
    # Sub-user memberships within an owner's organization
    ORG_MEMBERS = "org_members"
    # Tracking-pixel open events recorded when a recipient loads a reminder email
    EMAIL_OPEN_EVENTS = "email_open_events"

# Helper function
def get_db():
    # Gets Firestore database instance
    return FirestoreDB.get_db()

