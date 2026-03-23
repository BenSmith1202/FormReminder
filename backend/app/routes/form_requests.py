
from flask import Blueprint, request, jsonify, session
from datetime import datetime, timezone
import traceback

# Import your models and database tools
from models.user import User
from models.group import Group
from models.database import get_db, Collections
from models.notification import (
    notify_form_submission,
    notify_form_completed,
    notify_unrecognized_submission
)
from utils.google_forms_service import GoogleFormsService
from utils.scheduler import send_initial_emails  # For immediate email sending


# Define the Blueprint
form_requests_bp = Blueprint('form_requests', __name__)


def _classify_forms_api_error(err: Exception) -> str:
    """Normalize Google Forms API errors into warning-friendly reason codes."""
    text = str(err or "").lower()
    if (
        "requested entity was not found" in text
        or " 404" in text
        or "404 " in text
        or "not found" in text
    ):
        return "form_not_found"
    if (
        "forbidden" in text
        or " 403" in text
        or "403 " in text
        or "permission" in text
        or "insufficient" in text
        or "access denied" in text
    ):
        return "account_mismatch_or_no_access"
    if "invalid_grant" in text or "revoked" in text or "credentials" in text:
        return "credentials_invalid"
    return "api_error"


def _build_form_warnings(form_data: dict) -> list[str]:
    """Build user-facing warnings from the latest persisted form state."""
    warnings: list[str] = []

    form_settings = form_data.get('form_settings', {}) or {}
    email_checked = form_settings.get('email_collection_checked', True)
    email_collection_enabled = form_settings.get('email_collection_enabled', True)
    if email_checked and not email_collection_enabled:
        warnings.append(
            "Email collection is currently OFF for this Google Form. In Google Forms: "
            "Settings -> Responses -> turn on 'Collect email addresses'."
        )

    api_access_available = form_data.get('api_access_available', True)
    api_error_reason = form_data.get('api_error_reason')
    if not api_access_available:
        if api_error_reason == 'account_mismatch_or_no_access':
            warnings.append(
                "The Google account you connected does not currently have edit access to this form. "
                "Connect the correct Google account or share the form with that account as an editor."
            )
        elif api_error_reason == 'form_not_found':
            warnings.append(
                "This form could not be found by the API. Use the Google Forms edit URL (contains /edit), "
                "not the public view/share URL."
            )
        elif api_error_reason == 'credentials_invalid':
            warnings.append(
                "Your Google connection is no longer valid. Reconnect your Google account to resume syncing."
            )
        else:
            warnings.append(
                "We could not access this form via the Google API. We will keep retrying on sync, and this "
                "warning will clear automatically once access works again."
            )

    return warnings


