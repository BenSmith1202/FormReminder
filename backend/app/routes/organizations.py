from flask import Blueprint, request, jsonify, session
from datetime import datetime
import traceback
from models.org_member import OrgMember
from models.user import User

# Import your models and database tools
# Adjust these imports if your file structure is different
from .utilities import create_notification

from models.group import Group
from models.org_membership import OrgMembership
from models.opt_out_event import OptOutEvent
from utils.email_service import EmailService


# Define the Blueprint
orgs_bp = Blueprint('organizations', __name__)


@orgs_bp.route("/api/organizations/<owner_id>/leave", methods=["GET", "POST"])
def leave_organization(owner_id: str):
    """
    PUBLIC: Recipient opt-out endpoint.

    A recipient "leaving an organization" means:
    - mark org membership as left (global suppression for future emails)
    - remove the recipient from all groups owned by this org
    - notify the org owner/admin
    """
    try:
        # Support both email link clicks (GET query params) and JSON (POST).
        email = (request.args.get("email") or "").strip()
        token = (request.args.get("token") or "").strip()

        if request.method == "POST":
            body = request.get_json(silent=True) or {}
            email = (body.get("email") or email).strip()
            token = (body.get("token") or token).strip()

        if not email or not token:
            return jsonify({"error": "email and token are required"}), 400

        if not EmailService.verify_unsubscribe_token(owner_id, email, token):
            return jsonify({"error": "Invalid or expired token"}), 403

        # Mark opted out first (so even partial failures still suppress future emails).
        OrgMembership.mark_left(owner_id, email, reason="opt_out", source="recipient_leave_link")
        try:
            OptOutEvent.log(owner_id, email, "opted_out", "recipient", "email_link")
        except Exception:
            pass

        # Remove from all groups in this org (owner == org).
        removed_from_groups = 0
        groups = Group.get_user_groups(owner_id)
        for g in groups:
            try:
                if g.remove_member(email):
                    removed_from_groups += 1
            except Exception:
                # Continue best-effort; membership suppression already recorded.
                pass

        # Notify org owner/admin (in-app notification record).
        create_notification(
            owner_id=owner_id,
            notif_type="member_opted_out",
            message=f"{email} has opted out of your reminders",
            data={"email": email, "removed_from_groups": removed_from_groups},
        )

        # Return a friendly page for email link clicks.
        if request.method == "GET":
            return (
                f"""
                <html>
                  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding: 32px;">
                    <h2>You're opted out</h2>
                    <p><strong>{email}</strong> has left this organization and will no longer receive emails from it.</p>
                    <p>You may close this tab.</p>
                  </body>
                </html>
                """,
                200,
                {"Content-Type": "text/html; charset=utf-8"},
            )

        return jsonify({"success": True, "message": "Opted out successfully"}), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to opt out", "details": str(e)}), 500

@orgs_bp.route("/api/my-memberships", methods=["GET"])
def get_my_memberships():
    """Returns a list of organizations the current logged-in user belongs to."""
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401

        # Get active memberships
        memberships = OrgMember.get_user_memberships(user_id)
        
        results = []
        for m in memberships:
            # Fetch the Org Owner's name so the UI is friendly
            owner = User.get_by_id(m.org_id)
            owner_name = owner.username if owner else "Unknown Organization"
            
            results.append({
                "membership_id": m.id,
                "org_id": m.org_id,
                "org_name": owner_name,
                "role": m.role,
                "joined_at": m.joined_at
            })

        return jsonify(results), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@orgs_bp.route("/api/memberships/<membership_id>/leave", methods=["POST"])
def leave_org_as_member(membership_id: str):
    """Allows a sub-user to leave an organization they are a member of."""
    try:
        user_id = session.get('user_id')
        member = OrgMember.get_by_id(membership_id)

        if not member or member.member_user_id != user_id:
            return jsonify({"error": "Membership not found or unauthorized"}), 404

        if member.remove():
            return jsonify({"success": True, "message": "Left organization"}), 200
        
        return jsonify({"error": "Failed to remove membership"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500