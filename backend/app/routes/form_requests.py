
from flask import Blueprint, request, jsonify, session
from datetime import datetime
import traceback

# Import your models and database tools
from models.user import User
from models.group import Group
from models.database import get_db, Collections
from utils.google_forms_service import GoogleFormsService


# Define the Blueprint
form_requests_bp = Blueprint('form_requests', __name__)


# Get all form requests
@form_requests_bp.get("/api/form-requests")
def get_form_requests():
    """Retrieve all form requests from the database"""
    from models.database import Collections
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        db = get_db()
        
        form_requests = db.collection(Collections.FORM_REQUESTS)\
            .where('owner_id', '==', user_id)\
            .stream()
        
        requests_list = []
        for req in form_requests:
            request_data = req.to_dict()
            
            # Get form data from forms collection to include last_synced_at, title, form_url, etc.
            form_id = request_data.get('form_id')
            if not form_id:
                # Fallback: try using google_form_id for older form requests
                form_id = request_data.get('google_form_id')
            
            form_data = {}
            if form_id:
                form_ref = db.collection(Collections.FORMS).document(form_id)
                form_doc = form_ref.get()
                if form_doc.exists:
                    form_data = form_doc.to_dict()
            
            # Don't use created_at as fallback for last_synced_at - they should be different
            # last_synced_at should only exist if the form has been synced
            
            # Get group to calculate total_recipients
            group_id = request_data.get('group_id')
            total_recipients = 0
            if group_id:
                group = Group.get_by_id(group_id)
                if group:
                    total_recipients = len(group.members)
            
            # Calculate response_count dynamically from responses collection
            response_count = 0
            responses_query = db.collection(Collections.RESPONSES)\
                .where('request_id', '==', req.id)\
                .stream()
            response_count = sum(1 for _ in responses_query)
            
            # Calculate warnings dynamically
            warnings = []
            form_settings = form_data.get('form_settings', {})
            email_collection_enabled = form_settings.get('email_collection_enabled', True)
            api_access_available = form_data.get('api_access_available', True)
            
            if not email_collection_enabled:
                warnings.append(
                    "Email collection may not be enabled on this form. In Google Forms: Settings (gear) → "
                    "Responses → turn on 'Collect email addresses', or add a question that asks for email."
                )
            
            if not api_access_available:
                warnings.append(
                    "Could not access this form via the API. If Refresh fails: reconnect your Google account "
                    "(e.g. from Create Request), or ensure the form owner has granted you edit access to the form."
                )
            
            # Merge form data into request_data
            merged_data = {
                **request_data,
                **form_data,  # Merge form data (form_url, title, description, last_synced_at, etc.)
                "response_count": response_count,  # Include dynamically calculated response_count
                "total_recipients": total_recipients,  # Always include fresh count
                "warnings": warnings  # Include dynamically calculated warnings
            }
            
            requests_list.append({
                "id": req.id,
                **merged_data
            })
        
        print(f"Retrieved {len(requests_list)} form requests for user {user_id}")
        return jsonify(requests_list)
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error fetching form requests: {error_msg}")
        return jsonify({
            "error": "Failed to fetch form requests",
            "details": error_msg
        }), 500


