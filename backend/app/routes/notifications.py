# Notification Routes
# API endpoints for managing user notifications

from flask import Blueprint, jsonify, request, session
from models.notification import Notification

notifications_bp = Blueprint('notifications', __name__)


def get_current_user_id():
    """Helper to get current user ID from session"""
    return session.get('user_id')


@notifications_bp.get('/api/notifications')
def get_notifications():
    """Get all notifications for the current user"""
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Optional query param to filter only unread
    include_read = request.args.get('include_read', 'true').lower() == 'true'
    limit = int(request.args.get('limit', 50))
    
    notifications = Notification.get_for_user(user_id, limit=limit, include_read=include_read)
    
    return jsonify({
        'notifications': [n.to_dict() for n in notifications],
        'count': len(notifications)
    }), 200


@notifications_bp.get('/api/notifications/unread-count')
def get_unread_count():
    """Get count of unread notifications for the bell badge"""
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({'error': 'Not authenticated'}), 401
    
    count = Notification.get_unread_count(user_id)
    
    return jsonify({'unread_count': count}), 200


@notifications_bp.put('/api/notifications/<notification_id>/read')
def mark_notification_read(notification_id):
    """Mark a single notification as read"""
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({'error': 'Not authenticated'}), 401
    
    success = Notification.mark_as_read(notification_id)
    
    if success:
        return jsonify({'success': True, 'message': 'Notification marked as read'}), 200
    else:
        return jsonify({'error': 'Failed to mark notification as read'}), 500


@notifications_bp.put('/api/notifications/mark-all-read')
def mark_all_read():
    """Mark all notifications as read for the current user"""
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({'error': 'Not authenticated'}), 401
    
    success = Notification.mark_all_as_read(user_id)
    
    if success:
        return jsonify({'success': True, 'message': 'All notifications marked as read'}), 200
    else:
        return jsonify({'error': 'Failed to mark notifications as read'}), 500


@notifications_bp.delete('/api/notifications/<notification_id>')
def delete_notification(notification_id):
    """Delete a notification"""
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({'error': 'Not authenticated'}), 401
    
    success = Notification.delete(notification_id)
    
    if success:
        return jsonify({'success': True, 'message': 'Notification deleted'}), 200
    else:
        return jsonify({'error': 'Failed to delete notification'}), 500
