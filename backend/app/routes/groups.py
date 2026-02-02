from flask import Blueprint, request, jsonify, session
from datetime import datetime
import traceback

# Import your models and database tools
# Adjust these imports if your file structure is different
from models.group import Group
from models.org_membership import OrgMembership
from models.database import get_db, Collections

# Define the Blueprint
groups_bp = Blueprint('groups', __name__)

# ============= GROUPS ROUTES =============

@groups_bp.post("/api/groups")
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


@groups_bp.get("/api/groups")
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


@groups_bp.get("/api/groups/<group_id>")
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


@groups_bp.post("/api/groups/<group_id>/members")
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
            else:
                allowed_emails.append(e)
        
        print(f"Adding {len(emails)} emails to group {group_id}")
        
        # Add members
        added_count = group.add_members(allowed_emails)
        
        return jsonify({
            "success": True,
            "message": f"Added {added_count} new members",
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


@groups_bp.delete("/api/groups/<group_id>/members/<email>")
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


@groups_bp.get("/api/groups/join/<invite_token>")
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


@groups_bp.post("/api/groups/join/<invite_token>")
def join_group(invite_token: str):
    """PUBLIC: Join a group via invite link (no auth required)"""
    try:
        data = request.get_json()
        if not data or 'email' not in data:
            return jsonify({"error": "Email is required"}), 400
        
        email = data['email'].strip()
        
        # Validate email format
        if not Group.validate_email(email):
            return jsonify({"error": "Invalid email format"}), 400
        
        print(f"User {email} joining group via token: {invite_token}")
        
        # Get group
        group = Group.get_by_invite_token(invite_token)
        if not group:
            return jsonify({"error": "Invalid invite link"}), 404

        # Joining via invite link is an explicit opt-in; re-activate org membership if previously left.
        OrgMembership.ensure_active(group.owner_id, email, source="invite_join")
        
        # Add member
        success = group.add_member(email)
        
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
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error joining group: {error_msg}")
        return jsonify({
            "error": "Failed to join group",
            "details": error_msg
        }), 500

@groups_bp.put("/api/groups/<group_id>")
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