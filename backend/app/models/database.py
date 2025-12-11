# Author: Aiden Vangura
# Last edited 11/30/2025
"""This implements singleton for database collection management. It has two types of class variable: Client instances & App instances  """

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import firestore as gcp_firestore
from google.oauth2 import service_account
from typing import Optional
import os
from app.config import settings


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
            # Check if credentials file exists
            if settings.FIREBASE_CREDENTIALS_PATH and os.path.exists(settings.FIREBASE_CREDENTIALS_PATH):
                cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
                cls._app = firebase_admin.initialize_app(cred)
                
                # Load credentials for GCP Firestore client
                gcp_creds = service_account.Credentials.from_service_account_file(
                    settings.FIREBASE_CREDENTIALS_PATH
                )
                
                # Use Google Cloud Firestore client directly to specify non-default database
                cls._db = gcp_firestore.Client(
                    project=settings.FIREBASE_PROJECT_ID,
                    credentials=gcp_creds,
                    database='formreminder'
                )
            else:
                # Use default credentials (for development or Google Cloud environment)
                cls._app = firebase_admin.initialize_app()
                cls._db = firestore.client()
            
            print("Firebase Firestore initialized successfully")
            return cls._db
            
        except Exception as e:
            print(f"Error initializing Firebase: {e}")
            raise

    # Used to return the correct database client
    # Initializes the connection if it doesn't exist
    @classmethod
    def get_db(cls) -> firestore.Client:
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

# Helper function
def get_db() -> firestore.Client:
    # Gets Firestore database instance
    return FirestoreDB.get_db()

