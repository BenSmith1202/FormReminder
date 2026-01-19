# Author: Aiden Vangura
# Last edited 11/30/2025
"""This implements singleton for database collection management. It has two types of class variable: Client instances & App instances  """

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import firestore as gcp_firestore
from google.oauth2 import service_account
from typing import Optional
import os

# Import settings - use simple import to avoid circular dependency
from config import settings


class FirestoreDB:
    # Firestore database manager
    
    _db: Optional[firestore.Client] = None
    _app: Optional[firebase_admin.App] = None
    
    @classmethod
    def initialize(cls):
        # Initialize Firebase Admin SDK
        # Initialize Firestore client
        if cls._app is not None:
            return cls._db
        
        try:
            # Resolve credentials path - check multiple possible locations
            cred_path = None
            if settings.FIREBASE_CREDENTIALS_PATH:
                # Try the path as-is first
                if os.path.exists(settings.FIREBASE_CREDENTIALS_PATH):
                    cred_path = settings.FIREBASE_CREDENTIALS_PATH
                else:
                    # Try relative to project root (two levels up from backend/app)
                    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
                    alt_path = os.path.join(project_root, settings.FIREBASE_CREDENTIALS_PATH)
                    if os.path.exists(alt_path):
                        cred_path = alt_path
                    else:
                        # Try just the filename in project root
                        alt_path2 = os.path.join(project_root, os.path.basename(settings.FIREBASE_CREDENTIALS_PATH))
                        if os.path.exists(alt_path2):
                            cred_path = alt_path2
            
            # If no configured path, try default locations
            if not cred_path:
                # Try backend/firebase-credentials.json (one level up from app/models)
                backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
                default_path = os.path.join(backend_dir, 'firebase-credentials.json')
                if os.path.exists(default_path):
                    cred_path = default_path
                else:
                    # Try backend/app/firebase-credentials.json
                    app_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
                    default_path2 = os.path.join(app_dir, 'firebase-credentials.json')
                    if os.path.exists(default_path2):
                        cred_path = default_path2
            
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
            cls.initialize()
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

# Helper function
def get_db():
    # Gets Firestore database instance
    return FirestoreDB.get_db()

