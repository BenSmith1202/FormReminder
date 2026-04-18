from flask import Blueprint, request, jsonify, session
from datetime import datetime
import traceback
import random

# Import your models and database tools
# Adjust these imports if your file structure is different
from models.group import Group
from models.org_membership import OrgMembership
from models.opt_out_event import OptOutEvent
from models.database import get_db, Collections
from utils.email_service import EmailService, _get_api_config

# Define the Blueprint
groups_bp = Blueprint('groups', __name__)

# ============= GROUPS ROUTES =============

@groups_bp.post("")
def create_group():
    """Create a new group"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({"error": "Group name is required"}), 400
        
        name = data['name'].strip()
        description = data.get('description', '').strip()
        
        if not name:
            return jsonify({"error": "Group name cannot be empty"}), 400
        
        print(f"Creating group: {name} for user {user_id}")
        
        group = Group.create_group(
            name=name,
            description=description,
            owner_id=user_id
        )
        
        if not group:
            return jsonify({"error": "Failed to create group"}), 500
        
        return jsonify({
            "success": True,
            "message": "Group created successfully",
            "group": group.to_dict()
        }), 201
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error creating group: {error_msg}")
        return jsonify({
            "error": "Failed to create group",
            "details": error_msg
        }), 500


@groups_bp.get("")
def get_user_groups():
    """Get all groups owned by the current user"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        print(f"Fetching groups for user: {user_id}")
        
        groups = Group.get_user_groups(user_id)
        
        groups_list = [group.to_dict() for group in groups]
        
        print(f"Found {len(groups_list)} groups")
        
        return jsonify({
            "groups": groups_list,
            "count": len(groups_list)
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error fetching groups: {error_msg}")
        return jsonify({
            "error": "Failed to fetch groups",
            "details": error_msg
        }), 500


@groups_bp.get("/<group_id>")
def get_group(group_id: str):
    """Get a specific group with all members"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        group = Group.get_by_id(group_id)
        
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Verify ownership
        if group.owner_id != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        return jsonify({
            "group": group.to_dict()
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error fetching group: {error_msg}")
        return jsonify({
            "error": "Failed to fetch group",
            "details": error_msg
        }), 500


@groups_bp.post("/<group_id>/members")
def add_group_members(group_id: str):
    """Add members to a group (bulk email paste)"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        data = request.get_json()
        if not data or 'emails' not in data:
            return jsonify({"error": "Emails are required"}), 400
        
        emails_text = data['emails']
        
        # Get group
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Verify ownership
        if group.owner_id != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Parse emails from text
        emails = Group.parse_emails(emails_text)
        
        if not emails:
            return jsonify({"error": "No valid emails found"}), 400

        # Respect org-level opt-out: owners cannot re-add opted-out recipients by accident.
        opted_out = []
        allowed_emails = []
        for e in emails:
            if OrgMembership.is_opted_out(user_id, e):
                opted_out.append(e)
                print(f"  Skipping opted-out email: {e}")
            else:
                allowed_emails.append(e)
        
        print(f"Adding {len(allowed_emails)} emails to group {group_id} ({len(opted_out)} opted-out)")
        
        # If ALL emails were opted out, return a clear error
        if not allowed_emails and opted_out:
            opted_out_list = ', '.join(opted_out)
            return jsonify({
                "error": f"Cannot add opted-out members",
                "message": f"The following email(s) have opted out of your organization: {opted_out_list}. They can only rejoin via an invite link.",
                "skipped_opted_out": opted_out
            }), 400
        
        # Add members
        added_count = group.add_members(allowed_emails)
        
        # Build response message
        message = f"Added {added_count} new members"
        if opted_out:
            opted_out_list = ', '.join(opted_out)
            message += f". Skipped {len(opted_out)} opted-out email(s): {opted_out_list} (they can only rejoin via invite link)"
        
        return jsonify({
            "success": True,
            "message": message,
            "added_count": added_count,
            "total_members": len(group.members),
            "skipped": len(emails) - added_count,  # Duplicates + opted-out
            "skipped_opted_out": opted_out
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error adding members: {error_msg}")
        return jsonify({
            "error": "Failed to add members",
            "details": error_msg
        }), 500


@groups_bp.delete("/<group_id>/members/<email>")
def remove_group_member(group_id: str, email: str):
    """Remove a member from a group"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        print(f"Removing member {email} from group {group_id}")
        
        # Get group
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Verify ownership
        if group.owner_id != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Remove member
        success = group.remove_member(email)
        
        if not success:
            return jsonify({"error": "Member not found"}), 404

        try:
            OptOutEvent.log(
                group.owner_id, email, "left_group", "owner", "owner_dashboard",
                group_id=group_id, group_name=group.name,
            )
        except Exception:
            pass

        return jsonify({
            "success": True,
            "message": f"Removed {email}",
            "total_members": len(group.members)
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error removing member: {error_msg}")
        return jsonify({
            "error": "Failed to remove member",
            "details": error_msg
        }), 500


@groups_bp.get("/join/<invite_token>")
def get_group_by_token(invite_token: str):
    """PUBLIC: Get group info by invite token (for join page)"""
    try:
        print(f"Getting group info for token: {invite_token}")
        
        group = Group.get_by_invite_token(invite_token)
        
        if not group:
            return jsonify({"error": "Invalid invite link"}), 404
        
        # Return limited info (no members list, just group details)
        return jsonify({
            "group": {
                "id": group.id,
                "name": group.name,
                "description": group.description,
                "member_count": len(group.members)
            }
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error getting group by token: {error_msg}")
        return jsonify({
            "error": "Failed to get group info",
            "details": error_msg
        }), 500


@groups_bp.post("/join/<invite_token>")
def join_group(invite_token: str):
    """PUBLIC: Join a group via invite link with 2-step verification"""
    try:
        data = request.get_json()
        email = data.get('email', '').strip()
        user_code = data.get('code') # The 6-digit number from the user

        if not email or not Group.validate_email(email):
            return jsonify({"error": "Valid email is required"}), 400

        # Step 1: Requesting a verification code
        if not user_code:
            # Generate a 6-digit code
            verification_code = f"{random.randint(100000, 999999)}"
            
            # Store in session (expires when browser closes or session cleared)
            session['verify_email'] = email.lower()
            session['verify_code'] = verification_code
            session['verify_token'] = invite_token
            
            # Send the email using your existing send_email logic
            subject = "Your FormReminder Verification Code"
            html_content = f"""
                <h2>Verify your email</h2>
                <p>You requested to join a group on FormReminder. Use the code below to verify your email:</p>
                <h1 style="letter-spacing: 5px;">{verification_code}</h1>
                <p>This code will expire shortly.</p>
            """
            EmailService.send_email(email, subject, html_content) 

            return jsonify({
                "success": True, 
                "needs_verification": True,
                "message": "Verification code sent to your email."
            }), 200

        # Step 2: Verifying the code
        stored_code = session.get('verify_code')
        stored_email = session.get('verify_email')
        stored_token = session.get('verify_token')

        if not stored_code or user_code != stored_code or email.lower() != stored_email or invite_token != stored_token:
            return jsonify({"error": "Invalid or expired verification code"}), 400

        # Code is valid - Proceed with joining
        group = Group.get_by_invite_token(invite_token)
        if not group:
            return jsonify({"error": "Invalid invite link"}), 404

        # Joining via invite link is an explicit opt-in; re-activate org membership if previously left.
        OrgMembership.ensure_active(group.owner_id, email, source="invite_join")
        
        # Add member
        success = group.add_member(email)

         # Clear session after success
        session.pop('verify_code', None)
        session.pop('verify_email', None)
        
        if not success:
            # Check if already a member
            existing_emails = {member['email'].lower() for member in group.members}
            if email.lower() in existing_emails:
                return jsonify({
                    "success": True,
                    "message": "You're already a member of this group!",
                    "already_member": True
                }), 200
            else:
                return jsonify({"error": "Failed to join group"}), 500
        
        return jsonify({
            "success": True,
            "message": f"Successfully joined {group.name}!",
            "group_name": group.name
        }), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "Failed to process request", "details": str(e)}), 500

@groups_bp.put("/<group_id>")
def update_group(group_id):
    """Update group details (name and description)"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
            
        name = data.get('name')
        description = data.get('description')
        
        if not name:
            return jsonify({"error": "Group name is required"}), 400
            
        # Get existing group
        group = Group.get_by_id(group_id)
        if not group:
            return jsonify({"error": "Group not found"}), 404
            
        # Verify ownership
        if group.owner_id != user_id:
            return jsonify({"error": "Unauthorized"}), 403
            
        # Update details using the method added to the model
        # Ensure your Group model has the update_details method or use the db logic directly:
        from models.database import get_db, Collections
        from datetime import datetime
        
        db = get_db()
        group_ref = db.collection(Collections.GROUPS).document(group_id)
        
        updates = {
            'name': name,
            'description': description,
            'updated_at': datetime.utcnow().isoformat() + 'Z'
        }
        
        group_ref.update(updates)
        
        # Return updated group
        # We can update the local object to return it, or just return the updates
        group.name = name
        group.description = description
        
        return jsonify({
            "success": True,
            "message": "Group updated successfully",
            "group": group.to_dict()
        }), 200
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            "error": "Failed to update group", 
            "details": str(e)
        }), 500
    
@groups_bp.delete("/<group_id>")
def delete_group(group_id: str):
    """Delete a group and all its members"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        print(f"Request to delete group {group_id} by user {user_id}")
        
        # Get group
        group = Group.get_by_id(group_id)
        
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Verify ownership
        if group.owner_id != user_id:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Delete the group
        # Ensure your Group model has a delete() method. 
        # If not, use the database logic directly:
        from models.database import get_db, Collections
        
        db = get_db()
        
        # Optional: You might want to delete all form requests associated with this group first,
        # or handle that relationship in your application logic.
        
        # Delete the group document
        db.collection(Collections.GROUPS).document(group_id).delete()
        
        return jsonify({
            "success": True,
            "message": f"Group '{group.name}' deleted successfully",
            "id": group_id
        }), 200
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error deleting group: {error_msg}")
        return jsonify({
            "error": "Failed to delete group",
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


def _duplicate_group(group_id: str, user_id: str) -> tuple:
    """
    Duplicate a group with all its members.
    Returns (new_group_data, error_message).
    If successful, error_message is None. If failed, new_group_data is None.
    """
    import uuid
    from models.database import get_db, Collections
    
    db = get_db()
    
    # Get the original group
    original_group = Group.get_by_id(group_id)
    
    if not original_group:
        return None, "Group not found"
    
    # Verify ownership
    if original_group.owner_id != user_id:
        return None, "Unauthorized"
    
    # Generate new name with (Copy N)
    new_name = _generate_copy_name(original_group.name)
    
    # Generate new invite token
    new_invite_token = str(uuid.uuid4())
    
    # Create the new group with same members
    now = datetime.utcnow().isoformat() + 'Z'
    new_group_data = {
        'name': new_name,
        'description': original_group.description,
        'owner_id': user_id,
        'invite_token': new_invite_token,
        'members': original_group.members.copy(),  # Copy all members
        'created_at': now,
        'updated_at': now
    }
    
    # Add to groups collection
    doc_ref = db.collection(Collections.GROUPS).document()
    doc_ref.set(new_group_data)
    
    print(f"Group duplicated: {group_id} -> {doc_ref.id}")
    print(f"   Original name: {original_group.name}")
    print(f"   New name: {new_name}")
    print(f"   Members copied: {len(original_group.members)}")
    
    return {
        'id': doc_ref.id,
        **new_group_data,
        'member_count': len(new_group_data['members'])
    }, None


@groups_bp.post("/<group_id>/duplicate")
def duplicate_group(group_id: str):
    """Duplicate a group with all its members, with (Copy N) appended to the name"""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Must be logged in"}), 401
        
        new_group, error = _duplicate_group(group_id, user_id)
        
        if error:
            status = 404 if error == "Group not found" else 403
            return jsonify({"error": error}), status
        
        return jsonify({
            "success": True,
            "message": f"Group duplicated as '{new_group['name']}'",
            "group": new_group
        }), 201
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error duplicating group: {error_msg}")
        return jsonify({
            "error": "Failed to duplicate group",
            "details": error_msg
        }), 500