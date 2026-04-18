import { useEffect, useState, useCallback } from 'react';
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
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import LockIcon from '@mui/icons-material/Lock';
import NotificationsIcon from '@mui/icons-material/Notifications';
import MessageIcon from '@mui/icons-material/Message';
import PersonIcon from '@mui/icons-material/Person';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LinkIcon from '@mui/icons-material/Link';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AnimatedInfoButton from '../components/InfoButton';
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
  const [customMessage, setCustomMessage] = useState('');
  const [customMessageLoading, setCustomMessageLoading] = useState(false);
  const [customMessageSaved, setCustomMessageSaved] = useState(true);

  // ── Connected providers state ──
  const [connectedProviders, setConnectedProviders] = useState<{ google: boolean; jotform: boolean; microsoft: boolean }>({
    google: false, jotform: false, microsoft: false,
  });
  const [jotformDialogOpen, setJotformDialogOpen] = useState(false);
  const [jotformApiKey, setJotformApiKey] = useState('');
  const [jotformError, setJotformError] = useState('');
  const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(null);
  const [providerLoading, setProviderLoading] = useState(false);

  // ── Profile photo state ──
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  const PROVIDERS = [
    { key: 'google' as const, label: 'Google Forms', logo: '/google-forms-logo.svg', color: '#673ab7' },
    { key: 'jotform' as const, label: 'Jotform', logo: '/jotform-logo.svg', color: '#FF6100' },
    { key: 'microsoft' as const, label: 'Microsoft Forms', logo: '/microsoft-forms-logo.svg', color: '#0078d4' },
  ];

  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 256;
      const scale = Math.min(MAX / img.width, MAX / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      setPhotoPreview(dataUrl);
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  };

  const handlePhotoSave = async () => {
    if (!photoPreview) return;
    setPhotoLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/profile-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ photo: photoPreview }),
      });
      if (res.ok) {
        setUser((u: any) => ({ ...u, profile_photo_url: photoPreview }));
        window.dispatchEvent(new CustomEvent('profile-photo-changed', { detail: { profile_photo_url: photoPreview } }));
        setSuccess('Profile photo updated!');
        setPhotoDialogOpen(false);
        setPhotoPreview(null);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save photo');
      }
    } catch {
      setError('Connection failed.');
    } finally {
      setPhotoLoading(false);
    }
  };

  const handlePhotoRemove = async () => {
    setPhotoLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/profile-photo`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setUser((u: any) => ({ ...u, profile_photo_url: null }));
        window.dispatchEvent(new CustomEvent('profile-photo-changed', { detail: { profile_photo_url: null } }));
        setSuccess('Profile photo removed.');
        setPhotoDialogOpen(false);
        setPhotoPreview(null);
      } else {
        setError('Failed to remove photo');
      }
    } catch {
      setError('Connection failed.');
    } finally {
      setPhotoLoading(false);
    }
  };

  const fetchProviderStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/connected-accounts`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setConnectedProviders({ google: data.google, jotform: data.jotform, microsoft: data.microsoft });
      }
    } catch { /* silent */ }
  }, []);

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
    fetchProviderStatus();
  }, [fetchProviderStatus]);

  // Re-check provider status when window regains focus (covers OAuth popup flows)
  useEffect(() => {
    const onFocus = () => fetchProviderStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchProviderStatus]);

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
          prev.map((f) => (f.id === formId ? { ...f, notifications_enabled: enabled } : f))
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

  // ── Provider connect / disconnect ──
  const connectProvider = async (key: 'google' | 'jotform' | 'microsoft') => {
    if (key === 'jotform') {
      setJotformApiKey('');
      setJotformError('');
      setJotformDialogOpen(true);
      return;
    }

    setProviderLoading(true);
    try {
      const endpoint = key === 'google' ? '/login/google' : '/login/microsoft';
      const res = await fetch(`${API_URL}${endpoint}`, { credentials: 'include' });
      const data = await res.json();
      if (data.authorization_url) {
        window.open(data.authorization_url, '_blank', 'width=600,height=700');
      } else {
        setError(data.error || `Could not start ${key} connect`);
      }
    } catch {
      setError(`Failed to connect ${key}`);
    } finally {
      setProviderLoading(false);
    }
  };

  const submitJotformKey = async () => {
    const key = jotformApiKey.trim();
    if (!key) { setJotformError('Please enter your API key.'); return; }
    setProviderLoading(true);
    setJotformError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/jotform/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ api_key: key }),
      });
      if (res.ok) {
        setJotformDialogOpen(false);
        fetchProviderStatus();
        setSuccess('Jotform connected!');
      } else {
        const data = await res.json().catch(() => ({}));
        setJotformError(data.error || 'Invalid API key.');
      }
    } catch {
      setJotformError('Connection failed. Please try again.');
    } finally {
      setProviderLoading(false);
    }
  };

  const disconnectProvider = async (key: 'google' | 'jotform' | 'microsoft') => {
    setDisconnectConfirm(null);
    setProviderLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/${key}/disconnect`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        fetchProviderStatus();
        setSuccess(`${PROVIDERS.find(p => p.key === key)?.label} disconnected.`);
      } else {
        setError('Failed to disconnect provider.');
      }
    } catch {
      setError('Connection error.');
    } finally {
      setProviderLoading(false);
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
        <Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
          Settings          <AnimatedInfoButton title="FormReminder Settings">
                              <p>This page allows you to manage your FormReminder account settings.</p>
                              <p>Here you can update your username, set a custom message for your reminder emails, and toggle notification preferences for each of your active forms.</p>
                              <p>Be sure to click "Save" after making any changes to ensure your settings are updated.</p>
                            </AnimatedInfoButton>
        </Typography>
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
          {/* Clickable avatar — opens the photo upload dialog */}
          <Box
            onClick={() => { setPhotoPreview(null); setPhotoDialogOpen(true); }}
            sx={{ position: 'relative', cursor: 'pointer', flexShrink: 0, '&:hover .avatar-overlay': { opacity: 1 } }}
          >
            <Avatar
              src={user?.profile_photo_url || undefined}
              sx={{ width: 56, height: 56, bgcolor: 'primary.main', fontSize: '1.3rem', fontWeight: 'bold' }}
            >
              {!user?.profile_photo_url && user?.username?.[0]?.toUpperCase()}
            </Avatar>
            {/* Camera overlay on hover */}
            <Box
              className="avatar-overlay"
              sx={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                bgcolor: 'rgba(0,0,0,0.45)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                opacity: 0, transition: 'opacity 0.2s',
              }}
            >
              <CameraAltIcon sx={{ color: '#fff', fontSize: 20 }} />
            </Box>
          </Box>

          <Box>
            <Typography variant="h6" component="p" fontWeight="bold" lineHeight={1.2}>
              {user?.username}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {user?.email}
            </Typography>
          </Box>
        </Box>

        {/* ── Photo upload dialog ── */}
        <Dialog open={photoDialogOpen} onClose={() => { setPhotoDialogOpen(false); setPhotoPreview(null); }} maxWidth="xs" fullWidth>
          <DialogTitle>Profile Photo</DialogTitle>
          <DialogContent sx={{ textAlign: 'center', pt: 2 }}>
            {/* Current / preview avatar */}
            <Avatar
              src={photoPreview || user?.profile_photo_url || undefined}
              sx={{ width: 100, height: 100, mx: 'auto', mb: 2, bgcolor: 'primary.main', fontSize: '2rem', fontWeight: 'bold' }}
            >
              {!photoPreview && !user?.profile_photo_url && user?.username?.[0]?.toUpperCase()}
            </Avatar>

            <Button
              variant="outlined"
              component="label"
              startIcon={<CameraAltIcon />}
              fullWidth
              sx={{ mb: 1 }}
            >
              Choose Photo
              <input type="file" accept="image/*" hidden onChange={handlePhotoFileChange} />
            </Button>

            {user?.profile_photo_url && !photoPreview && (
              <Button
                variant="text"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                fullWidth
                disabled={photoLoading}
                onClick={handlePhotoRemove}
              >
                Remove Photo
              </Button>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setPhotoDialogOpen(false); setPhotoPreview(null); }}>Cancel</Button>
            <Button
              variant="contained"
              disabled={!photoPreview || photoLoading}
              onClick={handlePhotoSave}
              startIcon={photoLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {photoLoading ? 'Saving…' : 'Save'}
            </Button>
          </DialogActions>
        </Dialog>
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

        {/* ── Connected Providers ── */}
        <Section
          icon={<LinkIcon sx={{ fontSize: 20 }} />}
          title="Connected Providers"
          description="Form providers you have authorized"
          iconBg="secondary.50"
          iconColor="secondary.main"
        >
          <Box px={{ xs: 2.5, sm: 3 }} py={2}>
            {PROVIDERS.map((p) => {
              const connected = connectedProviders[p.key];
              return (
                <Box
                  key={p.key}
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  py={1.5}
                  sx={{ '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' } }}
                >
                  <Box display="flex" alignItems="center" gap={1.5}>
                    <Box
                      component="img"
                      src={p.logo}
                      alt={p.label}
                      sx={{ width: 28, height: 28, objectFit: 'contain' }}
                    />
                    <Box>
                      <Typography variant="body2" fontWeight="medium">{p.label}</Typography>
                      <Chip
                        label={connected ? 'Connected' : 'Not Connected'}
                        size="small"
                        color={connected ? 'success' : 'default'}
                        variant={connected ? 'filled' : 'outlined'}
                        sx={{ mt: 0.3, height: 20, fontSize: '0.7rem' }}
                      />
                    </Box>
                  </Box>
                  {connected ? (
                    <Button
                      size="small"
                      color="error"
                      variant="text"
                      disabled={providerLoading}
                      onClick={() => setDisconnectConfirm(p.key)}
                      sx={{ fontWeight: 'bold', textTransform: 'none' }}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={providerLoading}
                      onClick={() => connectProvider(p.key)}
                      sx={{ textTransform: 'none' }}
                    >
                      Connect
                    </Button>
                  )}
                </Box>
              );
            })}
          </Box>
        </Section>

        {/* Disconnect confirmation dialog */}
        <Dialog open={!!disconnectConfirm} onClose={() => setDisconnectConfirm(null)}>
          <DialogTitle>Disconnect {PROVIDERS.find(p => p.key === disconnectConfirm)?.label}?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              You will need to re-authorize this provider before creating new form requests with it.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDisconnectConfirm(null)}>Cancel</Button>
            <Button color="error" variant="contained"
              onClick={() => disconnectProvider(disconnectConfirm as 'google' | 'jotform' | 'microsoft')}
            >
              Disconnect
            </Button>
          </DialogActions>
        </Dialog>

        {/* Jotform API key dialog */}
        <Dialog open={jotformDialogOpen} onClose={() => setJotformDialogOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Connect Jotform</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Enter your Jotform API key. You can find it at{' '}
              <a href="https://www.jotform.com/myaccount/api" target="_blank" rel="noopener noreferrer">
                jotform.com/myaccount/api
              </a>.
            </Typography>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="API Key"
              value={jotformApiKey}
              onChange={(e) => setJotformApiKey(e.target.value)}
              error={!!jotformError}
              helperText={jotformError}
              onKeyDown={(e) => { if (e.key === 'Enter') submitJotformKey(); }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setJotformDialogOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={submitJotformKey} disabled={providerLoading}>
              {providerLoading ? <CircularProgress size={16} /> : 'Connect'}
            </Button>
          </DialogActions>
        </Dialog>

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
                      checked={form.notifications_enabled !== false}
                      onChange={(e) => handleToggleNotification(form.id, e.target.checked)}
                      disabled={actionLoading}
                    />
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