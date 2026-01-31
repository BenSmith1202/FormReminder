import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Paper,
  Typography,
  Box,
  CircularProgress,
  Button,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Stack,
  Divider,
  IconButton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import EmailIcon from '@mui/icons-material/Email';
import SendIcon from '@mui/icons-material/Send';
import RefreshIcon from '@mui/icons-material/Refresh';

const API_URL = 'http://localhost:5000';

interface FormRequest {
  id: string;
  title: string;
  description: string;
  form_url: string;
  response_count: number;
  total_recipients: number;
  created_at: string;
  last_synced_at?: string;  // Optional - only set when form is synced
  status: string;
  warnings?: string[];
}

interface Response {
  id: string;
  respondent_email: string;
  submitted_at: string;
  response_id: string;
  is_member?: boolean;
}

interface MemberStatus {
  email: string;
  status: 'responded' | 'not_responded';
  submitted_at?: string;
}

export default function ViewRequest() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formRequest, setFormRequest] = useState<FormRequest | null>(null);
  const [nonMemberResponses, setNonMemberResponses] = useState<Response[]>([]);
  const [memberStatus, setMemberStatus] = useState<MemberStatus[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [needsGoogleReconnect, setNeedsGoogleReconnect] = useState(false);

  const loadFormRequestData = async (showLoadingSpinner = true) => {
    try {
      if (showLoadingSpinner) {
        setLoading(true);
      }
      setError(null);

      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/responses`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to load form request: ${response.status}`);
      }

      const data = await response.json();

      const formReq = data?.form_request;
      if (!formReq) {
        throw new Error('Invalid response: no form request data');
      }

      setFormRequest(formReq);
      setNonMemberResponses(Array.isArray(data.non_member_responses) ? data.non_member_responses : []);
      setMemberStatus(Array.isArray(data.member_status) ? data.member_status : []);
      setLastUpdated(new Date());
    } catch (err: any) {
      console.error('Error loading form request:', err);
      setError(err.message || 'Failed to load form request');
    } finally {
      if (showLoadingSpinner) {
        setLoading(false);
      }
    }
  };

  const handleSendReminder = async (email: string) => {
    if (!window.confirm(`Send a reminder email to ${email}?`)) {
      return;
    }

    setSendingEmail(email);
    try {
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/send-reminder/${encodeURIComponent(email)}`, {
        method: 'POST',
        credentials: 'include',
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to send reminder');
      }
      
      console.log('Reminder sent:', result);
      alert(result.message || 'Reminder sent successfully!');
      
    } catch (err: any) {
      console.error('Failed to send reminder:', err);
      alert(`Failed to send reminder: ${err.message}`);
    } finally {
      setSendingEmail(null);
    }
  };

  const handleSendBulkReminders = async () => {
    const nonResponders = memberStatus.filter(m => m.status === 'not_responded');
    
    if (nonResponders.length === 0) {
      alert('All members have already responded!');
      return;
    }

    if (!window.confirm(`Send reminder emails to all ${nonResponders.length} non-responders?\n\n(This will skip anyone who was sent a reminder in the last hour)`)) {
      return;
    }

    setSendingBulk(true);
    try {
      const response = await fetch(`${API_URL}/api/form-requests/${requestId}/send-reminders`, {
        method: 'POST',
        credentials: 'include',
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to send reminders');
      }
      
      console.log('Bulk reminders sent:', result);
      alert(`Success!\n\nSent: ${result.sent}\nSkipped (rate limit): ${result.skipped}\nFailed: ${result.failed}`);
      
    } catch (err: any) {
      console.error('Failed to send bulk reminders:', err);
      alert(`Failed to send reminders: ${err.message}`);
    } finally {
      setSendingBulk(false);
    }
  };

  useEffect(() => {
    if (requestId) {
      // Sync and load on initial page load
      syncAndLoadData();
    }
  }, [requestId]);

  // Auto-refresh polling
  useEffect(() => {
    if (!requestId) return;

    // Poll every 30 seconds
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncAndLoadData();
      }
    }, 30000);

    // Handle tab visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Immediately refresh when tab becomes active
        syncAndLoadData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [requestId]);

  const syncAndLoadData = async (showLoading = false) => {
    try {
      if (showLoading) {
        setRefreshing(true);
      }

      // Sync with Google Forms first (best-effort; don't crash page if it fails)
      try {
        const response = await fetch(`${API_URL}/api/form-requests/${requestId}/refresh`, {
          method: 'POST',
          credentials: 'include',
        });

        if (!response.ok) {
          let errMsg = `Failed to refresh (${response.status})`;
          let needsReconnect = false;
          try {
            const result = await response.json();
            errMsg = result.message || result.error || result.details || errMsg;
            // 404 "form not found" = need edit URL, not reconnect
            needsReconnect = result.action_required === 'reconnect_google' && result.code !== 'form_id_edit_link_required';
          } catch {
            // Response may be non-JSON (e.g. HTML error page)
          }
          console.error('Auto-refresh sync error:', errMsg);
          if (needsReconnect) setNeedsGoogleReconnect(true);
          else if (response.status === 404) setNeedsGoogleReconnect(false);
          // Only set error on initial load when we have no data yet; otherwise keep showing cached data
          if (!formRequest) {
            setError(errMsg);
          }
        } else {
          setNeedsGoogleReconnect(false);
          try {
            const result = await response.json();
            console.log('Sync complete:', result.response_count ?? 0, 'responses');
          } catch {
            // Ignore JSON parse failure for success response
          }
        }
      } catch (refreshErr: unknown) {
        console.error('Auto-refresh error:', refreshErr);
        if (!formRequest) {
          setError(refreshErr instanceof Error ? refreshErr.message : 'Failed to refresh responses');
        }
      }

      // Always load data (from cache or after sync); never leave page blank
      // Use full loading spinner only when we don't have data yet (initial load)
      const isInitialLoad = !formRequest;
      try {
        await loadFormRequestData(isInitialLoad);
      } catch (loadErr) {
        console.error('Load form request data error:', loadErr);
        if (!formRequest) {
          setError(loadErr instanceof Error ? loadErr.message : 'Failed to load form request');
        }
      }
    } finally {
      if (showLoading) {
        setRefreshing(false);
      }
    }
  };

  const handleManualRefresh = async () => {
    await syncAndLoadData(true);
  };

  // Update "seconds since update" counter
  useEffect(() => {
    if (!lastUpdated) return;

    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      setSecondsSinceUpdate(seconds);
    }, 1000);

    return () => clearInterval(timer);
  }, [lastUpdated]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error && !formRequest) {
    return (
      <Box>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
          sx={{ mb: 2 }}
        >
          Back to Dashboard
        </Button>
        <Alert
          severity="error"
          action={
            needsGoogleReconnect ? (
              <Button
                color="inherit"
                size="small"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_URL}/login/google`, { credentials: 'include' });
                    const data = await res.json();
                    if (data.authorization_url) {
                      window.location.href = data.authorization_url;
                    }
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Reconnect Google
              </Button>
            ) : undefined
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  if (!formRequest) {
    return (
      <Box>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
          sx={{ mb: 2 }}
        >
          Back to Dashboard
        </Button>
        <Alert severity="warning">Form request not found</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box display="flex" alignItems="center">
          <IconButton onClick={() => navigate('/')} sx={{ mr: 2 }}>
            <ArrowBackIcon />
          </IconButton>
          <Box>
            <Typography variant="h4">
              {formRequest.title ?? 'Form Request'}
            </Typography>
            {lastUpdated && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Last updated: {secondsSinceUpdate}s ago
              </Typography>
            )}
          </Box>
        </Box>
        <Button
          variant="outlined"
          startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={handleManualRefresh}
          disabled={refreshing}
          sx={{ ml: 2 }}
        >
          {refreshing ? 'Refreshing...' : 'Refresh Responses'}
        </Button>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => { setError(null); setNeedsGoogleReconnect(false); }}
          action={
            needsGoogleReconnect ? (
              <Button
                color="inherit"
                size="small"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_URL}/login/google`, { credentials: 'include' });
                    const data = await res.json();
                    if (data.authorization_url) {
                      window.location.href = data.authorization_url;
                    } else {
                      setError(data.error || 'Could not start Google connect');
                    }
                  } catch {
                    setError('Could not start Google connect');
                  }
                }}
              >
                Reconnect Google
              </Button>
            ) : undefined
          }
        >
          {error}
        </Alert>
      )}

      {/* Warnings */}
      {Array.isArray(formRequest.warnings) && formRequest.warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            Important Notices:
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {formRequest.warnings.map((warning: string, index: number) => (
              <li key={index}>
                <Typography variant="body2">{warning}</Typography>
              </li>
            ))}
          </Box>
        </Alert>
      )}

      {/* Form Details */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Form Details
        </Typography>
        <Divider sx={{ mb: 2 }} />
        
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Description
            </Typography>
            <Typography variant="body1">
              {formRequest.description ?? 'No description'}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Form URL
            </Typography>
            <Typography variant="body2">
              <a href={formRequest.form_url ?? '#'} target="_blank" rel="noopener noreferrer">
                {formRequest.form_url ?? '—'}
              </a>
            </Typography>
          </Box>

          <Box display="flex" gap={4}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Created
              </Typography>
              <Typography variant="body1">
                {formRequest.created_at ? new Date(formRequest.created_at).toLocaleString() : '—'}
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last Synced
              </Typography>
              <Typography variant="body1">
                {formRequest.last_synced_at 
                  ? new Date(formRequest.last_synced_at).toLocaleString()
                  : 'Never synced'}
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Status
              </Typography>
                <Chip 
                label={formRequest.status ?? 'Unknown'} 
                color={formRequest.status === 'Active' ? 'success' : 'default'}
                size="small"
              />
            </Box>
          </Box>
        </Stack>
      </Paper>

      {/* Response Summary */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Response Summary
        </Typography>
        <Divider sx={{ mb: 2 }} />
        
        <Box display="flex" alignItems="center" gap={2}>
          <Typography variant="h3" color="primary">
            {formRequest.response_count ?? 0}
          </Typography>
          <Typography variant="h5" color="text.secondary">
            / {formRequest.total_recipients ?? 0}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            responses received
          </Typography>
        </Box>
        
        {nonMemberResponses.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Warning: {nonMemberResponses.length} response{nonMemberResponses.length !== 1 ? 's' : ''} from non-members
          </Alert>
        )}
      </Paper>

      {/* Member Status Table */}
      {memberStatus.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">
              Member Status ({memberStatus.length})
            </Typography>
            <Button
              variant="contained"
              startIcon={sendingBulk ? <CircularProgress size={20} /> : <SendIcon />}
              onClick={handleSendBulkReminders}
              disabled={sendingBulk || memberStatus.filter(m => m.status === 'not_responded').length === 0}
            >
              {sendingBulk ? 'Sending...' : `Send to All Non-Responders (${memberStatus.filter(m => m.status === 'not_responded').length})`}
            </Button>
          </Box>
          <Divider sx={{ mb: 2}} />

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell width="50">#</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Submitted At</TableCell>
                  <TableCell width="120" align="center">Status</TableCell>
                  <TableCell width="120" align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {memberStatus.map((member, index) => (
                  <TableRow key={index} hover>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {member.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {member.submitted_at 
                        ? new Date(member.submitted_at).toLocaleString()
                        : '-'}
                    </TableCell>
                    <TableCell align="center">
                      {member.status === 'responded' ? (
                        <Chip 
                          icon={<CheckCircleIcon />} 
                          label="Responded" 
                          color="success" 
                          size="small" 
                        />
                      ) : (
                        <Chip 
                          icon={<CancelIcon />} 
                          label="Not Responded" 
                          color="error" 
                          size="small" 
                        />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {member.status === 'not_responded' && (
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={sendingEmail === member.email ? <CircularProgress size={16} /> : <EmailIcon />}
                          onClick={() => handleSendReminder(member.email)}
                          disabled={sendingEmail === member.email}
                        >
                          {sendingEmail === member.email ? 'Sending...' : 'Send Reminder'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Non-Member Responses */}
      {nonMemberResponses.length > 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Non-Member Responses ({nonMemberResponses.length})
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Alert severity="warning" sx={{ mb: 2 }}>
            These responses are from emails not in your recipient group
          </Alert>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell width="50">#</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Submitted At</TableCell>
                  <TableCell width="120" align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {nonMemberResponses.map((response, index) => (
                  <TableRow key={response.id} hover>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {response.respondent_email || 'Anonymous'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {response.submitted_at 
                        ? new Date(response.submitted_at).toLocaleString()
                        : 'Unknown'}
                    </TableCell>
                    <TableCell align="center">
                      <Chip 
                        label="Non-member" 
                        color="warning" 
                        size="small" 
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
