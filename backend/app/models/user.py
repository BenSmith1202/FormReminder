# User model for authentication
# Handles user creation, password hashing, and database operations

from datetime import datetime
from typing import Optional
from werkzeug.security import generate_password_hash, check_password_hash
from google.cloud.firestore_v1.base_query import FieldFilter
from models.database import get_db, Collections


class User:
    """User model for authentication and profile management"""
    
    def __init__(self, user_id: str, username: str, email: str, 
                 password_hash: str = None, 
                 google_access_token: str = None,
                 google_refresh_token: str = None,
                 token_expiry: str = None,
                 created_at: str = None,
                 email_custom_message: str = None):
        self.id = user_id
        self.username = username
        self.email = email
        self.password_hash = password_hash
        self.google_access_token = google_access_token
        self.google_refresh_token = google_refresh_token
        self.token_expiry = token_expiry
        self.created_at = created_at or datetime.utcnow().isoformat() + 'Z'
        self.email_custom_message = email_custom_message  # Custom message for reminder emails (max 200 chars)
    
    def to_dict(self):
        """Convert user to dictionary for storage"""
        return {
            'username': self.username,
            'email': self.email,
            'password_hash': self.password_hash,
            'google_access_token': self.google_access_token,
            'google_refresh_token': self.google_refresh_token,
            'token_expiry': self.token_expiry,
            'created_at': self.created_at,
            'email_custom_message': self.email_custom_message
        }
    
    def to_safe_dict(self):
        """Convert user to dictionary without sensitive data"""
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'has_google_auth': bool(self.google_access_token),
            'created_at': self.created_at,
            'email_custom_message': self.email_custom_message
        }
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password for storage"""
        return generate_password_hash(password)
    
    @staticmethod
    def verify_password(password_hash: str, password: str) -> bool:
        """Verify a password against a hash"""
        return check_password_hash(password_hash, password)
    
    @staticmethod
    def create_user(username: str, email: str, password: str) -> Optional['User']:
        """Create a new user in the database"""
        try:
            db = get_db()
            
            # Check if username already exists
            users_ref = db.collection(Collections.USERS)
            existing_username = users_ref.where(filter=FieldFilter('username', '==', username)).limit(1).stream()
            if len(list(existing_username)) > 0:
                print(f"Username {username} already exists")
                return None
            
            # Check if email already exists
            existing_email = users_ref.where(filter=FieldFilter('email', '==', email)).limit(1).stream()
            if len(list(existing_email)) > 0:
                print(f"Email {email} already exists")
                return None
            
            # Create user document
            password_hash = User.hash_password(password)
            user_data = {
                'username': username,
                'email': email,
                'password_hash': password_hash,
                'google_access_token': None,
                'google_refresh_token': None,
                'token_expiry': None,
                'created_at': datetime.utcnow().isoformat() + 'Z'
            }
            
            # Add to database
            doc_ref = users_ref.document()
            doc_ref.set(user_data)
            
            print(f"User created successfully: {doc_ref.id}")
            return User(
                user_id=doc_ref.id,
                username=username,
                email=email,
                password_hash=password_hash
            )
            
        except Exception as e:
            print(f"Error creating user: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    @staticmethod
    def edit_username(user_id: str, newUsername: str) -> Optional['User']:
        """Edit a given user's username"""
        try:
            db = get_db()
            user_ref = db.collection(Collections.USERS).document(user_id)

            # Update database entry
            user_ref.update({"username" : newUsername})

            print(f"username reset successfully. New username: {newUsername}")

            return User.get_by_username(newUsername)
        except Exception as e:
            print(f"Error editing username: {e}")
            import traceback
            traceback.print_exc()
            return None

    @staticmethod
    def reset_password(username: str, password: str) -> Optional['User']:
        """Reset a given user's password"""
        try:
            db = get_db()
            users_ref = db.collection(Collections.USERS)
            thisUser = User.get_by_username(username)
            
            # Check if user exists before proceeding
            if not thisUser:
                print(f"User not found: {username}")
                return None
                
            thisUserDoc = users_ref.document(thisUser.id)
            

            newPwdHash = User.hash_password(password)

            # Update database entry
            thisUserDoc.update({"password_hash" : newPwdHash})
            
            
            print(f"Password reset successfully: {thisUser.id}")
            return User(
                user_id=thisUser.id,
                username=username,
                email = thisUser.email,
                password_hash=newPwdHash
            )


        except Exception as e:
            print(f"Error reseting password: {e}")
            import traceback
            traceback.print_exc()
            return None
    

    @staticmethod
    def get_by_username(username: str) -> Optional['User']:
        """Find a user by username"""
        try:
            db = get_db()
            users_ref = db.collection(Collections.USERS)
            query = users_ref.where(filter=FieldFilter('username', '==', username)).limit(1).stream()
            
            for doc in query:
                user_data = doc.to_dict()
                return User(
                    user_id=doc.id,
                    username=user_data['username'],
                    email=user_data['email'],
                    password_hash=user_data.get('password_hash'),
                    google_access_token=user_data.get('google_access_token'),
                    google_refresh_token=user_data.get('google_refresh_token'),
                    token_expiry=user_data.get('token_expiry'),
                    created_at=user_data.get('created_at'),
                    email_custom_message=user_data.get('email_custom_message')
                )
            
            return None
            
        except Exception as e:
            print(f"Error getting user by username: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    @staticmethod
    def get_by_id(user_id: str) -> Optional['User']:
        """Find a user by ID"""
        try:
            db = get_db()
            doc_ref = db.collection(Collections.USERS).document(user_id)
            doc = doc_ref.get()
            
            if not doc.exists:
                return None
            
            user_data = doc.to_dict()
            return User(
                user_id=doc.id,
                username=user_data['username'],
                email=user_data['email'],
                password_hash=user_data.get('password_hash'),
                google_access_token=user_data.get('google_access_token'),
                google_refresh_token=user_data.get('google_refresh_token'),
                token_expiry=user_data.get('token_expiry'),
                created_at=user_data.get('created_at'),
                email_custom_message=user_data.get('email_custom_message')
            )
            
        except Exception as e:
            print(f"Error getting user by ID: {e}")
            import traceback
            traceback.print_exc()
            return None

    @staticmethod
    def update_custom_message(user_id: str, message: str) -> bool:
        """Update user's custom email message (max 200 characters)"""
        try:
            # Enforce 200 character limit
            if message and len(message) > 200:
                message = message[:200]
            
            db = get_db()
            user_ref = db.collection(Collections.USERS).document(user_id)
            user_ref.update({'email_custom_message': message})
            print(f"Custom message updated for user {user_id}")
            return True
        except Exception as e:
            print(f"Error updating custom message: {e}")
            return False
    
    @staticmethod
    def delete_user(user_id: str, provided_password: str):
        """
        Verifies the password and deletes the user document.
        Returns: (bool, message)
        """
        try:
            db = get_db()
            user_ref = db.collection(Collections.USERS).document(user_id)
            user_doc = user_ref.get()

            if not user_doc.exists:
                return False, "User not found"

            user_data = user_doc.to_dict()
            hashed_password = user_data.get('password_hash')

            # 1. Verify the password
            if not hashed_password or not User.verify_password(hashed_password, provided_password):
                print(f"⚠️ Failed deletion attempt for user {user_id}: Incorrect password")
                return False, "Incorrect password"

            # 2. Delete the user
            user_ref.delete()
            print(f"✅ User associated with id {user_id} deleted")
            return True, "Success"
            
        except Exception as e:
            print(f"❌ Error during deletion: {e}")
            import traceback
            traceback.print_exc()
            return False, str(e)


    
    def update_google_tokens(self, access_token: str, refresh_token: str, expiry: str):
        """Update user's Google OAuth tokens"""
        try:
            db = get_db()
            user_ref = db.collection(Collections.USERS).document(self.id)
            user_ref.update({
                'google_access_token': access_token,
                'google_refresh_token': refresh_token,
                'token_expiry': expiry
            })
            
            self.google_access_token = access_token
            self.google_refresh_token = refresh_token
            self.token_expiry = expiry
            
            print(f"Updated Google tokens for user {self.username}")
            return True
            
        except Exception as e:
            print(f"Error updating Google tokens: {e}")
            import traceback
            traceback.print_exc()
            return False
