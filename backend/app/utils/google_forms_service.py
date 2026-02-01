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
            # Get the client secret file path
            client_secret_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                'client_secret.json'
            )
            
            print(f"Looking for client_secret.json at: {client_secret_path}")
            
            if not os.path.exists(client_secret_path):
                raise FileNotFoundError(f"client_secret.json not found at {client_secret_path}")
            
            flow = Flow.from_client_secrets_file(
                client_secret_path,
                scopes=GoogleFormsService.SCOPES,
                redirect_uri=settings.GOOGLE_REDIRECT_URI
            )
            
            return flow
            
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
            
            print(f"Generated authorization URL: {authorization_url}")
            return authorization_url
            
        except Exception as e:
            print(f"Error generating authorization URL: {e}")
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
        
        Handles both URL formats:
        - Old: https://docs.google.com/forms/d/FORM_ID/edit
        - New: https://docs.google.com/forms/d/e/FORM_ID/viewform
        """
        try:
            # Pattern: https://docs.google.com/forms/d/FORM_ID/edit or /viewform
            # Or: https://docs.google.com/forms/d/e/FORM_ID/viewform
            parts = form_url.split("/")
            
            for i, part in enumerate(parts):
                if part == 'd' and i + 1 < len(parts):
                    next_part = parts[i + 1]
                    # Check if next part is 'e' (new format)
                    if next_part == 'e' and i + 2 < len(parts):
                        # New format: /d/e/FORM_ID/
                        form_id = parts[i + 2]
                    else:
                        # Old format: /d/FORM_ID/
                        form_id = next_part
                    
                    # Validate form ID (should be a long alphanumeric string)
                    if form_id and len(form_id) > 10:
                        print(f"Extracted form ID: {form_id}")
                        return form_id
                    else:
                        print(f"Invalid form ID extracted: {form_id}")
                        return None
            
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
            
            service = build('forms', 'v1', credentials=credentials)
            form = service.forms().get(formId=form_id).execute()
            
            # Extract relevant metadata
            # Google Forms API: settings.emailCollectionType is VERIFIED, RESPONDER_INPUT, or DO_NOT_COLLECT
            settings_info = form.get('settings', {})
            email_collection_type = settings_info.get('emailCollectionType', 'EMAIL_COLLECTION_TYPE_UNSPECIFIED')
            # VERIFIED = collect from signed-in user; RESPONDER_INPUT = collect via form field
            email_collection_enabled = email_collection_type in ('VERIFIED', 'RESPONDER_INPUT')

            metadata = {
                'title': form.get('info', {}).get('title', 'Untitled Form'),
                'description': form.get('info', {}).get('description', ''),
                'email_collection_enabled': email_collection_enabled,
                'email_collection_type': email_collection_type if email_collection_enabled else 'DO_NOT_COLLECT'
            }

            print(f"Form metadata: {metadata}")
            return metadata
            
        except Exception as e:
            print(f"Error fetching form metadata: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    @staticmethod
    def get_form_responses(credentials: Credentials, form_id: str) -> List[Dict]:
        """Fetch all responses for a form with pagination support"""
        try:
            print(f"Fetching responses for form: {form_id}")
            
            service = build('forms', 'v1', credentials=credentials)
            
            # Fetch all responses (handle pagination)
            all_responses = []
            page_token = None
            
            while True:
                # Build request parameters
                request_params = {'formId': form_id}
                if page_token:
                    request_params['pageToken'] = page_token
                
                result = service.forms().responses().list(**request_params).execute()
                responses = result.get('responses', [])
                all_responses.extend(responses)
                
                # Check if there are more pages
                page_token = result.get('nextPageToken')
                if not page_token:
                    break
                
                print(f"Fetched {len(responses)} responses (total so far: {len(all_responses)})")
            
            print(f"Total responses found: {len(all_responses)}")
            
            # Process responses to extract all data
            processed_responses = []
            for response in all_responses:
                respondent_email = response.get('respondentEmail', '')
                response_id = response.get('responseId', '')
                create_time = response.get('createTime', '')
                last_submitted_time = response.get('lastSubmittedTime', '')
                total_score = response.get('totalScore')
                answers = response.get('answers', {})
                
                # Process answers - convert to a more usable format
                processed_answers = {}
                for question_id, answer_data in answers.items():
                    # Extract the actual answer value(s)
                    answer_value = None
                    answer_text = None
                    
                    # Handle different answer types
                    if 'textAnswers' in answer_data:
                        # Text answer
                        text_answers = answer_data['textAnswers'].get('answers', [])
                        if text_answers:
                            answer_value = text_answers[0].get('value', '')
                            answer_text = answer_value
                    elif 'choiceAnswers' in answer_data:
                        # Multiple choice, checkbox, etc.
                        choice_answers = answer_data['choiceAnswers'].get('answers', [])
                        if choice_answers:
                            answer_value = [choice.get('value', '') for choice in choice_answers]
                            answer_text = ', '.join(answer_value) if isinstance(answer_value, list) else answer_value
                    elif 'fileUploadAnswers' in answer_data:
                        # File upload
                        file_answers = answer_data['fileUploadAnswers'].get('answers', [])
                        if file_answers:
                            answer_value = [file.get('fileId', '') for file in file_answers]
                            answer_text = f"{len(answer_value)} file(s) uploaded"
                    elif 'scaleAnswers' in answer_data:
                        # Scale/rating
                        scale_answers = answer_data['scaleAnswers'].get('answers', [])
                        if scale_answers:
                            answer_value = scale_answers[0].get('value', '')
                            answer_text = str(answer_value)
                    elif 'dateAnswers' in answer_data:
                        # Date
                        date_answers = answer_data['dateAnswers'].get('answers', [])
                        if date_answers:
                            date_obj = date_answers[0].get('value', {})
                            year = date_obj.get('year', '')
                            month = date_obj.get('month', '')
                            day = date_obj.get('day', '')
                            answer_value = f"{year}-{month:02d}-{day:02d}" if year and month and day else None
                            answer_text = answer_value
                    elif 'timeAnswers' in answer_data:
                        # Time
                        time_answers = answer_data['timeAnswers'].get('answers', [])
                        if time_answers:
                            time_obj = time_answers[0].get('value', {})
                            hours = time_obj.get('hours', '')
                            minutes = time_obj.get('minutes', '')
                            answer_value = f"{hours:02d}:{minutes:02d}" if hours is not None and minutes is not None else None
                            answer_text = answer_value
                    
                    processed_answers[question_id] = {
                        'value': answer_value,
                        'text': answer_text,
                        'raw': answer_data  # Keep raw data for reference
                    }
                
                processed_responses.append({
                    'respondent_email': respondent_email,
                    'response_id': response_id,
                    'submitted_at': create_time,
                    'last_submitted_at': last_submitted_time,
                    'total_score': total_score,
                    'answers': processed_answers,
                    'answer_count': len(processed_answers)
                })
            
            print(f"Processed {len(processed_responses)} responses")
            if processed_responses:
                sample = processed_responses[0]
                print(f"Sample response - Email: {sample.get('respondent_email')}, Answers: {sample.get('answer_count')} questions")
            
            return processed_responses
            
        except Exception as e:
            print(f"Error fetching form responses: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    @staticmethod
    def check_email_collection(credentials: Credentials, form_id: str) -> bool:
        """
        Check if form has email collection enabled.
        
        FIX: Previously, this function ignored the form's actual settings (emailCollectionType)
        and only checked if existing responses had email addresses. This caused false warnings
        when:
          1. A form had email collection enabled but no responses yet
          2. A form had old responses from before email collection was turned on
          3. The form used VERIFIED emails but responses hadn't been synced
        
        NEW LOGIC:
          1. PRIMARY: Trust the form's settings (emailCollectionType = VERIFIED or RESPONDER_INPUT)
          2. FALLBACK: If settings say disabled, double-check responses in case there's
             an email question field that still captures emails
          3. Only show warning if BOTH settings say disabled AND responses lack emails
        """
        try:
            metadata = GoogleFormsService.get_form_metadata(credentials, form_id)
            
            # PRIMARY CHECK: Use form settings from Google Forms API
            # This is the authoritative source - if the form owner enabled email collection,
            # emailCollectionType will be 'VERIFIED' or 'RESPONDER_INPUT'
            if metadata.get('email_collection_enabled'):
                print(f"Email collection enabled via form settings: {metadata.get('email_collection_type')}")
                return True
            
            # FALLBACK CHECK: If settings say disabled, verify by checking actual responses
            # This handles edge cases like:
            #   - Form has a manual "Enter your email" question (not using Google's built-in collection)
            #   - API returned unexpected emailCollectionType value
            responses = GoogleFormsService.get_form_responses(credentials, form_id)
            
            # If any response has an email, collection is working (even if settings say otherwise)
            has_emails = any(r.get('respondent_email') for r in responses)
            
            if has_emails:
                print("Email collection enabled: responses contain email addresses (overriding settings)")
                return True
            
            if len(responses) == 0:
                # No responses yet and settings say disabled
                # We can't verify, so trust the settings (which say disabled)
                # This will show a warning, which is appropriate if settings truly say disabled
                print("Warning: No responses to verify; form settings indicate email collection is disabled")
                return metadata.get('email_collection_enabled', False)
            
            # Settings say disabled AND existing responses have no emails = truly disabled
            print(f"Email collection disabled: {len(responses)} responses without email addresses")
            return False
            
        except Exception as e:
            print(f"Error checking email collection: {e}")
            # Default to True to not block form creation during errors
            return True
