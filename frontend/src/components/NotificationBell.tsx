import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconButton,
  Badge,
  Menu,
  MenuItem,
  Typography,
  Box,
  Divider,
  Button,
  CircularProgress
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import DescriptionIcon from '@mui/icons-material/Description';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import API_URL from '../config';

// Notification type constants (match backend)
const NotificationType = {
  FORM_COMPLETED: 'form_completed',
  FORM_SUBMISSION: 'form_submission',
  FORM_OVERDUE: 'form_overdue',
  MEMBER_OPTED_OUT: 'member_opted_out',
  UNRECOGNIZED_SUBMISSION: 'unrecognized_submission'
};

interface Notification {
  id: string;
  user_id: string;
  type: string;
  message: string;
  form_reminder_id: string | null;
  is_read: boolean;
  created_at: string;
  metadata: Record<string, string>;
}

// Returns appropriate icon based on notification type
function getNotificationIcon(type: string) {
  switch (type) {
    case NotificationType.FORM_COMPLETED:
      return <CheckCircleIcon color="success" fontSize="small" />;
    case NotificationType.FORM_SUBMISSION:
      return <DescriptionIcon color="primary" fontSize="small" />;
    case NotificationType.FORM_OVERDUE:
      return <WarningIcon color="error" fontSize="small" />;
    case NotificationType.MEMBER_OPTED_OUT:
      return <PersonOffIcon color="warning" fontSize="small" />;
    case NotificationType.UNRECOGNIZED_SUBMISSION:
      // Yellow question mark for unknown email submissions
      return <HelpOutlineIcon sx={{ color: '#ed6c02' }} fontSize="small" />;
    default:
      return <NotificationsIcon fontSize="small" />;
  }
}

// Formats timestamp to relative time (e.g., "5 minutes ago")
function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hr ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

interface NotificationBellProps {
  pollInterval?: number; // How often to check for new notifications (ms)
}

export default function NotificationBell({ pollInterval = 30000 }: NotificationBellProps) {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const open = Boolean(anchorEl);

  // Fetch unread count for badge
  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/notifications/unread-count`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.unread_count);
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  }, []);

  // Fetch all notifications when dropdown opens
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/notifications?limit=20`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll for unread count
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, pollInterval);
    return () => clearInterval(interval);
  }, [fetchUnreadCount, pollInterval]);

  // Handle bell click - open dropdown
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    fetchNotifications();
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  // Handle notification click - navigate and mark as read
  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read
    if (!notification.is_read) {
      try {
        await fetch(`${API_URL}/api/notifications/${notification.id}/read`, {
          method: 'PUT',
          credentials: 'include'
        });
        // Update local state
        setNotifications(prev =>
          prev.map(n => n.id === notification.id ? { ...n, is_read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
      }
    }

    handleClose();

    // Navigate to the form reminder if one is linked
    if (notification.form_reminder_id) {
      navigate(`/requests/${notification.form_reminder_id}`);
    }
  };

  // Mark all as read
  const handleMarkAllRead = async () => {
    try {
      await fetch(`${API_URL}/api/notifications/mark-all-read`, {
        method: 'PUT',
        credentials: 'include'
      });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  return (
    <>
      <IconButton
        color="inherit"
        onClick={handleClick}
        aria-label={`${unreadCount} unread notifications`}
      >
        <Badge badgeContent={unreadCount} color="error" max={99}>
          <NotificationsIcon />
        </Badge>
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          sx: {
            width: 360,
            maxHeight: 480
          }
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        {/* Header */}
        <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Notifications
          </Typography>
          {unreadCount > 0 && (
            <Button size="small" onClick={handleMarkAllRead}>
              Mark all read
            </Button>
          )}
        </Box>
        <Divider />

        {/* Loading state */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {/* Empty state */}
        {!loading && notifications.length === 0 && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <NotificationsIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography color="textSecondary">
              No notifications yet
            </Typography>
          </Box>
        )}

        {/* Notification list */}
        {!loading && notifications.map((notification) => (
          <MenuItem
            key={notification.id}
            onClick={() => handleNotificationClick(notification)}
            sx={{
              py: 1.5,
              px: 2,
              // Unread: light background, Read: slightly darker shade
              backgroundColor: notification.is_read ? 'grey.100' : 'background.paper',
              '&:hover': {
                backgroundColor: notification.is_read ? 'grey.200' : 'action.hover'
              }
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 1.5 }}>
              <Box sx={{ mt: 0.5 }}>
                {getNotificationIcon(notification.type)}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: notification.is_read ? 400 : 600,
                    wordBreak: 'break-word'
                  }}
                >
                  {notification.message}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {formatTimeAgo(notification.created_at)}
                </Typography>
              </Box>
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
