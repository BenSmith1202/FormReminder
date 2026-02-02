from flask import Blueprint, request, jsonify, session
from datetime import datetime
import traceback

# Import your models and database tools
from models.group import Group
from models.org_membership import OrgMembership
from models.database import get_db, Collections
from utils.email_service import EmailService


# Define the Blueprint
email_bp = Blueprint('email', __name__)



@email_bp.post("/api/form-requests/<request_id>/send-reminder/<email>")
def send_single_reminder(request_id: str, email: str):
    """Send a reminder email to a single recipient"""
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
        
        # Get form info
        form_title = request_data.get('title', 'Untitled Form')
        form_url = request_data.get('form_url')
        
        print(f"Sending reminder to {email} for form: {form_title}")

        # Respect org-level opt-out
        if OrgMembership.is_opted_out(user_id, email):
            return jsonify({"success": False, "error": "Recipient has opted out of this organization"}), 400
        
        # Send reminder
        result = EmailService.send_reminder(request_id, form_title, form_url, email, owner_id=user_id)
        
        if result['success']:
            return jsonify(result), 200
        else:
            return jsonify(result), 400
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error sending reminder: {error_msg}")
        return jsonify({
            "error": "Failed to send reminder",
            "details": error_msg
        }), 500


@email_bp.post("/api/form-requests/<request_id>/send-reminders")
def send_bulk_reminders(request_id: str):
    """Send reminders to all non-responders (excluding recently sent)"""
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
        
        # Get form info
        form_title = request_data.get('title', 'Untitled Form')
        form_url = request_data.get('form_url')
        group_id = request_data.get('group_id')
        
        if not group_id:
            return jsonify({"error": "No group attached to this form request"}), 400
        
        # Get group and member status
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Get responses to determine who hasn't responded
        responses = db.collection(Collections.RESPONSES)\
            .where('request_id', '==', request_id)\
            .stream()
        
        responded_emails = set()
        for response in responses:
            response_data = response.to_dict()
            email_lower = response_data.get('respondent_email', '').lower()
            if email_lower:
                responded_emails.add(email_lower)
        
        # Find non-responders
        non_responders = []
        opted_out = []
        for member in group.members:
            member_email = member['email']
            member_email_lower = member_email.lower()
            if member_email_lower in responded_emails:
                continue

            # Respect org-level opt-out
            if OrgMembership.is_opted_out(user_id, member_email):
                opted_out.append(member_email)
                continue

            non_responders.append(member_email)
        
        print(f"Found {len(non_responders)} non-responders out of {len(group.members)} members")
        
        if not non_responders:
            return jsonify({
                "success": True,
                "message": "All members have already responded!",
                "sent": 0,
                "skipped": 0,
                "failed": 0
            }), 200
        
        # Send reminders (respecting rate limits)
        sent = 0
        skipped = 0
        failed = 0
        
        for recipient_email in non_responders:
            result = EmailService.send_reminder(
                request_id,
                form_title,
                form_url,
                recipient_email,
                owner_id=user_id,
            )
            
            if result['success']:
                sent += 1
            elif 'Rate limit' in result.get('error', ''):
                skipped += 1
            else:
                failed += 1
        
        print(f"Bulk reminders complete: {sent} sent, {skipped} skipped (rate limit), {failed} failed")
        
        return jsonify({
            "success": True,
            "message": f"Sent {sent} reminders",
            "sent": sent,
            "skipped": skipped,
            "failed": failed,
            "total_non_responders": len(non_responders),
            "skipped_opted_out": len(opted_out)
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error sending bulk reminders: {error_msg}")
        return jsonify({
            "error": "Failed to send reminders",
            "details": error_msg
        }), 500