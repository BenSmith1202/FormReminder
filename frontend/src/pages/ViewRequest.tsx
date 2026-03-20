import { useEffect, useState, useMemo } from 'react';
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
  IconButton,
  Link,
  Tooltip,
  Snackbar,
  Container,
  Avatar,
  LinearProgress,
  Skeleton,
  InputAdornment,
  TextField,
  Tabs,
  Tab
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import EmailIcon from '@mui/icons-material/Email';
import SendIcon from '@mui/icons-material/Send';
import EditIcon from '@mui/icons-material/Edit';
import EventIcon from '@mui/icons-material/Event';
import ScheduleIcon from '@mui/icons-material/Schedule';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import LinkIcon from '@mui/icons-material/Link';
import SearchIcon from '@mui/icons-material/Search';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AssignmentIcon from '@mui/icons-material/Assignment';
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
  last_synced_at?: string;
  status: string;
  warnings?: string[];
  due_date?: string;
  reminder_schedule?: string | { schedule_type: string; [key: string]: any };
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

interface OptOutEventItem {
  id: string;
  recipient_email: string;
  event_type: string;
  group_name: string | null;
  performed_by: string;
  source: string;
  timestamp: string;
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
  const [addingEmail, setAddingEmail] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');

  // Opt-out tab state
  const [tabIndex, setTabIndex] = useState(0);
  const [optOutEvents, setOptOutEvents] = useState<OptOutEventItem[]>([]);
  const [optOutLoading, setOptOutLoading] = useState(false);
  const [optOutFetched, setOptOutFetched] = useState(false);
  const [resubscribingEmail, setResubscribingEmail] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadFormRequestData = async (showLoadingSpinner = true) => {
    try {
      if (showLoadingSpinner) setLoading(true);
      setError(null);
      const response = await fetch(
        `${API_URL}/api/form-requests/${requestId}/responses`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error(`Failed to load form request: ${response.status}`);
      const data = await response.json();
      const formReq = data?.form_request;
      if (!formReq) throw new Error('Invalid response: no form request data');
      setFormRequest(formReq);
      setNonMemberResponses(Array.isArray(data.non_member_responses) ? data.non_member_responses : []);
      setMemberStatus(Array.isArray(data.member_status) ? data.member_status : []);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to load form request');
    } finally {
      if (showLoadingSpinner) setLoading(false);
    }
  };

  // Sync with Google Forms then reload — the main data entry point
  const syncAndLoadData = async (showLoading = false) => {
    try {
      if (showLoading) setRefreshing(true);

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
            needsReconnect =
              result.action_required === 'reconnect_google' &&
              result.code !== 'form_id_edit_link_required';
          } catch { /* non-JSON response */ }
          if (needsReconnect) setNeedsGoogleReconnect(true);
          else if (response.status === 404) setNeedsGoogleReconnect(false);
          if (!formRequest) setError(errMsg);
        } else {
          setNeedsGoogleReconnect(false);
        }
      } catch (refreshErr: unknown) {
        if (!formRequest)
          setError(refreshErr instanceof Error ? refreshErr.message : 'Failed to refresh responses');
      }

