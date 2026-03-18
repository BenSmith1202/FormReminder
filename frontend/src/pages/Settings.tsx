import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Alert,
  CircularProgress,
  TextField,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Switch,
  Paper,
  Button,
  Avatar,
  Skeleton,
  Collapse,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import LockIcon from '@mui/icons-material/Lock';
import GroupIcon from '@mui/icons-material/Group';
import NotificationsIcon from '@mui/icons-material/Notifications';
import MessageIcon from '@mui/icons-material/Message';
import PersonIcon from '@mui/icons-material/Person';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import API_URL from '../config';

// ── Shared section wrapper ────────────────────────────────────────────────
function Section({
  icon,
  title,
  description,
  iconBg = 'primary.50',
  iconColor = 'primary.main',
  children,
  danger = false,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: string;
  iconBg?: string;
  iconColor?: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid',
        borderColor: danger ? 'error.light' : 'divider',
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        display="flex"
        alignItems="center"
        gap={2}
        px={{ xs: 2.5, sm: 3 }}
        py={2.5}
        sx={{ borderBottom: '1px solid', borderColor: danger ? 'error.light' : 'divider', bgcolor: danger ? '#fff8f8' : 'grey.50' }}
      >
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2,
            bgcolor: danger ? 'error.50' : iconBg,
            color: danger ? 'error.main' : iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="subtitle1" fontWeight="bold" color={danger ? 'error.main' : 'text.primary'}>
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Body */}
      <Box>{children}</Box>
    </Paper>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [user, setUser] = useState<any>(null);
  const [formRequests, setFormRequests] = useState<any[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [customMessage, setCustomMessage] = useState('');
  const [customMessageLoading, setCustomMessageLoading] = useState(false);
  const [customMessageSaved, setCustomMessageSaved] = useState(true);

  // ── Auth & data loading ──
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch(`${API_URL}/api/current-user`, { credentials: 'include' });
        const data = await response.json();
        if (data.authenticated) {
          setUser(data.user);
          setCustomMessage(data.user.email_custom_message || '');
        } else {
          navigate('/login');
        }
      } catch {
        navigate('/login');
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, [navigate]);

  useEffect(() => {
    const fetchUserForms = async () => {
      if (!user?.id) return;
      try {
        const response = await fetch(`${API_URL}/api/form-requests`, {
          credentials: 'include',
        });
        const data = await response.json();
        if (response.ok) setFormRequests(data);
      } catch { /* silent */ }
    };
    fetchUserForms();
  }, [user]);

  useEffect(() => {
    const fetchMemberships = async () => {
      if (!user?.id) return;
      try {
        const response = await fetch(`${API_URL}/api/my-memberships`, {
          credentials: 'include',
        });
        const data = await response.json();
        if (response.ok) setMemberships(data);
      } catch { /* silent */ }
    };
    fetchMemberships();
  }, [user]);

  // ── Actions ──
  const resetPassword = async () => {
    setError('');
    setSuccess('');
    setActionLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });
      const data = await response.json();
      if (response.ok) {
        setSuccess(`A password reset link has been sent to ${user.email}`);
      } else {
        setError(data.error || 'Failed to send reset email');
      }
    } catch {
      setError('Server connection failed');
    } finally {
      setActionLoading(false);
    }
  };

  const saveCustomMessage = async () => {
    setCustomMessageLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`${API_URL}/api/settings/custom-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ custom_message: customMessage }),
      });
      if (response.ok) {
        setSuccess('Custom message saved!');
        setCustomMessageSaved(true);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to save message');
      }
    } catch {
      setError('Connection failed.');
    } finally {
      setCustomMessageLoading(false);
    }
  };

  const editUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setActionLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/edit_username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user, newUsername }),
      });
      if (response.ok) {
        setSuccess('Username updated successfully!');
        setNewUsername('');
      } else {
        setError('Failed to update username.');
      }
    } catch {
      setError('Connection failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setActionLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user, password: deletePassword }),
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.removeItem('user');
        navigate('/login');
      } else {
        setError(data.error || 'Deletion failed. Check your password.');
      }
    } catch {
      setError('Connection failed. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleNotification = async (formId: string, enabled: boolean) => {
    setActionLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/settings/toggle-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          form_id: formId,
          enabled: enabled 
        }),
      });
      if (response.ok) {
        setFormRequests((prev) =>
          prev.map((f) => (f.id === formId ? { ...f, notificationsEnabled: enabled } : f))
        );
      } else {
        setError('Could not update notification.');
      }
    } catch {
      setError('Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeaveOrg = async (membershipId: string) => {
    if (!window.confirm("Are you sure you want to leave this organization?")) return;
    
    setActionLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/memberships/${membershipId}/leave`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        setMemberships((prev) => prev.filter((m) => m.membership_id !== membershipId));
        setSuccess("You have successfully left the organization.");
      } else {
        setError("Failed to leave organization.");
      }
    } catch {
      setError("Connection error.");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Loading skeleton ──
  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Skeleton variant="rectangular" height={60} sx={{ borderRadius: 2, mb: 4 }} />
        {[200, 120, 160, 140, 80].map((h, i) => (
          <Skeleton key={i} variant="rectangular" height={h} sx={{ borderRadius: 3, mb: 3 }} />
        ))}
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }} className="page-fade-in">
      {/* ── Page header ── */}
      <Box mb={4}>
        {/* User identity card */}
        <Box
          display="flex"
          alignItems="center"
          gap={2}
          p={2.5}
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 3,
            bgcolor: 'background.paper',
            background: 'linear-gradient(135deg, #f0f4ff 0%, #ffffff 60%)',
          }}
        >
          <Avatar
            sx={{
              width: 52,
              height: 52,
              bgcolor: 'primary.main',
              fontSize: '1.2rem',
              fontWeight: 'bold',
              flexShrink: 0,
            }}
          >
            {user?.username?.[0]?.toUpperCase()}
          </Avatar>
          <Box>
            <Typography variant="h6" fontWeight="bold" lineHeight={1.2}>
              {user?.username}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {user?.email}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* ── Global alerts ── */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}
          icon={<CheckCircleIcon fontSize="inherit" />}
        >
          {success}
        </Alert>
      )}

      <Box display="flex" flexDirection="column" gap={3}>

        {/* ── Security ── */}
        <Section
          icon={<LockIcon sx={{ fontSize: 20 }} />}
          title="Security"
          description="Manage your password and account credentials"
        >
          <Box px={{ xs: 2.5, sm: 3 }} py={3}>
            <Typography variant="body2" color="text.secondary" mb={2.5}>
              We'll send a secure reset link to{' '}
              <Typography component="span" variant="body2" fontWeight="bold" color="text.primary">
                {user?.email}
              </Typography>
              .
            </Typography>
            <Button
              variant="outlined"
              fullWidth
              onClick={resetPassword}
              disabled={actionLoading}
              startIcon={actionLoading ? <CircularProgress size={16} color="inherit" /> : <LockIcon fontSize="small" />}
            >
              {actionLoading ? 'Sending…' : 'Send Password Reset Email'}
            </Button>
          </Box>
        </Section>

        {/* ── Profile ── */}
        <Section
          icon={<PersonIcon sx={{ fontSize: 20 }} />}
          title="Profile"
          description="Update your public display name"
          iconBg="info.50"
          iconColor="info.main"
        >
          <Box component="form" onSubmit={editUsername} px={{ xs: 2.5, sm: 3 }} py={3}>
            <TextField
              fullWidth
              label="New Username"
              size="small"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              required
              sx={{ mb: 2 }}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={actionLoading || !newUsername}
              startIcon={actionLoading ? <CircularProgress size={16} color="inherit" /> : <SaveIcon fontSize="small" />}
            >
              {actionLoading ? 'Saving…' : 'Save Username'}
            </Button>
          </Box>
        </Section>

        {/* ── Custom Email Message ── */}
        <Section
          icon={<MessageIcon sx={{ fontSize: 20 }} />}
          title="Custom Email Message"
          description="Appended to every reminder email you send"
          iconBg="success.50"
          iconColor="success.main"
        >
          <Box px={{ xs: 2.5, sm: 3 }} py={3}>
            <TextField
              fullWidth
              multiline
              rows={3}
              size="small"
              placeholder="e.g. Please complete this form by end of day. Thank you!"
              value={customMessage}
              onChange={(e) => {
                setCustomMessage(e.target.value);
                setCustomMessageSaved(false);
              }}
              inputProps={{ maxLength: 200 }}
              helperText={`${customMessage.length} / 200 characters`}
              sx={{ mb: 2 }}
            />
            <Button
              variant="contained"
              color="success"
              fullWidth
              onClick={saveCustomMessage}
              disabled={customMessageLoading || customMessageSaved}
              startIcon={
                customMessageLoading ? (
                  <CircularProgress size={16} color="inherit" />
                ) : customMessageSaved ? (
                  <CheckCircleIcon fontSize="small" />
                ) : (
                  <SaveIcon fontSize="small" />
                )
              }
            >
              {customMessageSaved ? 'Saved' : 'Save Message'}
            </Button>
          </Box>
        </Section>

        {/* ── Notifications ── */}
        <Section
          icon={<NotificationsIcon sx={{ fontSize: 20 }} />}
          title="Notifications"
          description="Toggle email alerts per active form"
          iconBg="warning.50"
          iconColor="warning.main"
        >
          {formRequests.length === 0 ? (
            <Box px={3} py={4} textAlign="center">
              <Typography variant="body2" color="text.secondary">
                No active forms found.
              </Typography>
            </Box>
          ) : (
            <List disablePadding>
              {formRequests.map((form, index) => (
                <ListItem
                  key={form.id}
                  divider={index < formRequests.length - 1}
                  sx={{ px: { xs: 2.5, sm: 3 }, py: 1.5 }}
                >
                  <ListItemText
                    primary={form.title || 'Untitled Form'}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 'medium' }}
                  />
                  <ListItemSecondaryAction>
                    <Switch
                      edge="end"
                      size="small"
                      checked={!!form.notificationsEnabled}
                      onChange={(e) => handleToggleNotification(form.id, e.target.checked)}
                      disabled={actionLoading}
                    />
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </Section>

        {/* ── Team & Organization ── */}
        <Section
          icon={<GroupIcon sx={{ fontSize: 20 }} />}
          title="Team & Organization"
          description="Organizations you have joined as a member"
          iconBg="grey.100"
          iconColor="text.secondary"
        >
          {memberships.length === 0 ? (
            <Box px={3} py={4} textAlign="center">
              <Typography variant="body2" color="text.secondary">
                You are not a member of any other organizations.
              </Typography>
            </Box>
          ) : (
            <List disablePadding>
              {memberships.map((org, index) => (
                <ListItem
                  key={org.membership_id}
                  divider={index < memberships.length - 1}
                  sx={{ px: { xs: 2.5, sm: 3 }, py: 2 }}
                >
                  <ListItemText
                    primary={org.org_name}
                    secondary={`Role: ${org.role.charAt(0).toUpperCase() + org.role.slice(1)}`}
                    primaryTypographyProps={{ variant: 'body1', fontWeight: 'bold' }}
                  />
                  <ListItemSecondaryAction>
                    <Button
                      size="small"
                      color="error"
                      variant="text"
                      onClick={() => handleLeaveOrg(org.membership_id)}
                      disabled={actionLoading}
                      sx={{ fontWeight: 'bold' }}
                    >
                      Leave
                    </Button>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </Section>

        {/* ── Danger Zone (collapsible) ── */}
        <Paper
          elevation={0}
          sx={{ border: '1px solid', borderColor: 'error.light', borderRadius: 3, overflow: 'hidden' }}
        >
          {/* Toggle header */}
          <Box
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            px={{ xs: 2.5, sm: 3 }}
            py={2}
            onClick={() => setDangerOpen((v) => !v)}
            sx={{
              cursor: 'pointer',
              bgcolor: dangerOpen ? '#fff0f0' : 'transparent',
              transition: 'background 0.2s',
              '&:hover': { bgcolor: '#fff0f0' },
            }}
          >
            <Box display="flex" alignItems="center" gap={1.5}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 2,
                  bgcolor: 'error.50',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <WarningAmberIcon color="error" sx={{ fontSize: 20 }} />
              </Box>
              <Box>
                <Typography variant="subtitle1" fontWeight="bold" color="error.main">
                  Danger Zone
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Permanent and irreversible actions
                </Typography>
              </Box>
            </Box>
            <ExpandMoreIcon
              color="error"
              sx={{
                fontSize: 20,
                transform: dangerOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                flexShrink: 0,
              }}
            />
          </Box>

          <Collapse in={dangerOpen}>
            <Divider sx={{ borderColor: 'error.light' }} />
            <Box
              component="form"
              onSubmit={handleDelete}
              px={{ xs: 2.5, sm: 3 }}
              py={3}
            >
              <Typography variant="body2" color="text.secondary" mb={2.5}>
                Deleting your account is <strong>permanent</strong> and cannot be undone. All your
                form requests, groups, and settings will be removed. Enter your password to
                confirm.
              </Typography>
              <TextField
                fullWidth
                label="Current Password"
                type="password"
                size="small"
                color="error"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                required
                sx={{ mb: 2 }}
              />
              <Button
                type="submit"
                variant="outlined"
                color="error"
                fullWidth
                disabled={actionLoading || !deletePassword}
                startIcon={actionLoading ? <CircularProgress size={16} color="inherit" /> : <WarningAmberIcon fontSize="small" />}
              >
                {actionLoading ? 'Deleting…' : 'Permanently Delete Account'}
              </Button>
            </Box>
          </Collapse>
        </Paper>

      </Box>
    </Container>
  );
}