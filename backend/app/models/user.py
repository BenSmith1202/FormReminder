# User model for authentication
# Handles user creation, password hashing, and database operations

from datetime import datetime
from typing import Optional
from werkzeug.security import generate_password_hash, check_password_hash
from models.database import get_db, Collections


class User:
    """User model for authentication and profile management"""
    
    def __init__(self, user_id: str, username: str, email: str, 
                 password_hash: str = None, 
                 google_access_token: str = None,
                 google_refresh_token: str = None,
                 token_expiry: str = None,
                 created_at: str = None):
        self.id = user_id
        self.username = username
        self.email = email
        self.password_hash = password_hash
        self.google_access_token = google_access_token
        self.google_refresh_token = google_refresh_token
        self.token_expiry = token_expiry
        self.created_at = created_at or datetime.utcnow().isoformat() + 'Z'
    
    def to_dict(self):
        """Convert user to dictionary for storage"""
        return {
            'username': self.username,
            'email': self.email,
            'password_hash': self.password_hash,
            'google_access_token': self.google_access_token,
            'google_refresh_token': self.google_refresh_token,
            'token_expiry': self.token_expiry,
            'created_at': self.created_at
        }
    
    def to_safe_dict(self):
        """Convert user to dictionary without sensitive data"""
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'has_google_auth': bool(self.google_access_token),
            'created_at': self.created_at
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
            existing_username = users_ref.where('username', '==', username).limit(1).stream()
            if len(list(existing_username)) > 0:
                print(f"Username {username} already exists")
                return None
            
            # Check if email already exists
            existing_email = users_ref.where('email', '==', email).limit(1).stream()
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
    def reset_password(username: str, password: str) -> Optional['User']:
        """Reset a given user's password"""
        try:
            db = get_db()
            users_ref = db.collection(Collections.USERS)
            thisUser: Optional[User] = User.get_by_username(username)

            newPwdHash = User.hash_password(password)
            
            user_data = {
                'username': thisUser.username,
                'email': thisUser.email,
                'password_hash': newPwdHash,
                'google_access_token': None,
                'google_refresh_token': None,
                'token_expiry': None,
                'created_at': datetime.utcnow().isoformat() + 'Z'
            }

            # Add to database
            doc_ref = users_ref.document()
            doc_ref.set(user_data)
            
            print(f"Password reset successfully: {doc_ref.id}")
            return User(
                user_id=doc_ref.id,
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
            query = users_ref.where('username', '==', username).limit(1).stream()
            
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
                    created_at=user_data.get('created_at')
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
                created_at=user_data.get('created_at')
            )
            
        except Exception as e:
            print(f"Error getting user by ID: {e}")
            import traceback
            traceback.print_exc()
            return None
    
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