      const isInitialLoad = !formRequest;
      try {
        await loadFormRequestData(isInitialLoad);
      } catch (loadErr) {
        if (!formRequest)
          setError(loadErr instanceof Error ? loadErr.message : 'Failed to load form request');
      }
    } finally {
      if (showLoading) setRefreshing(false);
    }
  };

  const handleManualRefresh = () => syncAndLoadData(true);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleSendReminder = async (email: string) => {
    if (!window.confirm(`Send a reminder email to ${email}?`)) return;
    setSendingEmail(email);
    try {
      const response = await fetch(
        `${API_URL}/api/form-requests/${requestId}/send-reminder/${encodeURIComponent(email)}`,
        { method: 'POST', credentials: 'include' }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send reminder');
      setSnackbar({ open: true, message: result.message || 'Reminder sent!', severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: `Failed: ${err.message}`, severity: 'error' });
    } finally {
      setSendingEmail(null);
    }
  };

  const handleSendBulkReminders = async () => {
    const nonResponders = memberStatus.filter((m) => m.status === 'not_responded');
    if (nonResponders.length === 0) { alert('All members have already responded!'); return; }
    if (!window.confirm(
      `Send reminder emails to all ${nonResponders.length} non-responders?\n\n(Skips anyone reminded in the last hour)`
    )) return;
    setSendingBulk(true);
    try {
      const response = await fetch(
        `${API_URL}/api/form-requests/${requestId}/send-reminders`,
        { method: 'POST', credentials: 'include' }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send reminders');
      setSnackbar({
        open: true,
        message: `Sent: ${result.sent} · Skipped (rate limit): ${result.skipped} · Failed: ${result.failed}`,
        severity: 'success',
      });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSendingBulk(false);
    }
  };

  const handleAddEmailToGroup = async (email: string) => {
    setAddingEmail(email);
    try {
      const response = await fetch(
        `${API_URL}/api/form-requests/${requestId}/add-email-to-group`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email }),
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to add email');
      setSnackbar({ open: true, message: result.message, severity: 'success' });
      loadFormRequestData();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setAddingEmail(null);
    }
  };

  const handleResubscribeOptOut = async (email: string) => {
    if (!ownerId) return;
    setResubscribingEmail(email);
    try {
      const res = await fetch(`${API_URL}/api/organizations/${ownerId}/resubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSnackbar({ open: true, message: data.error || 'Failed to re-subscribe', severity: 'error' });
        return;
      }
      setSnackbar({ open: true, message: 'Recipient re-subscribed successfully', severity: 'success' });
      const eventsRes = await fetch(`${API_URL}/api/organizations/${ownerId}/opt-out-events`, {
        credentials: 'include',
      });
      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        setOptOutEvents(Array.isArray(eventsData.events) ? eventsData.events : []);
      }
    } catch (e: any) {
      setSnackbar({ open: true, message: e.message || 'Failed to re-subscribe', severity: 'error' });
    } finally {
      setResubscribingEmail(null);
    }
  };

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (requestId) syncAndLoadData();
  }, [requestId]);

  // Fetch opt-out data lazily when the Opted Out tab is first opened
  useEffect(() => {
    if (tabIndex !== 1 || optOutFetched) return;
    const fetchOptOutData = async () => {
      setOptOutLoading(true);
      try {
        const userRes = await fetch(`${API_URL}/api/current-user`, { credentials: 'include' });
        const userData = await userRes.json();
        if (!userData.authenticated || !userData.user?.id) return;
        setOwnerId(userData.user.id);
        const eventsRes = await fetch(
          `${API_URL}/api/organizations/${userData.user.id}/opt-out-events`,
          { credentials: 'include' }
        );
        if (!eventsRes.ok) throw new Error('Failed to load opt-out events');
        const eventsData = await eventsRes.json();
        setOptOutEvents(Array.isArray(eventsData.events) ? eventsData.events : []);
      } catch {
        setOptOutEvents([]);
      } finally {
        setOptOutLoading(false);
        setOptOutFetched(true);
      }
    };
    fetchOptOutData();
  }, [tabIndex, optOutFetched]);

  // Poll every 30s + refresh immediately on tab visibility regain
  useEffect(() => {
    if (!requestId) return;
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') syncAndLoadData();
    }, 30000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncAndLoadData();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [requestId]);

  // Seconds-since-update ticker
  useEffect(() => {
    if (!lastUpdated) return;
    const timer = setInterval(() => {
      setSecondsSinceUpdate(Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const filteredMembers = memberStatus.filter((m) =>
    m.email.toLowerCase().includes(memberSearch.toLowerCase())
  );
  const nonResponderCount = memberStatus.filter((m) => m.status === 'not_responded').length;
  const responseRate =
    formRequest && formRequest.total_recipients > 0
      ? Math.round((formRequest.response_count / formRequest.total_recipients) * 100)
      : 0;

  const memberEmailsSet = useMemo(
    () => new Set(memberStatus.map((m) => m.email.toLowerCase())),
    [memberStatus]
  );

  const optedOutForRequest = useMemo(() => {
    const byEmail: Record<string, { event_type: string; timestamp: string }> = {};
    const sorted = [...optOutEvents]
      .filter((e) => memberEmailsSet.has((e.recipient_email || '').toLowerCase()))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    for (const e of sorted) {
      const key = (e.recipient_email || '').toLowerCase();
      if (key && byEmail[key] === undefined)
        byEmail[key] = { event_type: e.event_type, timestamp: e.timestamp };
    }
    return Object.entries(byEmail)
      .filter(([, v]) => v.event_type === 'opted_out' || v.event_type === 'left_group')
      .map(([email, v]) => ({ email, event_type: v.event_type, timestamp: v.timestamp }));
  }, [optOutEvents, memberEmailsSet]);

  const formatOptOutTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const h = d.getHours(), am = h < 12, h12 = h % 12 || 12, m = d.getMinutes();
      const pad = (n: number) => (n < 10 ? '0' + n : String(n));
      return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h12}:${pad(m)} ${am ? 'am' : 'pm'}`;
    } catch { return ts; }
  };

  const getScheduleLabel = (
    schedule?: string | { schedule_type: string; [key: string]: any }
  ) => {
    const type = typeof schedule === 'object' && schedule !== null ? schedule.schedule_type : schedule;
    switch (type) {
      case 'gentle': return 'Gentle (3, 1 days before)';
      case 'normal': return 'Normal (5, 3, 1 days before)';
      case 'frequent': return 'Frequent (Daily last week)';
      case 'custom': return 'Custom Schedule';
      default: return type || 'Not set';
    }
  };

  // ── Reconnect action used in multiple error locations ─────────────────────
  const reconnectGoogleAction = (
    <Button
      color="inherit"
      size="small"
      onClick={async () => {
        try {
          const res = await fetch(`${API_URL}/login/google`, { credentials: 'include' });
          const data = await res.json();
          if (data.authorization_url) window.location.href = data.authorization_url;
          else setError(data.error || 'Could not start Google connect');
        } catch { setError('Could not start Google connect'); }
      }}
    >
      Reconnect Google
    </Button>
  );

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading && !formRequest) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 3, mb: 3 }} />
        <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 3 }} />
      </Container>
    );
  }

  if (error && !formRequest) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/')} sx={{ mb: 2, color: 'text.secondary' }}>
          Back to Dashboard
        </Button>
        <Alert severity="error" action={needsGoogleReconnect ? reconnectGoogleAction : undefined}>
          {error}
        </Alert>
      </Container>
    );
  }

  if (!formRequest) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/')} sx={{ mb: 2, color: 'text.secondary' }}>
          Back to Dashboard
        </Button>
        <Alert severity="warning">Form request not found.</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }} className="page-fade-in">
      {/* ── Back nav ── */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/')}
        sx={{ color: 'text.secondary', mb: 3 }}
      >
        Back to Dashboard
      </Button>

      {/* ── Inline error (when we have data but sync failed) ── */}
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          onClose={() => { setError(null); setNeedsGoogleReconnect(false); }}
          action={needsGoogleReconnect ? reconnectGoogleAction : undefined}
        >
          {error}
        </Alert>
      )}

      {/* ── Warnings ── */}
      {Array.isArray(formRequest.warnings) && formRequest.warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            Important Notices:
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {formRequest.warnings.map((w, i) => (
              <li key={i}><Typography variant="body2">{w}</Typography></li>
            ))}
          </Box>
        </Alert>
      )}

      {/* ── Hero Header Card ── */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, sm: 4 },
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
          background: 'linear-gradient(135deg, #f0f4ff 0%, #ffffff 60%)',
        }}
      >
        {/* Title row */}
        <Box
          display="flex"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          flexWrap="wrap"
          gap={2}
          mb={3}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <Box
              sx={{
                width: { xs: 48, sm: 60 },
                height: { xs: 48, sm: 60 },
                borderRadius: 2.5,
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <AssignmentIcon sx={{ color: 'white', fontSize: { xs: 26, sm: 32 } }} />
            </Box>
            <Box>
              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                <Typography variant="h5" component="h1" fontWeight="bold" lineHeight={1.2}>
                  {formRequest.title}
                </Typography>
                <Chip
                  label={formRequest.status}
                  size="small"
                  color={formRequest.status === 'Active' ? 'success' : 'default'}
                  sx={{ fontWeight: 600 }}
                />
              </Box>
              <Typography variant="body2" color="text.secondary" mt={0.5}>
                {formRequest.description || 'No description provided.'}
              </Typography>
            </Box>
          </Box>

          {/* Action buttons */}
          <Box display="flex" gap={1} flexShrink={0} flexWrap="wrap">
            <Button
              variant="outlined"
              startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
              onClick={handleManualRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button
              variant="contained"
              startIcon={<EditIcon />}
              onClick={() => navigate(`/requests/${requestId}/edit`)}
            >
              Edit Request
            </Button>
          </Box>
        </Box>

        {/* Response rate bar */}
        <Box mb={3}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="body2" fontWeight="medium">Response Progress</Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>{formRequest.response_count}</strong> / {formRequest.total_recipients} &nbsp;·&nbsp; {responseRate}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={responseRate}
            color={responseRate === 100 ? 'success' : 'primary'}
            sx={{ height: 8, borderRadius: 4, bgcolor: 'action.hover' }}
          />
        </Box>

        {/* Meta row */}
        <Box
          display="flex"
          flexWrap="wrap"
          gap={{ xs: 2, sm: 4 }}
          sx={{ pt: 3, borderTop: '1px solid', borderColor: 'divider' }}
        >
          {formRequest.due_date && (
            <Box display="flex" alignItems="center" gap={1}>
              <EventIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
              <Typography variant="body2" color="text.secondary">
                Due <strong>{new Date(formRequest.due_date).toLocaleDateString()}</strong>
              </Typography>
            </Box>
          )}
          {formRequest.reminder_schedule && (
            <Box display="flex" alignItems="center" gap={1}>
              <ScheduleIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
              <Typography variant="body2" color="text.secondary">
                {getScheduleLabel(formRequest.reminder_schedule)}
              </Typography>
            </Box>
          )}
          <Box display="flex" alignItems="center" gap={1} sx={{ ml: { xs: 0, sm: 'auto' } }}>
            <LinkIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Link
              href={formRequest.form_url}
              target="_blank"
              rel="noopener"
              underline="hover"
              variant="body2"
              sx={{
                maxWidth: { xs: 180, sm: 300 },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
              }}
            >
              {formRequest.form_url}
            </Link>
          </Box>
        </Box>

        {lastUpdated && (
          <Typography variant="caption" color="text.disabled" display="block" mt={2}>
            Last synced {secondsSinceUpdate}s ago
          </Typography>
        )}
      </Paper>

      {/* ── Tabs ── */}
      <Tabs
        value={tabIndex}
        onChange={(_, v: number) => setTabIndex(v)}
        sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab label="Responses" />
        <Tab
          label={
            <Box display="flex" alignItems="center" gap={1}>
              Opted Out
              {optedOutForRequest.length > 0 && (
                <Chip label={optedOutForRequest.length} size="small" color="warning" sx={{ height: 18, fontSize: '0.7rem' }} />
              )}
            </Box>
          }
        />
      </Tabs>

      {/* ══════════════════════════════════════════════════════════════════
          TAB 0 — Responses
      ══════════════════════════════════════════════════════════════════ */}
      {tabIndex === 0 && (
        <>
          {/* Member Status Panel */}
          <Paper
            elevation={0}
            sx={{ mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden' }}
          >
            <Box
              px={{ xs: 2, sm: 3 }}
              py={2}
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              flexWrap="wrap"
              gap={2}
              sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
            >
              <Box display="flex" alignItems="center" gap={1}>
                <PeopleAltIcon fontSize="small" color="action" />
                <Typography variant="subtitle1" fontWeight="bold">Member Status</Typography>
              </Box>
              <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                <TextField
                  size="small"
                  placeholder="Search members…"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" sx={{ color: 'text.disabled' }} />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ width: { xs: '100%', sm: 200 } }}
                />
                <Button
                  variant="contained"
                  size="small"
                  startIcon={sendingBulk ? <CircularProgress size={14} color="inherit" /> : <SendIcon fontSize="small" />}
                  onClick={handleSendBulkReminders}
                  disabled={sendingBulk || nonResponderCount === 0}
                >
                  {sendingBulk ? 'Sending…' : `Remind All (${nonResponderCount})`}
                </Button>
              </Box>
            </Box>

            <TableContainer sx={{ maxHeight: 520 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold', width: 44 }}>#</TableCell>
                    <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold' }}>Email</TableCell>
                    <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold', display: { xs: 'none', sm: 'table-cell' } }}>Submitted</TableCell>
                    <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold' }} align="center">Status</TableCell>
                    <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold' }} align="center">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredMembers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                        {memberStatus.length === 0
                          ? 'No members in this group.'
                          : `No members match "${memberSearch}"`}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMembers.map((member, index) => (
                      <TableRow key={index} hover>
                        <TableCell>
                          <Typography variant="body2" color="text.disabled">{index + 1}</Typography>
                        </TableCell>
                        <TableCell>
                          <Box display="flex" alignItems="center" gap={1.5}>
                            <Avatar
                              sx={{
                                width: 28,
                                height: 28,
                                bgcolor: member.status === 'responded' ? 'success.50' : 'grey.100',
                                color: member.status === 'responded' ? 'success.main' : 'text.disabled',
                                fontSize: '0.7rem',
                                fontWeight: 'bold',
                                flexShrink: 0,
                              }}
                            >
                              {member.email[0].toUpperCase()}
                            </Avatar>
                            <Typography variant="body2" fontWeight="medium">{member.email}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                          <Typography variant="body2" color="text.secondary">
                            {member.submitted_at ? new Date(member.submitted_at).toLocaleString() : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          {member.status === 'responded' ? (
                            <Chip icon={<CheckCircleIcon />} label="Responded" color="success" size="small" variant="outlined" />
                          ) : (
                            <Chip icon={<CancelIcon />} label="Waiting" color="error" size="small" variant="outlined" />
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {member.status === 'not_responded' && (
                            <Tooltip title="Send individual reminder">
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => handleSendReminder(member.email)}
                                disabled={sendingEmail === member.email}
                              >
                                {sendingEmail === member.email
                                  ? <CircularProgress size={16} />
                                  : <EmailIcon fontSize="small" />}
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* Unrecognized Responses */}
          {nonMemberResponses.length > 0 && (
            <Paper
              elevation={0}
              sx={{ border: '1px solid', borderColor: 'warning.light', borderRadius: 3, overflow: 'hidden' }}
            >
              <Box
                px={{ xs: 2, sm: 3 }}
                py={2}
                display="flex"
                alignItems="center"
                gap={1}
                sx={{ borderBottom: '1px solid', borderColor: 'warning.light', bgcolor: '#fffbf0' }}
              >
                <WarningAmberIcon color="warning" fontSize="small" />
                <Typography variant="subtitle1" fontWeight="bold" color="warning.dark">
                  Unrecognized Responses
                </Typography>
                <Chip label={nonMemberResponses.length} size="small" color="warning" variant="outlined" sx={{ ml: 0.5 }} />
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ bgcolor: '#fffbf0', fontWeight: 'bold' }}>Email</TableCell>
                      <TableCell sx={{ bgcolor: '#fffbf0', fontWeight: 'bold', display: { xs: 'none', sm: 'table-cell' } }}>Submitted</TableCell>
                      <TableCell sx={{ bgcolor: '#fffbf0', fontWeight: 'bold' }} align="center">Add to Group</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {nonMemberResponses.map((response) => (
                      <TableRow key={response.id} hover>
                        <TableCell>
                          <Typography variant="body2">{response.respondent_email || 'Anonymous'}</Typography>
                        </TableCell>
                        <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                          <Typography variant="body2" color="text.secondary">
                            {new Date(response.submitted_at).toLocaleString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          {response.respondent_email && (
                            <Tooltip title="Add this email to the group">
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => handleAddEmailToGroup(response.respondent_email)}
                                disabled={addingEmail === response.respondent_email}
                              >
                                {addingEmail === response.respondent_email
                                  ? <CircularProgress size={16} />
                                  : <PersonAddIcon fontSize="small" />}
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 1 — Opted Out
      ══════════════════════════════════════════════════════════════════ */}
      {tabIndex === 1 && (
        <Paper
          elevation={0}
          sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden' }}
        >
          <Box
            px={{ xs: 2, sm: 3 }}
            py={2}
            sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
          >
            <Typography variant="subtitle1" fontWeight="bold">Opted Out Recipients</Typography>
            <Typography variant="body2" color="text.secondary">
              Members who have opted out or left the group for this request.
            </Typography>
          </Box>

          {optOutLoading ? (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          ) : optedOutForRequest.length === 0 ? (
            <Box py={6} textAlign="center">
              <CheckCircleIcon sx={{ fontSize: 40, color: 'success.light', mb: 1 }} />
              <Typography variant="body2" color="text.secondary">
                No opted-out recipients for this request.
              </Typography>
            </Box>
          ) : (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 360 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold' }}>Email</TableCell>
                    <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold' }}>Event</TableCell>
                    <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold', display: { xs: 'none', sm: 'table-cell' } }}>Timestamp</TableCell>
                    <TableCell sx={{ bgcolor: 'grey.50', fontWeight: 'bold' }} align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {optedOutForRequest.map((row) => (
                    <TableRow key={row.email} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">{row.email}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={row.event_type}
                          color={row.event_type === 'opted_out' ? 'error' : 'warning'}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        <Typography variant="body2" color="text.secondary">
                          {formatOptOutTimestamp(row.timestamp)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={resubscribingEmail === row.email}
                          onClick={() => handleResubscribeOptOut(row.email)}
                          startIcon={resubscribingEmail === row.email ? <CircularProgress size={14} /> : undefined}
                        >
                          {resubscribingEmail === row.email ? 'Sending…' : 'Re-subscribe'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}

      {/* ── Snackbar ── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}