# Get responses for a specific form request
@form_requests_bp.get("/api/form-requests/<request_id>/responses")
def get_form_request_responses(request_id: str):
    """Get all responses for a form request"""
    from models.database import Collections
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        db = get_db()
        
        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()
        
        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404
        
        request_data = request_doc.to_dict()
        
        # Verify ownership
        if request_data.get('owner_id') != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Get form data from forms collection
        form_id = request_data.get('form_id')
        form_data = {}
        if form_id:
            form_ref = db.collection(Collections.FORMS).document(form_id)
            form_doc = form_ref.get()
            if form_doc.exists:
                form_data = form_doc.to_dict()
        
        # Get the group
        group_id = request_data.get('group_id')
        group = None
        group_emails = set()
        
        if group_id:
            group = Group.get_by_id(group_id)
            if group:
                group_emails = {member['email'].lower() for member in group.members}
        
        # Get responses from database
        responses = db.collection(Collections.RESPONSES)\
            .where('request_id', '==', request_id)\
            .stream()
        
        responses_list = []
        non_member_responses = []
        
        # Normalize all response emails for matching
        for response in responses:
            response_data = response.to_dict()
            response_email = response_data.get('respondent_email', '').strip().lower()
            
            response_obj = {
                "id": response.id,
                **response_data,
                "is_member": response_email in group_emails if group_emails else True
            }
            
            if group_emails and response_email not in group_emails:
                non_member_responses.append(response_obj)
            else:
                responses_list.append(response_obj)
        
        # Create member status list - match by normalized email
        member_status = []
        if group:
            # Create a map of normalized emails to responses for quick lookup
            response_map = {}
            for r in responses_list:
                email_key = r.get('respondent_email', '').strip().lower()
                if email_key:
                    response_map[email_key] = r
            
            for member in group.members:
                member_email = member.get('email', '').strip().lower()
                member_email_original = member.get('email', '')  # Keep original for display
                
                # Check if this member has responded
                matching_response = response_map.get(member_email)
                has_responded = matching_response is not None
                
                member_status.append({
                    "email": member_email_original,
                    "status": "responded" if has_responded else "not_responded",
                    "submitted_at": matching_response.get('submitted_at') if matching_response else None
                })
                
                if has_responded:
                    print(f"  Member {member_email_original} has responded")
                else:
                    print(f"  Member {member_email_original} has not responded")
        
        print(f"Retrieved {len(responses_list)} member responses and {len(non_member_responses)} non-member responses for request {request_id}")
        
        # Calculate fresh total_recipients from group
        total_recipients = len(group.members) if group else 0
        response_count = len(responses_list)
        
        # Calculate warnings dynamically
        warnings = []
        form_settings = form_data.get('form_settings', {})
        email_collection_enabled = form_settings.get('email_collection_enabled', True)
        api_access_available = form_data.get('api_access_available', True)
        
        if not email_collection_enabled:
            warnings.append(
                "Email collection may not be enabled on this form. In Google Forms: Settings (gear) → "
                "Responses → turn on 'Collect email addresses', or add a question that asks for email."
            )
        
        if not api_access_available:
            warnings.append(
                "Could not access this form via the API. If Refresh fails: reconnect your Google account "
                "(e.g. from Create Request), or ensure the form owner has granted you edit access to the form."
            )
        
        # Merge form data into request_data for response
        request_data_with_form = {
            **request_data,
            **form_data,  # Merge form data (form_url, title, description, etc.)
            "warnings": warnings
        }
        
        return jsonify({
            "form_request": {
                "id": request_id,
                **request_data_with_form,
                "response_count": response_count,  # Include response_count in form_request
                "total_recipients": total_recipients  # Override with fresh count from group
            },
            "responses": responses_list,
            "non_member_responses": non_member_responses,
            "member_status": member_status,
            "response_count": response_count,
            "non_member_count": len(non_member_responses),
            "total_recipients": total_recipients
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error fetching responses: {error_msg}")
        return jsonify({
            "error": "Failed to fetch responses",
            "details": error_msg
        }), 500


# Refresh responses from Google Forms
@form_requests_bp.post("/api/form-requests/<request_id>/refresh")
def refresh_form_responses(request_id: str):
    """Manually refresh responses from Google Forms"""
    from datetime import datetime
    from models.database import Collections
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        user = User.get_by_id(user_id)
        if not user or not user.google_access_token:
            return jsonify({"error": "Google account not connected"}), 403
        
        db = get_db()
        
        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()
        
        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404
        
        request_data = request_doc.to_dict()
        
        # Verify ownership
        if request_data.get('owner_id') != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        form_id = request_data.get('google_form_id') or request_data.get('form_id')
        if not form_id:
            return jsonify({"error": "No Google Form ID found"}), 400
        
        print(f"Refreshing responses for form {form_id}")
        
        # Get user's Google credentials
        try:
            credentials = GoogleFormsService.get_credentials_from_tokens(
                access_token=user.google_access_token,
                refresh_token=user.google_refresh_token,
                token_expiry=user.token_expiry
            )
        except ValueError as cred_error:
            # Token was revoked or is invalid - clear it from database
            print(f"Credentials invalid: {cred_error}")
            print("Clearing invalid Google tokens from user account")
            user.update_google_tokens(access_token=None, refresh_token=None, expiry=None)
            return jsonify({
                "error": "Google credentials have been revoked",
                "message": "Please reconnect your Google account",
                "action_required": "reconnect_google"
            }), 401
        
        # Fetch latest responses from Google
        print(f"Fetching responses from Google Forms API for form {form_id}...")
        try:
            responses = GoogleFormsService.get_form_responses(credentials, form_id)
        except Exception as api_err:
            err_str = str(api_err)
            # 404 from Forms API = form ID not found (viewform URL uses a different "published" ID than the API expects)
            if "404" in err_str or "Requested entity was not found" in err_str or "not found" in err_str.lower():
                return jsonify({
                    "error": "Form not found",
                    "message": "The form link you used is likely the view/share link. The API needs the edit link: open the form in Google Forms and copy the URL from the address bar (it contains /edit). Re-create the form request with that edit URL.",
                    "code": "form_id_edit_link_required"
                }), 404
            # 403 from Google = no permission
            if "403" in err_str or "Forbidden" in err_str:
                return jsonify({
                    "error": "No access to this form",
                    "message": "Reconnect your Google account or ensure the form owner has granted you edit access so we can sync responses.",
                    "action_required": "reconnect_google"
                }), 403
            # Credential/refresh errors
            if "invalid_grant" in err_str or "revoked" in err_str or "credentials" in err_str.lower():
                user.update_google_tokens(access_token=None, refresh_token=None, expiry=None)
                return jsonify({
                    "error": "Google credentials invalid",
                    "message": "Please reconnect your Google account",
                    "action_required": "reconnect_google"
                }), 401
            raise

        print(f"Found {len(responses)} total responses from Google")
        if responses:
            # Log sample response emails for debugging
            sample_emails = [r.get('respondent_email', 'no email') for r in responses[:3]]
            print(f"   Sample respondent emails: {sample_emails}")
        
        # Get existing responses to check for duplicates by response_id
        existing_responses = {}
        old_responses = db.collection(Collections.RESPONSES)\
            .where('request_id', '==', request_id)\
            .stream()
        
        for old_response in old_responses:
            old_data = old_response.to_dict()
            response_id = old_data.get('response_id')
            if response_id:
                existing_responses[response_id] = old_response.reference
        
        print(f"Found {len(existing_responses)} existing responses in database")
        
        # Store new/updated responses with full answer data
        stored_count = 0
        updated_count = 0
        new_count = 0
        
        for response in responses:
            response_id = response.get('response_id', '')
            response_data = {
                'request_id': request_id,
                'form_id': form_id,
                'respondent_email': response.get('respondent_email', ''),
                'response_id': response_id,
                'submitted_at': response.get('submitted_at', ''),
                'last_submitted_at': response.get('last_submitted_at', ''),
                'total_score': response.get('total_score'),
                'answers': response.get('answers', {}),  # Full answer data
                'answer_count': response.get('answer_count', 0),
                'created_at': datetime.utcnow().isoformat() + 'Z'
            }
            
            # Update existing response or create new one
            if response_id and response_id in existing_responses:
                # Update existing response
                existing_responses[response_id].set(response_data)
                updated_count += 1
                # Remove from dict so we know which ones to delete
                del existing_responses[response_id]
            else:
                # Create new response
                db.collection(Collections.RESPONSES).add(response_data)
                new_count += 1
            
            stored_count += 1
        
        # Delete responses that no longer exist in Google Forms
        deleted_count = 0
        for response_id, response_ref in existing_responses.items():
            response_ref.delete()
            deleted_count += 1
        
        print(f"Sync complete: {new_count} new, {updated_count} updated, {deleted_count} deleted")
        
        # Infer email collection from responses: if any response has respondent_email, it's enabled
        any_response_has_email = any(
            (r.get('respondent_email') or '').strip() for r in responses
        )
        
        # Update form document in forms collection with sync time
        form_doc_id = request_data.get('form_id')
        if not form_doc_id:
            # Fallback: try using google_form_id for older form requests
            form_doc_id = request_data.get('google_form_id')
        
        if form_doc_id:
            form_ref = db.collection(Collections.FORMS).document(form_doc_id)
            form_doc = form_ref.get()
            sync_time = datetime.utcnow().isoformat() + 'Z'
            if form_doc.exists:
                update_data = {
                    'last_synced_at': sync_time,
                    'api_access_available': True,
                    'updated_at': sync_time
                }
                if any_response_has_email:
                    try:
                        existing_settings = (form_doc.to_dict() or {}).get('form_settings') or {}
                        if isinstance(existing_settings, dict):
                            update_data['form_settings'] = {
                                **existing_settings,
                                'email_collection_enabled': True,
                                'email_collection_type': 'VERIFIED'
                            }
                    except Exception:
                        pass  # Don't fail refresh if form_settings update fails
                try:
                    form_ref.update(update_data)
                    print(f"Updated form document {form_doc_id} with sync time")
                except Exception as update_err:
                    print(f"Warning: Could not update form doc: {update_err}")
            else:
                # Create form document if it doesn't exist (for older form requests)
                form_ref.set({
                    'google_form_id': form_doc_id,
                    'form_url': request_data.get('form_url', ''),
                    'title': request_data.get('title', ''),
                    'description': request_data.get('description', ''),
                    'owner_id': request_data.get('owner_id'),
                    'created_at': request_data.get('created_at', sync_time),
                    'updated_at': sync_time,
                    'is_active': True,
                    'api_access_available': True,
                    'last_synced_at': sync_time,
                    'form_settings': request_data.get('form_settings', {})
                })
                print(f"Created form document {form_doc_id} with sync time")
        
        print(f"Refreshed {stored_count} responses for request {request_id}")
        
        return jsonify({
            "success": True,
            "message": "Responses refreshed successfully",
            "response_count": stored_count,
            "synced_at": datetime.utcnow().isoformat() + 'Z'
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error refreshing responses: {error_msg}")
        return jsonify({
            "error": "Failed to refresh responses",
            "details": error_msg
        }), 500

# Create a new form request
@form_requests_bp.post("/api/form-requests")
def create_form_request():
    """Create a new form request from a Google Form URL"""
    from datetime import datetime
    from models.database import Collections
    
    try:
        # Check if user is authenticated
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        user = User.get_by_id(user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        # Check if user has connected Google account
        if not user.google_access_token or not user.google_refresh_token:
            return jsonify({
                "error": "Google account not connected",
                "message": "Please connect your Google account first",
                "action_required": "reconnect_google"
            }), 403
        
        data = request.get_json()
        if not data or 'form_url' not in data:
            return jsonify({"error": "form_url is required"}), 400
        
        if 'group_id' not in data:
            return jsonify({"error": "group_id is required"}), 400
        
        if 'due_date' not in data:
            return jsonify({"error": "due_date is required"}), 400
        
        form_url = data['form_url']
        group_id = data['group_id']
        
        # Parse reminder schedule data
        reminder_schedule = data.get('reminder_schedule', 'normal')
        first_reminder_timing = data.get('first_reminder_timing', 'immediate')
        custom_days = data.get('custom_days')  # For custom schedules
        
        # Parse due date
        try:
            due_date_str = data['due_date']
            if isinstance(due_date_str, str):
                due_date = datetime.fromisoformat(due_date_str.replace('Z', '+00:00'))
            else:
                return jsonify({"error": "Invalid due_date format"}), 400
        except (ValueError, AttributeError) as e:
            return jsonify({"error": f"Invalid due_date: {str(e)}"}), 400
        
        # Parse scheduled reminder date/time if provided
        scheduled_reminder_date = None
        scheduled_reminder_time = None
        if first_reminder_timing == 'scheduled':
            if data.get('scheduled_date'):
                try:
                    scheduled_reminder_date = datetime.fromisoformat(
                        data['scheduled_date'].replace('Z', '+00:00')
                    )
                except (ValueError, AttributeError):
                    return jsonify({"error": "Invalid scheduled_date format"}), 400
            
            if data.get('scheduled_time'):
                try:
                    scheduled_reminder_time = datetime.fromisoformat(
                        data['scheduled_time'].replace('Z', '+00:00')
                    )
                except (ValueError, AttributeError):
                    return jsonify({"error": "Invalid scheduled_time format"}), 400
        
        # Validate and process reminder schedule
        from utils.reminder_schedule import ReminderSchedule
        
        if reminder_schedule == 'custom':
            if not custom_days:
                return jsonify({"error": "custom_days required for custom schedule"}), 400
            is_valid, error_msg = ReminderSchedule.validate_custom_schedule(custom_days)
            if not is_valid:
                return jsonify({"error": error_msg}), 400
        
        schedule_config = ReminderSchedule.get_schedule_config(reminder_schedule, custom_days)
        
        # Verify group exists and user owns it
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        if group.owner_id != user_id:
            return jsonify({"error": "You don't own this group"}), 403
        
        print(f"Creating form request for URL: {form_url} with group: {group.name}")
        
        # Extract form ID
        form_id = GoogleFormsService.extract_form_id(form_url)
        if not form_id:
            return jsonify({"error": "Invalid Google Form URL"}), 400
        
        print(f"Extracted form ID: {form_id}")
        
        # Get user's Google credentials
        try:
            credentials = GoogleFormsService.get_credentials_from_tokens(
                access_token=user.google_access_token,
                refresh_token=user.google_refresh_token,
                token_expiry=user.token_expiry
            )
        except ValueError as cred_error:
            # Token was revoked or is invalid - clear it from database
            print(f"Credentials invalid: {cred_error}")
            print("Clearing invalid Google tokens from user account")
            user.update_google_tokens(access_token=None, refresh_token=None, expiry=None)
            return jsonify({
                "error": "Google credentials have been revoked",
                "message": "Please reconnect your Google account",
                "action_required": "reconnect_google"
            }), 401
        
        # Fetch form metadata (handle errors gracefully)
        print("Fetching form metadata...")
        metadata = {}
        api_access_available = False
        email_collection_enabled = False
        
        try:
            metadata = GoogleFormsService.get_form_metadata(credentials, form_id)
            api_access_available = True
            
            # Check email collection (optional for now, just warn)
            print("Checking email collection...")
            try:
                email_collection_enabled = GoogleFormsService.check_email_collection(credentials, form_id)
            except Exception as email_check_error:
                print(f"Warning: Could not check email collection: {email_check_error}")
                email_collection_enabled = False
        except Exception as metadata_error:
            print(f"Warning: Could not fetch form metadata: {metadata_error}")
            print("This usually means you don't have edit access to the form.")
            print("The form request will be created, but you'll need to grant edit access to sync responses.")
            api_access_available = False
            # Use default metadata
            metadata = {
                'title': data.get('title', f"Form {form_id[:8]}"),
                'description': '',
                'email_collection_enabled': False,
                'email_collection_type': 'UNKNOWN'
            }
        
        # Get initial response count (only if API access is available)
        responses = []
        if api_access_available:
            print("Fetching initial responses...")
            try:
                responses = GoogleFormsService.get_form_responses(credentials, form_id)
            except Exception as responses_error:
                print(f"Warning: Could not fetch initial responses: {responses_error}")
                responses = []
        else:
            print("Skipping initial response fetch (API access not available)")
        
        if not email_collection_enabled and api_access_available:
            print("WARNING: Email collection may not be enabled on this form")
        
        db = get_db()
        
        # Calculate reminder dates based on schedule
        reminder_days = schedule_config['reminder_days']
        reminder_dates = ReminderSchedule.calculate_reminder_dates(due_date, reminder_days)
        
        # Create or update form document in forms collection
        now = datetime.utcnow().isoformat() + 'Z'
        form_doc_id = form_id  # Use google_form_id as the document ID
        
        form_data = {
            'google_form_id': form_id,
            'form_url': form_url,
            'title': data.get('title') or metadata.get('title', f"Form {form_id[:8]}"),
            'description': metadata.get('description', ''),
            'owner_id': user_id,
            'created_at': now,
            'updated_at': now,
            'is_active': True,
            'api_access_available': api_access_available,  # Set based on whether we could fetch metadata
            # Don't set last_synced_at on creation - it will be set when first synced
            'form_settings': {
                'email_collection_enabled': email_collection_enabled,
                'email_collection_type': metadata.get('email_collection_type', 'UNKNOWN')
            }
        }
        
        form_ref = db.collection(Collections.FORMS).document(form_doc_id)
        form_doc = form_ref.get()
        if form_doc.exists:
            # Update existing form document (don't update last_synced_at unless syncing)
            form_ref.update({
                'form_url': form_url,
                'title': data.get('title') or metadata.get('title', f"Form {form_id[:8]}"),
                'description': metadata.get('description', ''),
                'updated_at': now,
                'api_access_available': api_access_available,
                'form_settings': form_data['form_settings']
            })
        else:
            # Create new form document (without last_synced_at - will be set on first sync)
            form_ref.set(form_data)
        
        # Create form request document with enhanced metadata
        form_request_data = {
            'form_id': form_doc_id,  # Reference to forms collection
            'google_form_id': form_id,
            'owner_id': user_id,
            'group_id': group_id,
            'created_at': now,
            'status': 'Active',
            'is_active': True,
            # Reminder schedule configuration
            'due_date': due_date.isoformat() + 'Z',
            'reminder_schedule': {
                'schedule_type': reminder_schedule,
                'reminder_days': reminder_days,
                'is_custom': schedule_config['is_custom'],
                'custom_days': custom_days if reminder_schedule == 'custom' else None,
                'calculated_reminder_dates': [d.isoformat() + 'Z' for d in reminder_dates]
            },
            'first_reminder_timing': {
                'timing_type': first_reminder_timing,
                'scheduled_date': scheduled_reminder_date.isoformat() + 'Z' if scheduled_reminder_date else None,
                'scheduled_time': scheduled_reminder_time.isoformat() + 'Z' if scheduled_reminder_time else None,
            }
        }
        
        # Add to form_requests collection
        doc_ref = db.collection(Collections.FORM_REQUESTS).document()
        doc_ref.set(form_request_data)
        
        # Store responses in responses collection
        for response in responses:
            response_data = {
                'request_id': doc_ref.id,
                'form_id': form_id,
                'respondent_email': response.get('respondent_email', ''),
                'response_id': response.get('response_id', ''),
                'submitted_at': response.get('submitted_at', ''),
                'created_at': datetime.utcnow().isoformat() + 'Z'
            }
            db.collection(Collections.RESPONSES).add(response_data)
        
        print(f"Form request created with ID: {doc_ref.id}")
        print(f"   Title: {metadata.get('title')}")
        print(f"   Responses: {len(responses)}")
        print(f"   Email collection: {email_collection_enabled}")
        
        return jsonify({
            "success": True,
            "id": doc_ref.id,
            "form_request": {
                "id": doc_ref.id,
                **form_request_data
            }
        }), 201
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error creating form request: {error_msg}")
        return jsonify({
            "error": "Failed to create form request",
            "details": error_msg
        }), 500
    

# Update an existing form request
@form_requests_bp.put("/api/form-requests/<request_id>")
def update_form_request(request_id):
    """Update an existing form request configuration"""
    from datetime import datetime
    from models.database import Collections, get_db
    # Import necessary utilities (matching your existing imports)
    from utils.reminder_schedule import ReminderSchedule
    
    try:
        # 1. Auth Check
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
            
        # 2. Get existing request
        db = get_db()
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        doc = request_ref.get()
        
        if not doc.exists:
            return jsonify({"error": "Form request not found"}), 404
            
        existing_data = doc.to_dict()
        
        # 3. Ownership Check
        if existing_data.get('owner_id') != user_id:
            return jsonify({"error": "You don't have permission to edit this request"}), 403

        # 4. Parse Input
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        updates = {
            'updated_at': datetime.utcnow().isoformat() + 'Z'
        }

        # --- Handle Basic Fields ---
        if 'title' in data:
            updates['title'] = data['title']
            
        if 'description' in data:
            updates['description'] = data['description']

        if 'form_url' in data and data['form_url'] != existing_data.get('form_url'):
            # Note: Changing URL might invalidate existing responses, but we allow the config change
            updates['form_url'] = data['form_url']
            # Optionally extract new ID if needed, but usually we just update the link reference
            #TODO: Consider implications of changing form ID on existing responses !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
            # from services.google_forms import GoogleFormsService
            # new_form_id = GoogleFormsService.extract_form_id(data['form_url'])
            # if new_form_id:
            #     updates['google_form_id'] = new_form_id

        # --- Handle Group Changes ---
        if 'group_id' in data and data['group_id'] != existing_data.get('group_id'):
            new_group_id = data['group_id']
            # Verify new group ownership
            group = Group.get_by_id(new_group_id)
            if not group:
                return jsonify({"error": "New group not found"}), 404
            if group.owner_id != user_id:
                return jsonify({"error": "You don't own the selected group"}), 403
            
            updates['group_id'] = new_group_id
            updates['total_recipients'] = len(group.members)

        # --- Handle Schedule & Date Logic ---
        # We need to determine if we need to recalculate dates
        needs_reschedule = False
        
        # Get current or new values
        current_due_date_str = existing_data.get('due_date')
        new_due_date_str = data.get('due_date')
        
        current_schedule_config = existing_data.get('reminder_schedule', {})
        current_schedule_type = current_schedule_config.get('schedule_type')

        raw_schedule_input = data.get('reminder_schedule')
        
        # If the frontend sent the whole object (dict), extract just the type string
        if isinstance(raw_schedule_input, dict):
            new_schedule_type = raw_schedule_input.get('schedule_type')
        else:
            new_schedule_type = raw_schedule_input
        
        # Check if due date changed
        final_due_date_obj = None
        if new_due_date_str:
            try:
                if isinstance(new_due_date_str, str):
                    final_due_date_obj = datetime.fromisoformat(new_due_date_str.replace('Z', '+00:00'))
                    updates['due_date'] = final_due_date_obj.isoformat() + 'Z'
                    if new_due_date_str != current_due_date_str:
                        needs_reschedule = True
                else:
                    return jsonify({"error": "Invalid due_date format"}), 400
            except ValueError as e:
                return jsonify({"error": f"Invalid due_date: {str(e)}"}), 400
        elif current_due_date_str:
             # Parse existing due date for calculation
             final_due_date_obj = datetime.fromisoformat(current_due_date_str.replace('Z', '+00:00'))

        # Check if schedule config changed
        final_schedule_type = new_schedule_type or current_schedule_type
        final_custom_days = data.get('custom_days') or current_schedule_config.get('custom_days')

        if new_schedule_type and new_schedule_type != current_schedule_type:
            needs_reschedule = True
        
        if final_schedule_type == 'custom' and data.get('custom_days'):
            # If providing new custom days, we definitely reschedule
            needs_reschedule = True
            # Validate custom days
            is_valid, error_msg = ReminderSchedule.validate_custom_schedule(final_custom_days)
            if not is_valid:
                return jsonify({"error": error_msg}), 400

        # --- Execute Recalculation if needed ---
        if needs_reschedule and final_due_date_obj:
            print(f"Recalculating schedule for request {request_id}")
            
            # Get config
            schedule_config = ReminderSchedule.get_schedule_config(final_schedule_type, final_custom_days)
            
            # Calculate new dates
            reminder_days = schedule_config['reminder_days']
            reminder_dates = ReminderSchedule.calculate_reminder_dates(final_due_date_obj, reminder_days)
            
            # Update structure
            updates['reminder_schedule'] = {
                'schedule_type': final_schedule_type,
                'reminder_days': reminder_days,
                'is_custom': schedule_config['is_custom'],
                'custom_days': final_custom_days if final_schedule_type == 'custom' else None,
                'calculated_reminder_dates': [d.isoformat() + 'Z' for d in reminder_dates]
            }

        # --- Handle First Reminder Timing ---
        # If timing changes, we update the config. 
        # Note: We do NOT automatically send "immediate" emails on edit, 
        # as that could spam users if you just wanted to fix a typo.
        if 'first_reminder_timing' in data:
            timing_type = data['first_reminder_timing']
            
            timing_update = {
                'timing_type': timing_type,
                'scheduled_date': None,
                'scheduled_time': None
            }
            
            if timing_type == 'scheduled':
                # Parse date
                if data.get('scheduled_date'):
                    timing_update['scheduled_date'] = data['scheduled_date'] # Assume ISO from frontend
                elif existing_data.get('first_reminder_timing', {}).get('scheduled_date'):
                    timing_update['scheduled_date'] = existing_data['first_reminder_timing']['scheduled_date']
                    
                # Parse time
                if data.get('scheduled_time'):
                    timing_update['scheduled_time'] = data['scheduled_time'] # Assume ISO from frontend
                elif existing_data.get('first_reminder_timing', {}).get('scheduled_time'):
                    timing_update['scheduled_time'] = existing_data['first_reminder_timing']['scheduled_time']
            
            updates['first_reminder_timing'] = timing_update

        # 5. Apply Updates to DB
        request_ref.update(updates)
        
        # 6. Return updated object
        updated_doc = request_ref.get()
        return jsonify({
            "success": True,
            "message": "Request updated successfully",
            "form_request": updated_doc.to_dict()
        }), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            "error": "Failed to update form request", 
            "details": str(e)
        }), 500

@form_requests_bp.post("/api/form-requests/custom-schedule")
def create_custom_schedule():
    """Create and validate a custom reminder schedule"""
    from utils.reminder_schedule import ReminderSchedule
    
    try:
        data = request.get_json()
        if not data or 'custom_days' not in data:
            return jsonify({"error": "custom_days is required"}), 400
        
        custom_days = data['custom_days']
        
        if not isinstance(custom_days, list):
            return jsonify({"error": "custom_days must be a list"}), 400
        
        # Validate the custom schedule
        is_valid, error_msg = ReminderSchedule.validate_custom_schedule(custom_days)
        
        if not is_valid:
            return jsonify({"error": error_msg}), 400
        
        # Get the schedule configuration
        schedule_config = ReminderSchedule.get_schedule_config('custom', custom_days)
        
        return jsonify({
            "success": True,
            "schedule": schedule_config,
            "message": "Custom schedule created successfully"
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        return jsonify({
            "error": "Failed to create custom schedule",
            "details": error_msg
        }), 500


@form_requests_bp.delete("/api/form-requests/<request_id>")
def delete_form_request(request_id: str):
    """Delete a form request and all its responses"""
    from models.database import Collections
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        db = get_db()
        
        # Get the form request
        request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
        request_doc = request_ref.get()
        
        if not request_doc.exists:
            return jsonify({"error": "Form request not found"}), 404
        
        request_data = request_doc.to_dict()
        
        # Verify ownership
        if request_data.get('owner_id') != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Delete all responses for this request
        responses = db.collection(Collections.RESPONSES)\
            .where('request_id', '==', request_id)\
            .stream()
        
        deleted_responses = 0
        for response in responses:
            response.reference.delete()
            deleted_responses += 1
        
        # Delete the form request
        request_ref.delete()
        
        print(f"Deleted form request {request_id} and {deleted_responses} responses")
        
        return jsonify({
            "success": True,
            "message": "Form request deleted",
            "deleted_responses": deleted_responses
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error deleting form request: {error_msg}")
        return jsonify({
            "error": "Failed to delete form request",
            "details": error_msg
        }), 500