import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Alert,
  TextField,
  List,
  ListItem,
  ListItemText,
  Switch,
  Paper,
  Button,
  Avatar,
  Skeleton
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import NotificationsIcon from '@mui/icons-material/Notifications';
import MessageIcon from '@mui/icons-material/Message';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

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
  const [deletePassword, setDeletePassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const [customMessageLoading, setCustomMessageLoading] = useState(false);
  const [customMessageSaved, setCustomMessageSaved] = useState(true);
  const [expanded, setExpanded] = useState<string | false>('profile');

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

  const handleChange = (panel: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
  setExpanded(isExpanded ? panel : false);
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
  <Container maxWidth="sm" sx={{ py: { xs: 2, sm: 4 } }} className="page-fade-in">
    {/* ── Page Header & Identity ── */}
    <Box mb={3} display="flex" alignItems="center" gap={2} p={2} sx={{ borderRadius: 3, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
      <Avatar sx={{ width: 48, height: 48, bgcolor: 'primary.main', fontWeight: 'bold' }}>
        {user?.username?.[0]?.toUpperCase()}
      </Avatar>
      <Box>
        <Typography variant="subtitle1" fontWeight="bold">{user?.username}</Typography>
        <Typography variant="caption" color="text.secondary">{user?.email}</Typography>
      </Box>
    </Box>

    {/* ── Global Alerts ── */}
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
    {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

    {/* ── Settings Accordion Group ── */}
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>

      {/* Category: Security */}
      <Accordion expanded={expanded === 'security'} onChange={handleChange('security')} sx={{ borderRadius: '12px !important', border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box display="flex" alignItems="center" gap={2}>
            <LockIcon color="primary" fontSize="small" />
            <Typography fontWeight="bold">Security & Password</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Typography variant="body2" color="text.secondary" mb={2}>Verify your account via email to reset your password.</Typography>
          <Button variant="outlined" fullWidth onClick={resetPassword} disabled={actionLoading}>Send Reset Link</Button>
        </AccordionDetails>
      </Accordion>

      {/* Category: Custom Message */}
      <Accordion expanded={expanded === 'message'} onChange={handleChange('message')} sx={{ borderRadius: '12px !important', border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box display="flex" alignItems="center" gap={2}>
            <MessageIcon color="success" fontSize="small" />
            <Typography fontWeight="bold">Email Customization</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <TextField fullWidth multiline rows={3} size="small" value={customMessage} onChange={(e) => { setCustomMessage(e.target.value); setCustomMessageSaved(false); }} inputProps={{ maxLength: 200 }} helperText={`${customMessage.length}/200`} sx={{ mb: 2 }} />
          <Button variant="contained" color="success" fullWidth onClick={saveCustomMessage} disabled={customMessageLoading || customMessageSaved}>
            {customMessageSaved ? 'Saved' : 'Save Message'}
          </Button>
        </AccordionDetails>
      </Accordion>

      {/* Category: Notifications */}
      <Accordion expanded={expanded === 'notifications'} onChange={handleChange('notifications')} sx={{ borderRadius: '12px !important', border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box display="flex" alignItems="center" gap={2}>
            <NotificationsIcon color="warning" fontSize="small" />
            <Typography fontWeight="bold">Form Notifications</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0 }}>
          <List disablePadding>
            {formRequests.map((form) => (
              <ListItem key={form.id} divider sx={{ py: 1 }}>
                <ListItemText primary={form.title || 'Untitled'} primaryTypographyProps={{ variant: 'body2' }} />
                <Switch size="small" checked={!!form.notificationsEnabled} onChange={(e) => handleToggleNotification(form.id, e.target.checked)} />
              </ListItem>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>

      {/* Danger Zone */}
      <Accordion expanded={expanded === 'danger'} onChange={handleChange('danger')} sx={{ borderRadius: '12px !important', border: '1px solid', borderColor: 'error.light', boxShadow: 'none', bgcolor: '#fff8f8' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon color="error" />}>
          <Box display="flex" alignItems="center" gap={2}>
            <WarningAmberIcon color="error" fontSize="small" />
            <Typography fontWeight="bold" color="error">Account Deletion</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Typography variant="caption" color="error" display="block" mb={2}>Permanent account deletion.</Typography>
          <TextField fullWidth type="password" size="small" label="Password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} sx={{ mb: 2 }} />
          <Button variant="outlined" color="error" fullWidth onClick={handleDelete} disabled={actionLoading || !deletePassword}>Delete Account</Button>
        </AccordionDetails>
      </Accordion>
    </Box>
  </Container>
);
}