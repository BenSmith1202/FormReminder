/**
 * ConnectForms.tsx
 *
 * Full-screen onboarding page shown when a user has no form providers connected.
 * Presents three large provider cards (Google Forms, Jotform, Microsoft Forms)
 * and requires at least one connection before continuing to the dashboard.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import API_URL from '../config';

// ── Types ─────────────────────────────────────────────────────────────────

interface ConnectedProviders {
  google: boolean;
  jotform: boolean;
  microsoft: boolean;
}

type ProviderKey = keyof ConnectedProviders;

interface ProviderInfo {
  key: ProviderKey;
  label: string;
  logo: string;           // path relative to /public
  description: string;
  color: string;           // accent colour for the card border on hover
}

const PROVIDERS: ProviderInfo[] = [
  {
    key: 'google',
    label: 'Google Forms',
    logo: '/google-forms-logo.svg',
    description: 'Connect your Google account to track Google Forms responses.',
    color: '#673ab7',
  },
  {
    key: 'jotform',
    label: 'Jotform',
    logo: '/jotform-logo.svg',
    description: 'Sign in to Jotform to track your Jotform submissions.',
    color: '#FF6100',
  },
  {
    key: 'microsoft',
    label: 'Microsoft Forms',
    logo: '/microsoft-forms-logo.svg',
    description: 'Connect your Microsoft account to track Microsoft Forms responses.',
    color: '#0078d4',
  },
];

// ── Component ─────────────────────────────────────────────────────────────

export default function ConnectForms() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ConnectedProviders>({
    google: false,
    jotform: false,
    microsoft: false,
  });
  const [loading, setLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<ProviderKey | null>(null);
  const [jotformDialogOpen, setJotformDialogOpen] = useState(false);
  const [jotformApiKey, setJotformApiKey] = useState('');
  const [jotformError, setJotformError] = useState('');
  const [connectError, setConnectError] = useState('');

  // Number of providers the user has connected
  const connectedCount = Object.values(providers).filter(Boolean).length;

  // ── Fetch current connection status ────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/connected-accounts`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        // If user isn't even logged in, redirect to login
        if (!data.authenticated) {
          navigate('/login', { replace: true });
          return;
        }
        setProviders({ google: data.google, jotform: data.jotform, microsoft: data.microsoft });
      }
    } catch (err) {
      console.error('Failed to fetch connected accounts', err);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Re-check status when window regains focus (covers OAuth popup / redirect flows)
  useEffect(() => {
    const onFocus = () => fetchStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchStatus]);

  // ── Provider connect handlers ──────────────────────────────────────────

  const connectGoogle = async () => {
    setConnectingProvider('google');
    try {
      const res = await fetch(`${API_URL}/login/google`, { credentials: 'include' });
      if (res.status === 401) {
        navigate('/login', { replace: true });
        return;
      }
      const data = await res.json();
      if (data.authorization_url) {
        window.open(data.authorization_url, '_blank', 'width=600,height=700');
      }
    } catch (err) {
      console.error('Google connect failed', err);
    } finally {
      setConnectingProvider(null);
    }
  };

  const connectJotform = () => {
    setJotformApiKey('');
    setJotformError('');
    setJotformDialogOpen(true);
  };

  const submitJotformKey = async () => {
    const key = jotformApiKey.trim();
    if (!key) {
      setJotformError('Please enter your API key.');
      return;
    }

    setConnectingProvider('jotform');
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
        fetchStatus();
      } else {
        const data = await res.json().catch(() => ({}));
        setJotformError(data.error || 'Invalid API key. Please check and try again.');
      }
    } catch (err) {
      console.error('Jotform connect failed', err);
      setJotformError('Connection failed. Please try again.');
    } finally {
      setConnectingProvider(null);
    }
  };

  const connectMicrosoft = async () => {
    setConnectingProvider('microsoft');
    setConnectError('');
    try {
      const res = await fetch(`${API_URL}/login/microsoft`, { credentials: 'include' });
      if (res.status === 401) {
        navigate('/login', { replace: true });
        return;
      }
      const data = await res.json();
      if (data.error) {
        setConnectError(`Microsoft: ${data.error}`);
        return;
      }
      if (data.authorization_url) {
        window.open(data.authorization_url, '_blank', 'width=600,height=700');
      }
    } catch (err) {
      console.error('Microsoft connect failed', err);
      setConnectError('Failed to start Microsoft sign-in. Please try again.');
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleConnect = (key: ProviderKey) => {
    if (key === 'google') connectGoogle();
    else if (key === 'jotform') connectJotform();
    else if (key === 'microsoft') connectMicrosoft();
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  // If user already connected at least one provider and navigated here directly, let them through
  const hasAny = connectedCount > 0;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 50%, #e8f5e9 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 6,
        px: 2,
      }}
    >
      <Container maxWidth="md">
        {/* Header */}
        <Box textAlign="center" mb={5}>
          <Typography variant="h3" fontWeight={700} gutterBottom>
            Welcome to FormReminder
          </Typography>
          <Typography variant="h6" color="text.secondary">
            {hasAny
              ? 'Add other form options or continue to your dashboard.'
              : 'Select the form platforms you use to get started.'}
          </Typography>
        </Box>

        {/* Error alert */}
        {connectError && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setConnectError('')}>
            {connectError}
          </Alert>
        )}

        {/* Provider cards */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
            gap: 3,
            mb: 5,
          }}
        >
          {PROVIDERS.map((p) => {
            const connected = providers[p.key];
            const isConnecting = connectingProvider === p.key;

            return (
              <Card
                key={p.key}
                elevation={0}
                sx={{
                  borderRadius: 4,
                  border: '2px solid',
                  borderColor: connected ? p.color : 'divider',
                  textAlign: 'center',
                  py: 4,
                  px: 2,
                  position: 'relative',
                  opacity: connected ? 0.75 : 1,
                  transition: 'all 0.25s ease',
                  cursor: connected ? 'default' : 'pointer',
                  '&:hover': connected
                    ? {}
                    : {
                        transform: 'translateY(-6px)',
                        boxShadow: `0 12px 32px -8px ${p.color}44`,
                        borderColor: p.color,
                      },
                }}
                onClick={() => !connected && !isConnecting && handleConnect(p.key)}
              >
                {/* Connected badge */}
                {connected && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 12,
                      right: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      color: 'success.main',
                    }}
                  >
                    <CheckCircleIcon fontSize="small" />
                    <Typography variant="caption" fontWeight={600}>
                      Connected
                    </Typography>
                  </Box>
                )}

                <CardContent>
                  {/* Logo */}
                  <Box
                    component="img"
                    src={p.logo}
                    alt={p.label}
                    sx={{ width: 72, height: 72, objectFit: 'contain', mb: 2 }}
                    onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                      // Hide broken image if logo file is missing
                      e.currentTarget.style.display = 'none';
                    }}
                  />

                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {p.label}
                  </Typography>

                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {p.description}
                  </Typography>

                  {isConnecting ? (
                    <CircularProgress size={28} />
                  ) : connected ? (
                    <Typography variant="body2" color="success.main" fontWeight={600}>
                      ✓ Account linked
                    </Typography>
                  ) : (
                    <Button
                      variant="contained"
                      sx={{
                        bgcolor: p.color,
                        '&:hover': { bgcolor: p.color, filter: 'brightness(0.9)' },
                        borderRadius: 2,
                        textTransform: 'none',
                        fontWeight: 600,
                        px: 3,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConnect(p.key);
                      }}
                    >
                      Connect {p.label}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Box>

        {/* Continue button — only shown when at least one provider is connected */}
        {hasAny && (
          <Box textAlign="center">
            <Button
              variant="contained"
              size="large"
              onClick={() => navigate('/')}
              sx={{
                borderRadius: 3,
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '1.1rem',
                px: 6,
                py: 1.5,
              }}
            >
              Continue to Dashboard
            </Button>
          </Box>
        )}
      </Container>

      {/* ── Jotform API Key Dialog ──────────────────────────────────── */}
      <Dialog
        open={jotformDialogOpen}
        onClose={() => setJotformDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Connect Jotform</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            To connect your Jotform account, paste your API key below. You can
            find it at{' '}
            <Link
              href="https://www.jotform.com/myaccount/api"
              target="_blank"
              rel="noopener noreferrer"
            >
              jotform.com/myaccount/api
            </Link>
            .
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="Jotform API Key"
            placeholder="e.g. f71cab433ff976e6c870300135156d82"
            value={jotformApiKey}
            onChange={(e) => {
              setJotformApiKey(e.target.value);
              setJotformError('');
            }}
            error={!!jotformError}
            helperText={jotformError}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitJotformKey();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setJotformDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitJotformKey}
            disabled={connectingProvider === 'jotform'}
            sx={{ bgcolor: '#FF6100', '&:hover': { bgcolor: '#e55800' } }}
          >
            {connectingProvider === 'jotform' ? (
              <CircularProgress size={20} color="inherit" />
            ) : (
              'Connect'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
