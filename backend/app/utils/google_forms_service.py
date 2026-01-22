# Google Forms API Service
# Handles OAuth flow, token management, and Google Forms API interactions

import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from config import settings

# Allow HTTP for localhost development (OAuth normally requires HTTPS)
# This is safe for localhost only - DO NOT use in production
if settings.DEBUG or (hasattr(settings, 'GOOGLE_REDIRECT_URI') and 'localhost' in settings.GOOGLE_REDIRECT_URI):
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'


class GoogleFormsService:
    """Service for interacting with Google Forms API"""
    
    # OAuth scopes needed
    SCOPES = [
        'openid',  # Google automatically adds this, so we include it to avoid scope mismatch
        'https://www.googleapis.com/auth/forms.body.readonly',
        'https://www.googleapis.com/auth/forms.responses.readonly'
    ]
    
    @staticmethod
    def create_oauth_flow():
        """Create OAuth flow for Google authentication"""
        try:
            # Try multiple locations for client_secret.json (similar to firebase-credentials.json)
            client_secret_path = None
            
            # 1. Try project root (three levels up from app/utils)
            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
            default_path = os.path.join(project_root, 'client_secret.json')
            if os.path.exists(default_path):
                client_secret_path = default_path
                print(f"Found client_secret.json at project root: {client_secret_path}")
            else:
                # 2. Try backend directory (two levels up from app/utils)
                backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
                default_path2 = os.path.join(backend_dir, 'client_secret.json')
                if os.path.exists(default_path2):
                    client_secret_path = default_path2
                    print(f"Found client_secret.json in backend dir: {client_secret_path}")
                else:
                    # 3. Try backend/app directory (one level up from app/utils)
                    app_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
                    default_path3 = os.path.join(app_dir, 'client_secret.json')
                    if os.path.exists(default_path3):
                        client_secret_path = default_path3
                        print(f"Found client_secret.json in app dir: {client_secret_path}")
            
            if not client_secret_path:
                print("Error: client_secret.json not found at expected locations")
                print(f"Checked locations:")
                print(f"  - {default_path}")
                print(f"  - {default_path2}")
                print(f"  - {default_path3}")
                raise FileNotFoundError(
                    f"client_secret.json not found. Please download it from Google Cloud Console "
                    f"and place it in one of these locations:\n"
                    f"  - {default_path}\n"
                    f"  - {default_path2}\n"
                    f"  - {default_path3}"
                )
            
            # Validate redirect URI is set
            if not settings.GOOGLE_REDIRECT_URI:
                raise ValueError("GOOGLE_REDIRECT_URI not configured in settings")
            
            print(f"Using client_secret.json from: {client_secret_path}")
            print(f"Redirect URI: {settings.GOOGLE_REDIRECT_URI}")
            
            flow = Flow.from_client_secrets_file(
                client_secret_path,
                scopes=GoogleFormsService.SCOPES,
                redirect_uri=settings.GOOGLE_REDIRECT_URI
            )
            
            return flow
            
        except FileNotFoundError as e:
            print(f"FileNotFoundError creating OAuth flow: {e}")
            raise
        except Exception as e:
            print(f"Error creating OAuth flow: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    @staticmethod
    def get_authorization_url(state: str) -> str:
        """Generate the Google OAuth authorization URL"""
        try:
            flow = GoogleFormsService.create_oauth_flow()
            authorization_url, _ = flow.authorization_url(
                access_type='offline',
                include_granted_scopes='true',
                state=state,
                prompt='consent'  # Force consent screen to get refresh token
            )
            
            # Ensure we return a clean string URL (no markdown formatting)
            if isinstance(authorization_url, str):
                # Remove any potential markdown formatting (e.g., [url](url) -> url)
                clean_url = authorization_url.strip()
                # Remove markdown link syntax if present: [text](url) -> url
                import re
                markdown_link_pattern = r'\[([^\]]+)\]\(([^)]+)\)'
                if re.search(markdown_link_pattern, clean_url):
                    # Extract the URL from markdown link format
                    match = re.search(markdown_link_pattern, clean_url)
                    if match:
                        clean_url = match.group(2)  # Get the URL part
                    else:
                        # Fallback: try to extract URL from parentheses
                        url_match = re.search(r'\(([^)]+)\)', clean_url)
                        if url_match:
                            clean_url = url_match.group(1)
                
                # Validate it's a proper URL
                if not clean_url.startswith('http://') and not clean_url.startswith('https://'):
                    raise ValueError(f"Invalid authorization URL format: {clean_url[:50]}...")
            else:
                clean_url = str(authorization_url)
            
            print(f"Generated authorization URL: {clean_url[:100]}...")
            return clean_url
            
        except Exception as e:
            print(f"Error generating authorization URL: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    @staticmethod
    def exchange_code_for_tokens(code: str, state: str) -> Dict:
        """Exchange authorization code for access and refresh tokens"""
        try:
            flow = GoogleFormsService.create_oauth_flow()
            flow.fetch_token(code=code)
            
            credentials = flow.credentials
            
            # Calculate token expiry as UTC timezone-NAIVE datetime (Google auth library expects naive)
            expiry = datetime.utcnow() + timedelta(seconds=3600)
            
            tokens = {
                'access_token': credentials.token,
                'refresh_token': credentials.refresh_token,
                'token_expiry': expiry.isoformat() + 'Z'  # Add Z to indicate UTC
            }
            
            print(f"Successfully exchanged code for tokens")
            print(f"Access token: {credentials.token[:20]}...")
            print(f"Has refresh token: {bool(credentials.refresh_token)}")
            print(f"Token expiry: {expiry.isoformat()}Z")
            
            return tokens
            
        except Exception as e:
            print(f"Error exchanging code for tokens: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    @staticmethod
    def get_credentials_from_tokens(access_token: str, refresh_token: str, token_expiry: str) -> Credentials:
        """Create Credentials object from stored tokens"""
        try:
            print(f"Parsing token expiry: {token_expiry}")
            
            # Parse as timezone-NAIVE UTC datetime (Google auth library expects naive)
            # Remove the 'Z' suffix and parse as naive datetime
            expiry_str = token_expiry.replace('Z', '').replace('+00:00', '')
            expiry_dt = datetime.fromisoformat(expiry_str)
            
            print(f"Parsed datetime: {expiry_dt} (naive: {expiry_dt.tzinfo is None})")
            
            credentials = Credentials(
                token=access_token,
                refresh_token=refresh_token,
                token_uri='https://oauth2.googleapis.com/token',
                client_id=settings.GOOGLE_CLIENT_ID,
                client_secret=settings.GOOGLE_CLIENT_SECRET,
                scopes=GoogleFormsService.SCOPES
            )
            
            credentials.expiry = expiry_dt
            print(f"Credentials expiry set to: {credentials.expiry}")
            
            # Refresh if expired
            if credentials.expired:
                print("Token expired, refreshing...")
                try:
                    credentials.refresh(Request())
                    print("Token refreshed successfully")
                except Exception as refresh_error:
                    print(f"Failed to refresh token: {refresh_error}")
                    # Token is invalid (revoked or expired refresh token)
                    raise ValueError("Token refresh failed - credentials may have been revoked")
            else:
                print("Token is still valid, no refresh needed")
            
            return credentials
            
        except Exception as e:
            print(f"Error creating credentials: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    @staticmethod
    def extract_form_id(form_url: str) -> Optional[str]:
        """Extract form ID from Google Form URL
        
        Handles multiple Google Forms URL formats:
        - https://docs.google.com/forms/d/e/FORM_ID/viewform (new format)
        - https://docs.google.com/forms/d/FORM_ID/edit (old format)
        - https://docs.google.com/forms/d/FORM_ID/viewform (old format)
        """
        try:
            # Remove query parameters and fragments
            clean_url = form_url.split('?')[0].split('#')[0]
            parts = clean_url.split("/")
            
            # Look for the 'd' segment which indicates the form ID section
            for i, part in enumerate(parts):
                if part == 'd':
                    # Check if next part is 'e' (new format: /d/e/FORM_ID/)
                    if i + 2 < len(parts) and parts[i + 1] == 'e':
                        form_id = parts[i + 2]
                        print(f"Extracted form ID (new format): {form_id}")
                        return form_id
                    # Old format: /d/FORM_ID/
                    elif i + 1 < len(parts):
                        form_id = parts[i + 1]
                        # Skip if it's 'e' (would be part of new format)
                        if form_id != 'e':
                            print(f"Extracted form ID (old format): {form_id}")
                            return form_id
            
            print(f"Could not extract form ID from URL: {form_url}")
            return None
            
        except Exception as e:
            print(f"Error extracting form ID: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    @staticmethod
    def get_form_metadata(credentials: Credentials, form_id: str) -> Dict:
        """Fetch form metadata from Google Forms API"""
        try:
            print(f"Fetching metadata for form: {form_id}")
            print(f"Form ID length: {len(form_id)} characters")
            
            service = build('forms', 'v1', credentials=credentials)
            
            # Try to get the form
            try:
                form = service.forms().get(formId=form_id).execute()
            except Exception as api_error:
                error_str = str(api_error)
                if '404' in error_str or 'not found' in error_str.lower():
                    print(f"ERROR: Form not found with ID: {form_id}")
                    print(f"This could mean:")
                    print(f"  1. The form doesn't exist or was deleted")
                    print(f"  2. The Google account doesn't have access to this form")
                    print(f"  3. The form ID format is incorrect")
                    print(f"  4. The form might be in a different Google Workspace")
                    raise
                else:
                    raise
            
            # Extract relevant metadata
            metadata = {
                'title': form.get('info', {}).get('title', 'Untitled Form'),
                'description': form.get('info', {}).get('description', ''),
                'email_collection_enabled': False,
                'email_collection_type': 'NONE'
            }
            
            # Check if email collection is enabled
            settings_info = form.get('settings', {})
            if settings_info:
                quiz_settings = settings_info.get('quizSettings', {})
                email_collection = quiz_settings.get('isQuiz', False)
                
                # Check responderUri settings
                responder_uri = form.get('responderUri', '')
                
                # More reliable: check if the form collects email
                # This is typically in settings
                if 'collectEmail' in str(settings_info).lower():
                    metadata['email_collection_enabled'] = True
                    metadata['email_collection_type'] = 'RESPONDER'
            
            print(f"Form metadata: {metadata}")
            return metadata
            
        except Exception as e:
            print(f"Error fetching form metadata: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    @staticmethod
    def get_form_responses(credentials: Credentials, form_id: str) -> List[Dict]:
        """Fetch all responses for a form"""
        try:
            print(f"Fetching responses for form: {form_id}")
            
            service = build('forms', 'v1', credentials=credentials)
            result = service.forms().responses().list(formId=form_id).execute()
            
            responses = result.get('responses', [])
            
            # Extract respondent emails and response data
            processed_responses = []
            for response in responses:
                respondent_email = response.get('respondentEmail', '')
                response_id = response.get('responseId', '')
                create_time = response.get('createTime', '')
                
                processed_responses.append({
                    'respondent_email': respondent_email,
                    'response_id': response_id,
                    'submitted_at': create_time
                })
            
            print(f"Found {len(processed_responses)} responses")
            if processed_responses:
                print(f"Sample response: {processed_responses[0]}")
            
            return processed_responses
            
        except Exception as e:
            print(f"Error fetching form responses: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    @staticmethod
    def check_email_collection(credentials: Credentials, form_id: str) -> bool:
        """Check if form has email collection enabled"""
        try:
            metadata = GoogleFormsService.get_form_metadata(credentials, form_id)
            
            # For now, we'll check if we can get respondent emails from responses
            # This is the most reliable way
            responses = GoogleFormsService.get_form_responses(credentials, form_id)
            
            # If any response has an email, collection is enabled
            has_emails = any(r.get('respondent_email') for r in responses)
            
            if not has_emails and len(responses) == 0:
                # If no responses yet, we can't tell for sure
                # Return True to allow form creation, but warn user
                print("Warning: No responses yet to verify email collection")
                return True
            
            print(f"Email collection enabled: {has_emails}")
            return has_emails
            
        except Exception as e:
            print(f"Error checking email collection: {e}")
            # Default to True to not block during testing
            return True