# Get all form requests
@form_requests_bp.get("")
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
            
            # Get group to calculate total_recipients and member emails
            group_id = request_data.get('group_id')
            total_recipients = 0
            group_emails = set()
            if group_id:
                group = Group.get_by_id(group_id)
                if group:
                    total_recipients = len(group.members)
                    group_emails = {m['email'].lower() for m in group.members}
            
            # Calculate response_count - only count responses from group members
            response_count = 0
            responses_query = db.collection(Collections.RESPONSES)\
                .where('request_id', '==', req.id)\
                .stream()
            
            for resp in responses_query:
                resp_email = resp.to_dict().get('respondent_email', '').lower()
                # Only count if email is in group or no group exists
                if not group_emails or resp_email in group_emails:
                    response_count += 1
            
            # Calculate warnings from the latest persisted API/form state
            warnings = _build_form_warnings(form_data)
            
            # Merge form data into request_data - request_data takes precedence
            # IMPORTANT: We only use form_data for fields that don't exist in request_data
            # (like last_synced_at, api_access_available, form_settings)
            # The title should ALWAYS come from request_data to avoid duplicate title bug
            merged_data = {
                # Only pull specific fields from form_data that we actually need
                "last_synced_at": form_data.get('last_synced_at'),
                "api_access_available": form_data.get('api_access_available', True),
                "form_settings": form_data.get('form_settings', {}),
                # Now spread all of request_data (this is the source of truth)
                **request_data,
                # Override with dynamically calculated fields
                "response_count": response_count,
                "total_recipients": total_recipients,
                "warnings": warnings
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
@form_requests_bp.get("/<request_id>/responses")
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
        
        # Calculate warnings from the latest persisted API/form state
        warnings = _build_form_warnings(form_data)
        
        # Merge form data into request_data for response - request_data takes precedence
        request_data_with_form = {
            **form_data,  # Form data first (base - last_synced_at, api_access, etc.)
            **request_data,  # Request data second (overrides - title, description, etc.)
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
@form_requests_bp.post("/<request_id>/refresh")
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
            api_error_reason = _classify_forms_api_error(api_err)

            # Persist failure state so dashboard warnings explain the real reason.
            form_doc_id = request_data.get('form_id') or request_data.get('google_form_id')
            if form_doc_id:
                try:
                    db.collection(Collections.FORMS).document(form_doc_id).set(
                        {
                            'api_access_available': False,
                            'api_error_reason': api_error_reason,
                            'updated_at': datetime.now(timezone.utc).isoformat(),
                        },
                        merge=True,
                    )
                except Exception as persist_err:
                    print(f"Warning: failed to persist API error reason: {persist_err}")

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
                    "message": "The connected Google account does not have edit access to this form. Connect the correct Google account or ask the form owner to share editor access.",
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
                'created_at': datetime.now(timezone.utc).isoformat()
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
        
        # Check if FormRequest has notifications enabled; default is True
        notifs = True
        if request_data.get("notifications_enabled") == False:
            notifs == False
        
        # Only notify if the FormRequest has notifications enabled

        if notifs:
            # --- NOTIFICATION TRIGGERS ---
            # Notify for each new submission
            if new_count > 0:
                form_title = request_data.get('title', 'Untitled Form')
                owner_id = request_data.get('owner_id')
                
                # Get group members to check if submission is from recognized email
                group_id = request_data.get('group_id')
                group_emails = set()
                if group_id:
                    group = Group.get_by_id(group_id)
                    if group:
                        group_emails = {m['email'].lower() for m in group.members}
                
                # Track member response count for completion check
                member_response_count = 0
                
                for response in responses:
                    response_id = response.get('response_id', '')
                    respondent_email = response.get('respondent_email', '').strip()
                    
                    # Count member responses for completion check
                    if not group_emails or respondent_email.lower() in group_emails:
                        member_response_count += 1
                    
                    # If this is a new response, send appropriate notification
                    if response_id and response_id not in existing_responses:
                        if group_emails and respondent_email.lower() not in group_emails:
                            # Unrecognized email - send yellow warning notification
                            notify_unrecognized_submission(
                                user_id=owner_id,
                                form_name=form_title,
                                form_reminder_id=request_id,
                                respondent_email=respondent_email or 'Unknown'
                            )
                        else:
                            # Recognized member submission
                            notify_form_submission(
                                user_id=owner_id,
                                form_name=form_title,
                                form_reminder_id=request_id,
                                respondent_email=respondent_email or 'Unknown'
                            )
                
                # Check if form is now fully completed (only count member responses)
                if group_id and group_emails:
                    total_recipients = len(group_emails)
                    if total_recipients > 0 and member_response_count >= total_recipients:
                        notify_form_completed(
                            user_id=owner_id,
                            form_name=form_title,
                            form_reminder_id=request_id
                        )
            
        # Re-check metadata on every successful sync so warnings self-heal if user fixed settings.
        metadata = {}
        email_collection_checked = False
        email_collection_enabled = True
        try:
            metadata = GoogleFormsService.get_form_metadata(credentials, form_id)
            email_collection_enabled = GoogleFormsService.check_email_collection(credentials, form_id)
            email_collection_checked = True
        except Exception as metadata_err:
            # Don't fail refresh if metadata check fails; we still synced responses.
            print(f"Warning: metadata re-check failed after refresh: {metadata_err}")
        
        # Update form document in forms collection with sync time
        form_doc_id = request_data.get('form_id')
        if not form_doc_id:
            # Fallback: try using google_form_id for older form requests
            form_doc_id = request_data.get('google_form_id')
        
        if form_doc_id:
            form_ref = db.collection(Collections.FORMS).document(form_doc_id)
            form_doc = form_ref.get()
            sync_time = datetime.now(timezone.utc).isoformat()
            if form_doc.exists:
                existing_settings = (form_doc.to_dict() or {}).get('form_settings') or {}
                update_data = {
                    'last_synced_at': sync_time,
                    'api_access_available': True,
                    'api_error_reason': None,
                    'updated_at': sync_time
                }
                if isinstance(existing_settings, dict):
                    update_data['form_settings'] = {
                        **existing_settings,
                        'email_collection_checked': email_collection_checked,
                    }
                    if email_collection_checked:
                        update_data['form_settings'].update({
                            'email_collection_enabled': email_collection_enabled,
                            'email_collection_type': metadata.get('email_collection_type', existing_settings.get('email_collection_type', 'UNKNOWN')),
                        })
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
                    'api_error_reason': None,
                    'last_synced_at': sync_time,
                    'form_settings': {
                        **(request_data.get('form_settings', {}) or {}),
                        'email_collection_checked': email_collection_checked,
                        'email_collection_enabled': email_collection_enabled if email_collection_checked else True,
                        'email_collection_type': metadata.get('email_collection_type', 'UNKNOWN') if email_collection_checked else 'UNKNOWN',
                    }
                })
                print(f"Created form document {form_doc_id} with sync time")
        
        print(f"Refreshed {stored_count} responses for request {request_id}")
        
        return jsonify({
            "success": True,
            "message": "Responses refreshed successfully",
            "response_count": stored_count,
            "synced_at": datetime.now(timezone.utc).isoformat()
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
@form_requests_bp.post("")
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
        api_error_reason = None
        email_collection_enabled = True
        email_collection_checked = False
        
        try:
            metadata = GoogleFormsService.get_form_metadata(credentials, form_id)
            api_access_available = True
            
            # Check email collection (optional for now, just warn)
            print("Checking email collection...")
            try:
                email_collection_enabled = GoogleFormsService.check_email_collection(credentials, form_id)
                email_collection_checked = True
            except Exception as email_check_error:
                print(f"Warning: Could not check email collection: {email_check_error}")
                email_collection_enabled = True
                email_collection_checked = False
        except Exception as metadata_error:
            api_error_reason = _classify_forms_api_error(metadata_error)
            print(f"Warning: Could not fetch form metadata: {metadata_error}")
            if api_error_reason == 'account_mismatch_or_no_access':
                print("The connected Google account likely differs from the form owner's editor account.")
            print("The form request will be created, and sync will keep retrying in case this is fixed.")
            api_access_available = False
            # Use default metadata
            metadata = {
                'title': data.get('title', f"Form {form_id[:8]}"),
                'description': '',
                'email_collection_enabled': True,
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
        now = datetime.now(timezone.utc).isoformat()
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
            'api_error_reason': api_error_reason,
            # Don't set last_synced_at on creation - it will be set when first synced
            'form_settings': {
                'email_collection_enabled': email_collection_enabled,
                'email_collection_type': metadata.get('email_collection_type', 'UNKNOWN'),
                'email_collection_checked': email_collection_checked,
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
                'api_error_reason': api_error_reason,
                'form_settings': form_data['form_settings']
            })
        else:
            # Create new form document (without last_synced_at - will be set on first sync)
            form_ref.set(form_data)
        
        # Create form request document with enhanced metadata
        # IMPORTANT: Store title directly in form_request, not just in forms collection
        # This allows multiple form requests for the same form to have different titles
        form_request_data = {
            'form_id': form_doc_id,  # Reference to forms collection
            'google_form_id': form_id,
            'owner_id': user_id,
            'group_id': group_id,
            'title': data.get('title') or metadata.get('title', f"Form {form_id[:8]}"),  # Store title here!
            'form_url': form_url,  # Store form_url directly in the request
            'created_at': now,
            'status': 'Active',
            'is_active': True,
            # Reminder schedule configuration
            'due_date': due_date.isoformat(),
            'reminder_schedule': {
                'schedule_type': reminder_schedule,
                'reminder_days': reminder_days,
                'is_custom': schedule_config['is_custom'],
                'custom_days': custom_days if reminder_schedule == 'custom' else None,
                'calculated_reminder_dates': [d.isoformat() for d in reminder_dates]
            },
            'first_reminder_timing': {
                'timing_type': first_reminder_timing,
                'scheduled_date': scheduled_reminder_date.isoformat() if scheduled_reminder_date else None,
                'scheduled_time': scheduled_reminder_time.isoformat() if scheduled_reminder_time else None,
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
                'created_at': datetime.now(timezone.utc).isoformat()
            }
            db.collection(Collections.RESPONSES).add(response_data)
        
        print(f"Form request created with ID: {doc_ref.id}")
        print(f"   Title: {metadata.get('title')}")
        print(f"   Responses: {len(responses)}")
        print(f"   Email collection: {email_collection_enabled}")
        
        # ============================================================
        # SEND INITIAL EMAILS (if first_reminder_timing is 'immediate')
        # ============================================================
        # When the user selects "immediate" timing, we send out the
        # initial notification emails right now, not waiting for scheduler
        # ============================================================
        initial_email_result = None
        if first_reminder_timing == 'immediate':
            print(f"\n📨 First reminder timing is 'immediate' - sending initial emails now...")
            form_title_for_email = data.get('title') or metadata.get('title', 'Untitled Form')
            initial_email_result = send_initial_emails(
                request_id=doc_ref.id,
                owner_id=user_id,
                form_title=form_title_for_email,
                form_url=form_url,
                group_id=group_id
            )
            print(f"   Initial email result: {initial_email_result}")
        else:
            print(f"   First reminder timing: {first_reminder_timing} (not immediate, skipping initial send)")
        
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
@form_requests_bp.put("/<request_id>")
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
            'updated_at': datetime.now(timezone.utc).isoformat()
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
                    updates['due_date'] = final_due_date_obj.isoformat()
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
                'calculated_reminder_dates': [d.isoformat() for d in reminder_dates]
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

@form_requests_bp.post("/custom-schedule")
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


@form_requests_bp.delete("/<request_id>")
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


# Add unrecognized email to the form request's group
@form_requests_bp.post("/<request_id>/add-email-to-group")
def add_email_to_group(request_id: str):
    """Add an unrecognized email to the form request's group"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        data = request.get_json()
        email = data.get('email', '').strip().lower()
        
        if not email:
            return jsonify({"error": "Email is required"}), 400
        
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
        
        # Get the group
        group_id = request_data.get('group_id')
        if not group_id:
            return jsonify({"error": "This form request has no group attached"}), 400
        
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Check if email already in group
        existing_emails = {m['email'].lower() for m in group.members}
        if email in existing_emails:
            return jsonify({"error": "Email is already in the group"}), 400
        
        # Add the email to the group
        success = group.add_member(email)
        
        if success:
            print(f"Added {email} to group {group.name}")
            return jsonify({
                "success": True,
                "message": f"Added {email} to {group.name}",
                "group_id": group_id,
                "group_name": group.name
            }), 200
        else:
            return jsonify({"error": "Failed to add email to group"}), 500
            
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error adding email to group: {error_msg}")
        return jsonify({
            "error": "Failed to add email to group",
            "details": error_msg
        }), 500


# ============================================================
# DUPLICATION HELPERS - Factored for reusability
# ============================================================

def _generate_copy_name(original_name: str) -> str:
    """Generate a copy name by appending (Copy N) to the original name"""
    import re
    # Check if the name already ends with (Copy N)
    match = re.search(r'\(Copy\s*(\d+)\)\s*$', original_name)
    if match:
        # Increment the copy number
        copy_num = int(match.group(1)) + 1
        return re.sub(r'\(Copy\s*\d+\)\s*$', f'(Copy {copy_num})', original_name)
    else:
        return f"{original_name} (Copy 1)"


def _duplicate_form_request(request_id: str, user_id: str) -> tuple:
    """
    Duplicate a form request including its responses.
    Returns (new_request_data, error_message).
    If successful, error_message is None. If failed, new_request_data is None.
    """
    db = get_db()
    
    # Get the original form request
    request_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
    request_doc = request_ref.get()
    
    if not request_doc.exists:
        return None, "Form request not found"
    
    request_data = request_doc.to_dict()
    
    # Verify ownership
    if request_data.get('owner_id') != user_id:
        return None, "Unauthorized"
    
    # Generate new title with (Copy N)
    original_title = request_data.get('title', 'Untitled Form')
    new_title = _generate_copy_name(original_title)
    
    # Create the new form request with same settings
    now = datetime.now(timezone.utc).isoformat()
    new_request_data = {
        'form_id': request_data.get('form_id'),
        'google_form_id': request_data.get('google_form_id'),
        'owner_id': user_id,
        'group_id': request_data.get('group_id'),
        'title': new_title,
        'form_url': request_data.get('form_url'),
        'created_at': now,
        'status': 'Active',
        'is_active': True,
        'due_date': request_data.get('due_date'),
        'reminder_schedule': request_data.get('reminder_schedule'),
        'first_reminder_timing': request_data.get('first_reminder_timing')
    }
    
    # Add to form_requests collection
    doc_ref = db.collection(Collections.FORM_REQUESTS).document()
    doc_ref.set(new_request_data)
    new_request_id = doc_ref.id
    
    # Copy all responses from the original request to the new request
    original_responses = db.collection(Collections.RESPONSES)\
        .where('request_id', '==', request_id)\
        .stream()
    
    response_count = 0
    for response in original_responses:
        response_data = response.to_dict()
        # Create a copy with the new request_id
        new_response_data = {
            **response_data,
            'request_id': new_request_id,
            'created_at': now  # Update created_at for the copy
        }
        db.collection(Collections.RESPONSES).add(new_response_data)
        response_count += 1
    
    print(f"Form request duplicated: {request_id} -> {new_request_id}")
    print(f"   Original title: {original_title}")
    print(f"   New title: {new_title}")
    print(f"   Responses copied: {response_count}")
    
    return {
        'id': new_request_id,
        **new_request_data
    }, None


@form_requests_bp.post("/<request_id>/duplicate")
def duplicate_form_request(request_id: str):
    """Duplicate a form request with (Copy N) appended to the name"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        new_request, error = _duplicate_form_request(request_id, user_id)
        
        if error:
            status = 404 if error == "Form request not found" else 403
            return jsonify({"error": error}), status
        
        return jsonify({
            "success": True,
            "message": f"Form request duplicated as '{new_request['title']}'",
            "form_request": new_request
        }), 201
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error duplicating form request: {error_msg}")
        return jsonify({
            "error": "Failed to duplicate form request",
            "details": error_msg
        }), 500